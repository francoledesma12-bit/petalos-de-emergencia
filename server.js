// Servidor de Pétalos de Emergencia: recibe WhatsApp y el chat web, atiende con
// Flora, guarda todo y le avisa al panel del dueño en tiempo real.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as datos from './src/db.js';
import { atender, resumenParaPersona, textoPedidoCreado, textoCambioEstado } from './src/cerebro.js';
import { enviar, enviarConAcciones, escribiendo, imagen, leerAviso, buscarMensajes, waActivo, chatDe, estado as estadoWA } from './src/whatsapp.js';
import { rutaDeReparto } from './src/reparto.js';
import { ubicar } from './src/mapa.js';
import { dibujarRamo, pasarATexto, eventoActivo } from './src/evento.js';
import { iaActiva } from './src/ia.js';

const PUERTO = Number(process.env.PORT || 3000);
const NEGOCIO = process.env.NEGOCIO || 'petalos';
const ficha = JSON.parse(readFileSync(new URL(`./fichas/${NEGOCIO}.json`, import.meta.url), 'utf8'));
if (process.env.RESCATE_MINUTOS) ficha.minutos_para_rescatar_venta = Number(process.env.RESCATE_MINUTOS); // para pruebas
const CLAVE_PANEL = process.env.PANEL_CLAVE || 'flores';
const TOKEN_AVISO = process.env.WA_AVISO_TOKEN || '';
const WA_NUMERO = process.env.WA_NUMERO || null;
const PUBLICO = fileURLToPath(new URL('./public/', import.meta.url));
const FOTOS = join(dirname(process.env.DB_RUTA || './datos/petalos.db'), 'fotos'); // ramos dibujados por la IA del evento

let posicionRepartidor = null; // { lat, lng, en } — la manda el celular del repartidor

// ---------- Tiempo real (panel) ----------
const oyentes = new Set();
function avisar(tipo, info = {}) {
  const linea = `event: ${tipo}\ndata: ${JSON.stringify(info)}\n\n`;
  for (const r of oyentes) r.write(linea);
}
setInterval(() => { for (const r of oyentes) r.write(': latido\n\n'); }, 25000);

// ---------- Cola por charla: los mensajes de un mismo cliente se atienden de a uno ----------
const colas = new Map();
function enCola(clave, tarea) {
  const previa = colas.get(clave) || Promise.resolve();
  const sigue = previa.then(tarea, tarea).finally(() => { if (colas.get(clave) === sigue) colas.delete(clave); });
  colas.set(clave, sigue);
  return sigue;
}

async function decir(c, texto, quien = 'flora', botones = []) {
  datos.anotar(c.id, quien, texto);
  avisar('mensaje', { charla_id: c.id, quien, texto });
  if (c.canal === 'whatsapp') await enviar(c.chat_id, texto, botones);
}

// Avisos al celular del dueño (como el aviso al vendedor de Rosario Exclusivos).
const DUENO = chatDe(process.env.DUENO_WA);
const PANEL_URL = process.env.PANEL_URL || '';
const SITIO = process.env.SITIO_URL || (PANEL_URL ? new URL(PANEL_URL).origin : ''); // para mandar imágenes por WhatsApp
// Cada aviso al dueño lleva botones para abrir el panel y llamar al cliente.
function avisarDueno(texto, c) {
  if (!DUENO) return Promise.resolve(false);
  const acciones = [];
  if (PANEL_URL) acciones.push({ tipo: 'url', texto: 'Abrir el panel', valor: PANEL_URL });
  if (c?.canal === 'whatsapp') acciones.push({ tipo: 'call', texto: 'Llamar al cliente', valor: c.chat_id.replace('@c.us', '') });
  return acciones.length ? enviarConAcciones(DUENO, texto, acciones) : enviar(DUENO, texto);
}
const quien = c => `${c.nombre || 'Cliente'}${c.canal === 'whatsapp' ? ' (+' + c.chat_id.replace('@c.us', '') + ')' : ' (chat web)'}`;
const hora = ms => new Date(ms).toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

