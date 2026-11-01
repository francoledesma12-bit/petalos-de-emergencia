// Servidor de Pétalos de Emergencia: recibe WhatsApp y el chat web, atiende con
// Flora, guarda todo y le avisa al panel del dueño en tiempo real.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as datos from './src/db.js';
import { atender, resumenParaPersona, textoPedidoCreado, textoCambioEstado } from './src/cerebro.js';
import { enviar, leerAviso, buscarMensajes, waActivo, chatDe, estado as estadoWA } from './src/whatsapp.js';
import { iaActiva } from './src/ia.js';

const PUERTO = Number(process.env.PORT || 3000);
const NEGOCIO = process.env.NEGOCIO || 'petalos';
const ficha = JSON.parse(readFileSync(new URL(`./fichas/${NEGOCIO}.json`, import.meta.url), 'utf8'));
const CLAVE_PANEL = process.env.PANEL_CLAVE || 'flores';
const TOKEN_AVISO = process.env.WA_AVISO_TOKEN || '';
const WA_NUMERO = process.env.WA_NUMERO || null;
const PUBLICO = fileURLToPath(new URL('./public/', import.meta.url));

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

async function decir(c, texto, quien = 'flora') {
  datos.anotar(c.id, quien, texto);
  avisar('mensaje', { charla_id: c.id, quien, texto });
  if (c.canal === 'whatsapp') await enviar(c.chat_id, texto);
}

// Avisos al celular del dueño (como el aviso al vendedor de Rosario Exclusivos).
const DUENO = chatDe(process.env.DUENO_WA);
const PANEL_URL = process.env.PANEL_URL || '';
const avisarDueno = texto => (DUENO ? enviar(DUENO, texto) : Promise.resolve(false));
const quien = c => `${c.nombre || 'Cliente'}${c.canal === 'whatsapp' ? ' (+' + c.chat_id.replace('@c.us', '') + ')' : ' (chat web)'}`;
const hora = ms => new Date(ms).toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

// Atiende un mensaje (ya agrupado) y devuelve lo que contestó Flora.
async function procesar(canal, chatId, nombre, texto) {
  return enCola(`${canal}:${chatId}`, async () => {
    const c = datos.charla(NEGOCIO, canal, chatId, nombre);
    const historial = datos.historial(c.id);
    datos.anotar(c.id, 'cliente', texto);
    avisar('mensaje', { charla_id: c.id, quien: 'cliente', texto });

    // La atiende una persona: Flora no se mete. Si el cliente agrega algo, le llega al dueño.
    if (c.atiende === 'persona') {
      const relleno = /^(ok|oka|dale|gracias|graciass*|genial|bueno|listo|joya|👍|🙏|❤️)[.! ]*$/i.test(texto.trim());
      if (!relleno) {
        datos.agregarAlAviso(c.id, `Agregó (${hora(Date.now())}): "${texto}"`);
        await avisarDueno(`🔄 *ACTUALIZACIÓN caso #${c.id}* · ${quien(c)}\n"${texto}"`);
      }
      avisar('tablero');
      return [];
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
      ].join('\n'));
    }
    if (r.pedido) {
      const p = datos.crearPedido(NEGOCIO, c.id, r.pedido.datos, r.pedido.total, r.pedido.hora_limite);
      c.estado.pedido_id = p.id;
      dichas.push(textoPedidoCreado(ficha, p.id, p.total, p.datos.tono));
      const d = p.datos;
      avisarDueno([
        `🌹 *Pedido #${p.id}* · ${quien(c)}`,
        `${d.producto}${d.extras.length ? ' + ' + d.extras.join(', ') : ''} · *$ ${p.total.toLocaleString('es-AR')}*`,
        `Para ${d.recibe} · ${d.direccion} (${d.zona})`,
        `Llega antes de: ${hora(p.hora_limite)}`,
        `Tarjeta: "${d.tarjeta}"`,
      ].join('\n'));
    }
    datos.guardarEstado(c);
    for (const t of dichas) await decir(c, t);
    if (r.persona || r.pedido) avisar('tablero');
    return dichas;
  });
}

// Alguien contestó a mano desde el celular de la línea: Flora se calla en esa charla.
function tomaPersona({ chatId, texto }) {
  if (chatId === DUENO) return;
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
function recibirWhatsApp(m) {
  if (m.tipo === 'saliente') return tomaPersona(m);
  const { chatId, nombre, texto } = m;
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
    await avisarDueno(`⏱️ Nadie contestó el *caso #${c.id}* (${quien(c)}) en ${ficha.minutos_para_volver_si_nadie_contesta} minutos: Flora lo retomó para que no se vaya.`);
    avisar('tablero');
  }
}, 20000);

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

const firma = createHash('sha256').update('panel:' + CLAVE_PANEL).digest('hex');
function autorizado(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)panel=([a-f0-9]{64})/);
  return Boolean(m) && timingSafeEqual(Buffer.from(m[1]), Buffer.from(firma));
}

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
    if (req.method === 'GET' && ruta === '/api/salud') {
      return json(res, 200, { ok: true, ia: iaActiva(), whatsapp: await estadoWA() });
    }
    if (req.method === 'GET' && ruta === '/api/negocio') return json(res, 200, fichaPublica());

    // Aviso de GREEN-API (webhook).
    if (req.method === 'POST' && ruta === '/wa/aviso') {
      if (TOKEN_AVISO && req.headers.authorization !== `Bearer ${TOKEN_AVISO}`) return json(res, 401, { error: 'no' });
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
      const respuestas = await procesar('web', sesion, 'Visitante web', texto);
      return json(res, 200, { respuestas });
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
      if (String(b.clave || '') !== CLAVE_PANEL) return json(res, 401, { error: 'Clave incorrecta.' });
      res.setHeader('Set-Cookie', `panel=${firma}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
      return json(res, 200, { ok: true });
    }

    if (ruta.startsWith('/api/')) {
      if (!autorizado(req)) return json(res, 401, { error: 'Entrá con la clave del panel.' });

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
        if (!['nuevo', 'preparando', 'en_camino', 'entregado', 'cancelado'].includes(estado)) return json(res, 400, { error: 'Estado no válido.' });
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