// Atiende un mensaje (ya agrupado) y devuelve lo que contestó Flora.
async function procesar(canal, chatId, nombre, texto) {
  return enCola(`${canal}:${chatId}`, async () => {
    const c = datos.charla(NEGOCIO, canal, chatId, nombre);
    const historial = datos.historial(c.id);
    datos.anotar(c.id, 'cliente', texto);
    if (canal === 'whatsapp' && c.atiende === 'flora') escribiendo(chatId, 2500);
    avisar('mensaje', { charla_id: c.id, quien: 'cliente', texto });

    // La atiende una persona: Flora no se mete. Si el cliente agrega algo, le llega al dueño.
    if (c.atiende === 'persona') {
      const relleno = /^(ok|oka|dale|gracias|graciass*|genial|bueno|listo|joya|👍|🙏|❤️)[.! ]*$/i.test(texto.trim());
      if (!relleno) {
        datos.agregarAlAviso(c.id, `Agregó (${hora(Date.now())}): "${texto}"`);
        await avisarDueno(`🔄 *ACTUALIZACIÓN caso #${c.id}* · ${quien(c)}\n"${texto}"`, c);
      }
      avisar('tablero');
      return { respuestas: [], botones: [] };
    }

    const r = await atender(ficha, c.estado, historial, texto);
    c.estado = r.estado;
    const dichas = [...r.respuestas];

    if (r.persona) {
      c.atiende = 'persona';
      c.derivada_en = Date.now();
      const resumen = resumenParaPersona(ficha, c.estado, r.persona, texto);
      datos.crearAviso(NEGOCIO, c.id, r.persona, resumen);
      avisarDueno([
        `🚨 *Caso #${c.id}* · ${quien(c)}`, resumen, '',
        `Contestale desde el WhatsApp de la florería${PANEL_URL ? ' o desde el panel: ' + PANEL_URL : ''}.`,
        `Si nadie le contesta en ${ficha.minutos_para_volver_si_nadie_contesta} minutos, Flora vuelve a atenderlo.`,
      ].join('\n'), c);
    }
    if (r.pedido) {
      r.pedido.datos.imagen = c.estado.imagen || null;
      r.pedido.datos.estilo = c.estado.estilo || null;
      r.pedido.datos.rescatada = Boolean(c.estado.seguimiento_enviado);
      r.pedido.datos.cliente = r.pedido.datos.cliente || c.nombre || null;
      r.pedido.datos.telefono = c.canal === 'whatsapp' ? c.chat_id.replace('@c.us', '') : null;
      r.pedido.datos.canal = c.canal;
      const p = datos.crearPedido(NEGOCIO, c.id, r.pedido.datos, r.pedido.total, r.pedido.hora_limite);
      c.estado.pedido_id = p.id;
      ubicar(p.datos.direccion, ficha.ciudad).then(punto => { if (punto) { datos.sumarDatos(p.id, punto); avisar('tablero'); } });
      dichas.push(textoPedidoCreado(ficha, p.id, p.total, p.datos.tono));
      const d = p.datos;
      avisarDueno([
        `🌹 *Pedido #${p.id}* · ${quien(c)}`,
        `${d.producto}${d.extras.length ? ' + ' + d.extras.join(', ') : ''} · *$ ${p.total.toLocaleString('es-AR')}*`,
        `Para ${d.recibe} · ${d.direccion} (${d.zona})`,
        `Llega antes de: ${hora(p.hora_limite)}`,
        `Tarjeta: "${d.tarjeta}"`,
      ].join('\n'), c);
    }
    // Con colores y tarjeta elegidos, la IA del evento dibuja el ramo mientras el cliente sigue.
    const pedidoDibujo = [c.estado.producto, c.estado.estilo, c.estado.tarjeta, (c.estado.extras || []).join(',')].join('|');
    if (eventoActivo() && c.estado.estilo && c.estado.tarjeta && !c.estado.pedido_id && c.estado.imagen_tarjeta !== pedidoDibujo && (c.estado.dibujos || 0) < 3) {
      c.estado.imagen_tarjeta = pedidoDibujo; // si cambia ramo, colores, tarjeta o extras, se vuelve a dibujar
      c.estado.dibujos = (c.estado.dibujos || 0) + 1;
      dibujarPrevia(c.id);
    }
    datos.guardarEstado(c);
    const botones = r.pedido ? [] : (r.botones || []);
    // Solo las imágenes que ya existen en public/ (si falta alguna, la charla sigue igual).
    const imagenes = (r.imagenes || []).filter(im => existsSync(join(PUBLICO, im.archivo)))
      .map(im => ({ url: `/${im.archivo}`, texto: im.texto }));
    for (const [i, t] of dichas.entries()) {
      const ultimo = i === dichas.length - 1;
      if (ultimo && canal === 'whatsapp' && SITIO) {
        for (const im of imagenes) await imagen(chatId, SITIO + im.url, im.texto);
      }
      await decir(c, t, 'flora', ultimo ? botones : []);
    }
    if (r.persona || r.pedido) avisar('tablero');
    return { respuestas: dichas, botones, imagenes };
  });
}

// Si la línea es un celular personal, WA_PALABRA=flora hace que Flora solo atienda charlas que ya son suyas
// o que arrancan nombrándola (el QR manda "Hola Flora"). El resto se ignora y no se guarda.
const PALABRA = normalTexto(process.env.WA_PALABRA || '');
function normalTexto(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
const charlaExiste = chatId => Boolean(datos.db.prepare('SELECT 1 FROM charlas WHERE negocio=? AND canal=? AND chat_id=?').get(NEGOCIO, 'whatsapp', chatId));

// Alguien contestó a mano desde el celular de la línea: Flora se calla en esa charla.
function tomaPersona({ chatId, texto }) {
  if (chatId === DUENO || !charlaExiste(chatId)) return;
  enCola(`whatsapp:${chatId}`, async () => {
    const c = datos.charla(NEGOCIO, 'whatsapp', chatId);
    datos.anotar(c.id, 'persona', texto);
    c.atiende = 'persona';
    c.derivada_en = c.derivada_en || Date.now();
    datos.guardarEstado(c);
    avisar('mensaje', { charla_id: c.id, quien: 'persona', texto });
    avisar('tablero');
  }).catch(err => console.error('[toma]', err));
}

// WhatsApp: junta los mensajes que llegan seguidos (la gente escribe en partes).
const esperando = new Map();
// Con la API del evento: se dibuja el ramo (colores + tarjeta) y se le manda al cliente antes de confirmar.
function dibujarPrevia(charlaId) {
  const c0 = datos.charlaPorId(charlaId);
  const prod = ficha.productos.find(x => x.id === c0.estado.producto);
  const extras = (c0.estado.extras || []).map(id => ficha.extras.find(e => e.id === id)?.nombre).filter(Boolean);
  dibujarRamo({ id: charlaId, producto: prod?.nombre || 'ramo', detalle: prod?.detalle || '', extras, tarjeta: c0.estado.tarjeta,
    tono: ficha.situaciones[c0.estado.situacion]?.tono, estilo: c0.estado.estilo }, FOTOS)
    .then(archivo => archivo && enCola(`${c0.canal}:${c0.chat_id}`, async () => {
      const c = datos.charlaPorId(charlaId);
      const url = `/fotos/${archivo}`;
      c.estado.imagen = url;
      datos.guardarEstado(c);
      if (c.estado.pedido_id) datos.sumarDatos(c.estado.pedido_id, { imagen: url });
      if (c.canal === 'whatsapp' && SITIO) await imagen(c.chat_id, SITIO + url, '💐 Te comparto una vista previa de tu arreglo con la tarjeta. El ramo se arma a mano, por eso puede variar levemente.');
      datos.anotar(c.id, 'aviso', `💐 Vista previa de tu arreglo:
${url}`);
      avisar('mensaje', { charla_id: c.id, quien: 'aviso', texto: url });
      avisar('tablero');
    }))
    .catch(e => console.error('[imagen]', e.message));
}

function recibirWhatsApp(m) {
  if (m.tipo === 'audio') {
    // Audio → texto con la API del evento, y sigue como si lo hubiera escrito.
    pasarATexto(m.url).then(t => t
      ? recibirWhatsApp({ tipo: 'entrante', chatId: m.chatId, nombre: m.nombre, texto: t })
      : enviar(m.chatId, 'No pude escuchar bien el audio 🙈 ¿Me lo escribís?'));
    return;
  }
  if (m.tipo === 'saliente') return tomaPersona(m);
  if (m.tipo === 'ubicacion') {
    // El repartidor también puede mandar su ubicación por WhatsApp a la línea.
    if (m.chatId === chatDe(process.env.REPARTIDOR_WA)) { posicionRepartidor = { lat: m.lat, lng: m.lng, en: Date.now() }; avisar('repartidor', posicionRepartidor); }
    return;
  }
  const { chatId, nombre, texto } = m;
  if (PALABRA && !esperando.has(chatId) && !charlaExiste(chatId) && !normalTexto(texto).includes(PALABRA)) return;
  const e = esperando.get(chatId) || { textos: [] };
  clearTimeout(e.reloj);
  e.textos.push(texto);
  e.reloj = setTimeout(() => {
    esperando.delete(chatId);
    procesar('whatsapp', chatId, nombre, e.textos.join('\n')).catch(err => console.error('[procesar]', err));
  }, 1800);
  esperando.set(chatId, e);
}

// "Nadie se va sin respuesta": si una persona no contestó a tiempo, Flora vuelve.
setInterval(async () => {
  const limite = Date.now() - ficha.minutos_para_volver_si_nadie_contesta * 60000;
  const olvidadas = datos.db.prepare(`
    SELECT c.id FROM charlas c WHERE c.negocio=? AND c.atiende='persona' AND c.derivada_en < ?
    AND NOT EXISTS (SELECT 1 FROM mensajes m WHERE m.charla_id=c.id AND m.quien='persona' AND m.en >= c.derivada_en)`)
    .all(NEGOCIO, limite);
  for (const { id } of olvidadas) {
    const c = datos.charlaPorId(id);
    c.atiende = 'flora';
    c.derivada_en = null;
    datos.guardarEstado(c);
    datos.resolverAvisos(c.id);
    await decir(c, 'Perdón la espera 🙏 El equipo está a mil, así que sigo yo para que no pierdas tiempo. ¿En qué te ayudo?', 'aviso');
    await avisarDueno(`⏱️ Nadie contestó el *caso #${c.id}* (${quien(c)}) en ${ficha.minutos_para_volver_si_nadie_contesta} minutos: Flora lo retomó para que no se vaya.`, c);
    avisar('tablero');
  }
}, 20000);

// Rescate de ventas: el cliente que vio opciones y se quedó callado recibe UN mensaje para cerrar.
setInterval(async () => {
  const ahora = Date.now();
  const callados = datos.db.prepare(`
    SELECT id FROM charlas WHERE negocio=? AND atiende='flora' AND ultimo_mensaje_en BETWEEN ? AND ?
    AND json_extract(estado,'$.situacion') IS NOT NULL AND json_extract(estado,'$.pedido_id') IS NULL
    AND json_extract(estado,'$.seguimiento_enviado') IS NULL`)
    .all(NEGOCIO, ahora - 6 * 3600000, ahora - ficha.minutos_para_rescatar_venta * 60000);
  for (const { id } of callados) {
    await enCola(`rescate:${id}`, async () => {
      const c = datos.charlaPorId(id);
      if (!c || c.estado.seguimiento_enviado || c.estado.pedido_id) return;
      c.estado.seguimiento_enviado = true;
      datos.guardarEstado(c);
      const recomendado = ficha.productos.find(p => p.id === (c.estado.producto || c.estado.opciones?.[1] || c.estado.opciones?.[0]));
      const texto = c.estado.producto
        ? `¿Lo terminamos? 🌹 Te guardé el *${recomendado?.nombre}* a medio armar. Si me pasás lo que falta, hoy llega a tiempo.`
        : `¿Pudiste elegir? 🌹 Para esto el que más sale es el *${recomendado?.nombre}*. Decime el número y lo armo ya, así llega a tiempo.`;
      await decir(c, texto, 'aviso');
      avisar('tablero');
    });
  }
}, 30000);

// ---------- Ayudas HTTP ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function json(res, codigo, cuerpo) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
}

async function cuerpo(req, max = 64 * 1024) {
  let s = '';
  for await (const parte of req) { s += parte; if (s.length > max) throw new Error('muy grande'); }
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

// Roles: cada uno entra con su clave y solo puede hacer lo suyo.
const ROLES = {
  dueno: { clave: CLAVE_PANEL, estados: ['nuevo', 'preparando', 'listo', 'en_camino', 'entregado', 'cancelado'] },
  taller: { clave: process.env.TALLER_CLAVE || '', estados: ['preparando', 'listo'] },
  reparto: { clave: process.env.REPARTO_CLAVE || '', estados: ['en_camino', 'entregado'] },
};
const firmaDe = rol => createHash('sha256').update(`panel:${rol}:${ROLES[rol].clave}`).digest('hex');
function rolDe(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)panel=([a-f0-9]{64})/);
  if (!m) return null;
  return Object.keys(ROLES).find(rol => ROLES[rol].clave && timingSafeEqual(Buffer.from(m[1]), Buffer.from(firmaDe(rol)))) || null;
}
const PAGINA_DE_ROL = { dueno: '/panel', taller: '/taller', reparto: '/reparto' };

// Límite simple para que nadie abuse del chat de prueba.
const usos = new Map();
function demasiado(ip) {
  const minuto = Math.floor(Date.now() / 60000);
  const u = usos.get(ip);
  if (!u || u.minuto !== minuto) { usos.set(ip, { minuto, n: 1 }); return false; }
  return ++u.n > 30;
}

function fichaPublica() {
  const { id, nombre, asistente, lema, ciudad, direccion_local, horario, productos, extras, zonas, pago, situaciones } = ficha;
  return { id, nombre, asistente, lema, ciudad, direccion_local, horario, pago, whatsapp: WA_NUMERO,
    situaciones: Object.fromEntries(Object.entries(situaciones).map(([k, v]) => [k, v.nombre])),
    productos: productos.map(({ id, nombre, detalle, precio, para }) => ({ id, nombre, detalle, precio, para })),
    extras, zonas: zonas.map(({ id, nombre, precio }) => ({ id, nombre, precio })) };
}

async function archivo(res, ruta) {
  const limpia = normalize(decodeURIComponent(ruta)).replace(/^(\.\.[/\\])+/, '');
  let destino = join(PUBLICO, limpia);
  if (!destino.startsWith(normalize(PUBLICO))) return json(res, 404, { error: 'no existe' });
  if (ruta.endsWith('/')) destino = join(destino, 'index.html');
  else if (!extname(destino) && existsSync(destino + '.html')) destino += '.html';
  try {
    const contenido = await readFile(destino);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(destino)] || 'application/octet-stream',
      'Cache-Control': extname(destino) === '.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(contenido);
  } catch {
    json(res, 404, { error: 'no existe' });
  }
}

// ---------- Rutas ----------
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ruta = url.pathname;
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    // Imágenes de los ramos dibujados (guardadas junto a la base de datos).
    let f;
    if (req.method === 'GET' && (f = ruta.match(/^\/fotos\/(ramo-\d+-[a-z0-9]+\.png)$/))) {
      try {
        const contenido = await readFile(join(FOTOS, f[1]));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        return res.end(contenido);
      } catch { return json(res, 404, { error: 'no existe' }); }
    }
    if (req.method === 'GET' && ruta === '/api/salud') {
      return json(res, 200, { ok: true, ia: iaActiva(), ia_evento: eventoActivo(), whatsapp: await estadoWA() });
    }
    if (req.method === 'GET' && ruta === '/api/negocio') return json(res, 200, fichaPublica());

    // Aviso de GREEN-API (webhook).
    if (req.method === 'POST' && ruta === '/wa/aviso') {
      if (TOKEN_AVISO && !String(req.headers.authorization || "").endsWith(TOKEN_AVISO)) return json(res, 401, { error: "no" });
      const m = leerAviso(await cuerpo(req));
      if (m) recibirWhatsApp(m);
      return json(res, 200, { ok: true });
    }

    // Chat web de prueba: mismo cerebro que WhatsApp.
    if (req.method === 'POST' && ruta === '/api/chat') {
      if (demasiado(ip)) return json(res, 429, { error: 'Muchos mensajes seguidos. Esperá un minuto.' });
      const b = await cuerpo(req);
      const sesion = String(b.sesion || '').slice(0, 64);
      const texto = String(b.texto || '').trim().slice(0, 1000);
      if (!/^[\w-]{8,64}$/.test(sesion) || !texto) return json(res, 400, { error: 'Falta el mensaje.' });
      const { respuestas, botones, imagenes } = await procesar('web', sesion, 'Visitante web', texto);
      return json(res, 200, { respuestas, botones, imagenes: imagenes || [] });
    }
    // El chat web busca acá lo que le contestó una persona desde el panel.
    if (req.method === 'GET' && ruta.startsWith('/api/chat/')) {
      const sesion = ruta.split('/')[3];
      const c = datos.db.prepare('SELECT id FROM charlas WHERE negocio=? AND canal=? AND chat_id=?').get(NEGOCIO, 'web', sesion);
      const desde = Number(url.searchParams.get('desde') || 0);
      const mensajes = c ? datos.db.prepare(`SELECT quien, texto, en FROM mensajes WHERE charla_id=? AND quien IN ('persona','aviso') AND en>? ORDER BY id`).all(c.id, desde) : [];
      return json(res, 200, { mensajes });
    }

    if (req.method === 'POST' && ruta === '/api/entrar') {
      const b = await cuerpo(req);
      const rol = Object.keys(ROLES).find(r => ROLES[r].clave && String(b.clave || '') === ROLES[r].clave);
      if (!rol) return json(res, 401, { error: 'Clave incorrecta.' });
      res.setHeader('Set-Cookie', `panel=${firmaDe(rol)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
      return json(res, 200, { ok: true, rol, pagina: PAGINA_DE_ROL[rol] });
    }

    if (ruta.startsWith('/api/')) {
      const rol = rolDe(req);
      if (!rol) return json(res, 401, { error: 'Entrá con tu clave.' });

      if (req.method === 'GET' && ruta === '/api/yo') return json(res, 200, { rol, pagina: PAGINA_DE_ROL[rol] });

      if (req.method === 'GET' && ruta === '/api/taller') {
        const pedidos = datos.pedidosEn(NEGOCIO, ['nuevo', 'preparando'])
          .map(({ id, estado, hora_limite, datos: d }) => ({ id, estado, hora_limite,
            datos: { producto: d.producto, extras: d.extras, tarjeta: d.tarjeta, tono: d.tono, recibe: d.recibe, notas: d.notas ?? null, situacion: d.situacion } }));
        return json(res, 200, { pedidos });
      }
      if (req.method === 'GET' && ruta === '/api/reparto') {
        const pedidos = datos.pedidosEn(NEGOCIO, ['listo', 'en_camino'])
          .map(({ id, estado, hora_limite, datos: d }) => ({ id, estado, hora_limite,
            datos: { recibe: d.recibe, direccion: d.direccion, zona: d.zona, producto: d.producto, notas: d.notas ?? null, ventana: d.ventana ?? null, telefono: d.telefono ?? null, lat: d.lat ?? null, lng: d.lng ?? null } }));
        const ruta_ = await rutaDeReparto(ficha, pedidos);
        pedidos.sort((a, b) => ruta_.orden.indexOf(a.id) - ruta_.orden.indexOf(b.id));
        return json(res, 200, { ruta: ruta_, pedidos, local: { lat: ficha.local_lat, lng: ficha.local_lng, direccion: ficha.direccion_local }, repartidor: posicionRepartidor });
      }
      if (req.method === 'POST' && ruta === '/api/reparto/posicion') {
        if (rol !== 'reparto' && rol !== 'dueno') return json(res, 403, { error: 'No permitido.' });
        const { lat, lng } = await cuerpo(req);
        if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return json(res, 400, { error: 'Ubicación inválida.' });
        posicionRepartidor = { lat: Number(lat), lng: Number(lng), en: Date.now() };
        avisar('repartidor', posicionRepartidor);
        return json(res, 200, { ok: true });
      }

      // De acá para abajo: solo el dueño (salvo cambiar estados, que controla cada rol).
      const soloDueno = !/^\/api\/(eventos|pedidos\/\d+)$/.test(ruta);
      if (soloDueno && rol !== 'dueno') return json(res, 403, { error: 'Esto lo ve solo el dueño.' });

      if (req.method === 'GET' && ruta === '/api/eventos') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 3000\n\n');
        oyentes.add(res);
        req.on('close', () => oyentes.delete(res));
        return;
      }
      if (req.method === 'GET' && ruta === '/api/tablero') return json(res, 200, datos.tablero(NEGOCIO));

      let m;
      if (req.method === 'POST' && (m = ruta.match(/^\/api\/pedidos\/(\d+)$/))) {
        const { estado } = await cuerpo(req);
        if (!ROLES[rol].estados.includes(estado)) return json(res, 403, { error: 'Ese cambio no lo podés hacer con tu usuario.' });
        const actual = datos.pedido(Number(m[1]));
        if (!actual || actual.negocio !== NEGOCIO) return json(res, 404, { error: 'No existe ese pedido.' });
        const p = datos.cambiarPedido(actual.id, estado);
        const texto = textoCambioEstado(ficha, p);
        if (texto && estado !== actual.estado) await decir(datos.charlaPorId(p.charla_id), texto, 'aviso');
        avisar('tablero');
        return json(res, 200, { ok: true, pedido: p });
      }
      if (req.method === 'GET' && (m = ruta.match(/^\/api\/charlas\/(\d+)$/))) {
        const c = datos.charlaPorId(Number(m[1]));
        if (!c || c.negocio !== NEGOCIO) return json(res, 404, { error: 'No existe.' });
        return json(res, 200, { charla: { id: c.id, nombre: c.nombre, canal: c.canal, atiende: c.atiende }, mensajes: datos.historial(c.id, 200) });
      }
      if (req.method === 'POST' && (m = ruta.match(/^\/api\/charlas\/(\d+)\/(responder|devolver)$/))) {
        const c = datos.charlaPorId(Number(m[1]));
        if (!c || c.negocio !== NEGOCIO) return json(res, 404, { error: 'No existe.' });
        if (m[2] === 'responder') {
          const texto = String((await cuerpo(req)).texto || '').trim().slice(0, 2000);
          if (!texto) return json(res, 400, { error: 'Escribí un mensaje.' });
          c.atiende = 'persona';
          c.derivada_en = c.derivada_en || Date.now();
          datos.guardarEstado(c);
          await decir(c, texto, 'persona');
        } else {
          c.atiende = 'flora';
          c.derivada_en = null;
          datos.guardarEstado(c);
          datos.resolverAvisos(c.id);
        }
        avisar('tablero');
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'No existe.' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'No permitido.' });
    return archivo(res, ruta);
  } catch (e) {
    console.error('[servidor]', e);
    if (!res.headersSent) json(res, 500, { error: 'Algo falló. Probá de nuevo.' });
  }
});

servidor.listen(PUERTO, () => {
  console.log(`Pétalos de Emergencia en el puerto ${PUERTO} · IA: ${iaActiva() ? 'sí' : 'no (reglas)'} · WhatsApp: ${waActivo() ? 'sí' : 'no'}`);
  if (waActivo() && process.env.WA_MODO === 'buscar') buscarMensajes(recibirWhatsApp);
});
