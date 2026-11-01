// Cerebro de Flora. Cuatro pasos por cada mensaje:
// 1. Entender (IA, con respaldo por reglas): qué pasó, qué eligió, dirección, hora…
// 2. Decidir (código): qué falta para cerrar el pedido.
// 3. Contestar (plantillas + una frase de la IA ya controlada).
// 4. Controlar (código): la IA nunca pone precios; los totales salen de la ficha.
import { pedirJSON } from './ia.js';

const pesos = n => '$ ' + Math.round(n).toLocaleString('es-AR');
const normal = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const hhmm = ms => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
const cuando = ms => { const d = new Date(ms), hoy = new Date(), man = new Date(Date.now() + 864e5);
  const dia = d.toDateString() === hoy.toDateString() ? 'hoy' : d.toDateString() === man.toDateString() ? 'mañana' : 'el ' + d.toLocaleDateString('es-AR', { weekday: 'long' });
  return `${dia} antes de las ${hhmm(ms)}`; };

export const FRASE_PERSONA = 'Te paso con una persona del equipo para que lo vea. Ya le dejé todo anotado, así no tenés que repetir nada. 🙌';

// ---------- 1. Entender ----------

// "2", "el 2", "dale la 2", "el segundo", "la del medio" → 2. Solo en mensajes cortos, para no confundir direcciones.
function numeroElegido(t) {
  if (t.length > 40) return null;
  const n = t.match(/(?:^|[^\d])([1-3])(?![\d:.,]?\d)/);
  if (n) return Number(n[1]);
  if (/primer|primera/.test(t)) return 1;
  if (/segund|del medio/.test(t)) return 2;
  if (/tercer|ultim/.test(t)) return 3;
  return null;
}

function entenderConReglas(texto, estado, ficha) {
  const t = normal(texto);
  const r = {};
  if (/persona|humano|alguien de verdad|encargad|hablar con|atencion al cliente/.test(t)) r.pide_persona = true;
  if (/no llego|nunca llego|todavia no llega|llego mal|llego feo|llegaron feas|marchit|reclamo|me estafaron|estan rotas|aplastad/.test(t)) r.reclamo = true;
  if (/catalogo|ver todo|que tenes|que tienen|que venden|fotos/.test(t)) r.catalogo = true;
  if (/falleci|murio|velorio|sepelio|pesame|condolencia|despedida|qepd/.test(t)) r.situacion = 'condolencias';
  else if (/cuerno|me echo|me dejo|me fue infiel|terrible|re grave|la cague mal|macana grande/.test(t)) r.situacion = 'grave';
  else if (/olvid/.test(t)) r.situacion = 'olvido';
  else if (/pele|enoj|furios|discut|no me habla/.test(t)) r.situacion = 'pelea';
  else if (/cumple|recibio|egres|festej|nacio|aniversario/.test(t)) r.situacion = 'cumple';
  else if (/agradec|gracias a|regalo para la seño|maestra/.test(t)) r.situacion = 'agradecer';
  else if (/operad|internad|enferm|recuper|mejore/.test(t)) r.situacion = 'salud';
  else if (/sorpresa|enamor|novia|novio|conquist|primera cita/.test(t)) r.situacion = 'romance';

  if (estado.opciones && !estado.producto) {
    const n = numeroElegido(t);
    if (n) r.eleccion = estado.opciones[n - 1];
    else if (/mas barat|economic/.test(t)) r.eleccion = estado.opciones[0];
    else if (/mas caro|mas grande|el mejor|tirar la casa/.test(t)) r.eleccion = estado.opciones.at(-1);
  }
  for (const p of ficha.productos) if (t.includes(normal(p.nombre).split(' ').slice(1).join(' '))) r.eleccion = p.id;
  r.extras = ficha.extras.filter(e => t.includes(normal(e.nombre).split(' ').pop()) || t.includes(e.id)).map(e => e.id);

  if (estado.producto && !estado.estilo && texto.length <= 80 && !/persona|humano|cancel/.test(t)) r.estilo = texto;
  if (estado.tarjetas && !estado.tarjeta) {
    const n = numeroElegido(t);
    if (n) r.eleccion_tarjeta = n;
    if (/sin tarjeta|no quiero tarjeta|sin mensaje/.test(t)) r.sin_tarjeta = true;
  }
  // "entre las 12 y las 15" → tiene que llegar antes de las 15.
  const rango = t.match(/entre (?:las )?(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs?)?\s*y (?:las )?(\d{1,2})(?:[:.](\d{2}))?/);
  const hora = rango ? [null, rango[3], rango[4]] : t.match(/(?:antes de las|a las|para las|hasta las|tipo|a eso de las|antes de)\s*(\d{1,2})(?:[:.](\d{2}))?/);
  if (hora) r.hora_limite = `${hora[1].padStart(2, '0')}:${hora[2] || '00'}`;
  if (rango) r.ventana = `entre las ${rango[1]} y las ${rango[3]}`;
  const sinHora = texto.replace(/(?:entre (?:las )?\d{1,2}(?:[:.]\d{2})?\s*(?:hs?)?\s*y (?:las )?|antes de las|a las|para las|hasta las|tipo|a eso de las)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:hs?)?/gi, ' ');
  const dir = sinHora.match(/([A-Za-zÁÉÍÓÚáéíóúÑñ. ]{3,40}\s\d{2,5})/);
  if (dir && !/^(recibe|para|a nombre)/i.test(dir[1].trim())) r.direccion = dir[1].trim();
  const recibe = texto.match(/(?:a nombre de|la recibe|lo recibe|recibe|para|se llama|es para)\s+([A-ZÁÉÍÓÚa-záéíóúñ][a-záéíóúñ]+)/i);
  if (recibe && !/^(mi|la|el|las|los|un|una|que|ella|el|hoy|mañana)$/i.test(recibe[1])) r.recibe = recibe[1][0].toUpperCase() + recibe[1].slice(1);
  // La tarjeta se puede dictar o cambiar en cualquier momento: "que la tarjeta diga …"
  const dicta = texto.match(/tarjeta (?:que )?(?:diga|dice|ponga|con el texto)[:\s]+["“]?(.{3,200}?)["”]?\s*$/i);
  if (dicta) r.tarjeta_propia = dicta[1].trim().replace(/^./, c => c.toUpperCase());
  const notas = [/sorpresa/.test(t) && 'Es sorpresa', /timbre|portero/.test(t) && 'Tocar timbre/portero', /no (?:llames|llamar)/.test(t) && 'No llamar antes'].filter(Boolean);
  if (notas.length) r.notas = notas.join('. ');
  r.pregunta_real = /[?]|horario|abren|cierran|donde estan|donde queda|ubicad|como pago|pagar|transfer|alias|cuanto sale el envio|hacen envio|delivery/.test(t);
  if (/^[^a-z0-9]*(si|dale|ok|confirmo|confirmar|de una|perfecto|listo|va|confirmado)\b/.test(t)) r.confirma = true;
  if (/cancel|no quiero|deja nomas|olvidate/.test(t)) r.cancela = true;
  return r;
}

function promptEntender(ficha, estado, historial, texto) {
  const productos = ficha.productos.map(p => `${p.id}: ${p.nombre} (${p.detalle}) para ${p.para.join('/')}`).join('\n');
  const charla = historial.map(m => `${m.quien}: ${m.texto}`).join('\n');
  return [
    `Sos el lector de mensajes de ${ficha.nombre}, una florería de ${ficha.ciudad}. NO le contestás al cliente: solo anotás lo que entendiste, en JSON.`,
    `Situaciones posibles: ${Object.keys(ficha.situaciones).join(', ')}. "grave" es una macana muy grande (infidelidad, lo echaron de casa).`,
    `Productos:\n${productos}`,
    `Extras: ${ficha.extras.map(e => e.id).join(', ')}.`,
    `Lo que ya sabemos: ${JSON.stringify(estado)}`,
    `Charla reciente:\n${charla}`,
    `Mensaje nuevo del cliente: """${texto}"""`,
    `Devolvé SOLO este JSON (null si no aparece; no inventes):`,
    `{"pide_persona":bool,"reclamo":"true si se queja de un pedido (no llegó, llegó mal, demora)","situacion":str|null,"gravedad":1|2|3|null,"para":"quién recibe y relación, ej: 'Caro, mi novia'"|null,`,
    `"contexto":"en 1 línea qué pasó"|null,"eleccion":id de producto|null,"extras":[ids],"eleccion_tarjeta":1|2|3|null,`,
    `"sin_tarjeta":bool,"tarjeta_propia":"texto EXACTO si el cliente dicta o cambia lo que dice la tarjeta (aunque ya haya elegido una)"|null,"direccion":"calle y número"|null,`,
    `"barrio":str|null,"hora_limite":"HH:MM 24h; si da un rango (entre las 12 y las 15) poné el final del rango"|null,"ventana":"el rango tal cual, ej: entre las 12 y las 15"|null,"estilo":"colores o flores que pide para el ramo, o 'sorprendeme' si deja que elijamos"|null,"notas":"indicaciones para la entrega o el armado que dio el cliente (es sorpresa, tocar timbre, piso, alergias, colores)"|null,"recibe":"nombre de quien recibe"|null,"nombre_cliente":str|null,`,
    `"confirma":bool,"cancela":bool,"catalogo":"true si pide ver el catálogo, fotos o todo lo que hay","pregunta":"si pregunta otra cosa (horario, pago, envío), cuál"|null,`,
    `"frase":"UNA frase corta y humana para arrancar la respuesta, en español rioplatense, con humor si es una macana y seria si es un duelo. Sin precios, sin números, sin prometer nada"}`,
  ].join('\n');
}

async function entender(ficha, estado, historial, texto) {
  const reglas = entenderConReglas(texto, estado, ficha);
  const ia = await pedirJSON('Respondés solo JSON válido.', promptEntender(ficha, estado, historial, texto));
  if (!ia) return reglas;
  const r = { ...reglas };
  for (const [k, v] of Object.entries(ia)) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) r[k] = v;
  if (r.situacion && !ficha.situaciones[r.situacion]) delete r.situacion;
  if (r.eleccion && !ficha.productos.some(p => p.id === r.eleccion)) delete r.eleccion;
  r.extras = (r.extras || []).filter(id => ficha.extras.some(e => e.id === id));
  return r;
}

// ---------- 4. Controlar ----------
// La frase de la IA no puede tener plata, números ni promesas. Si los tiene, se descarta.
function fraseSegura(f) {
  if (!f || typeof f !== 'string') return '';
  if (/\$|\d|precio|gratis|descuento|te lo consigo|garantiz/i.test(f) || f.length > 180) return '';
  return f.trim();
}

// ---------- Tarjetas ----------
const TONOS = {
  humor: ['romántica', 'graciosa', 'perdón de verdad'],
  calido: ['cálida', 'divertida', 'cortita'],
  serio: ['serena', 'cercana', 'breve'],
};

function tarjetasDeRespaldo(tono, para) {
  const n = (para || '').split(/[ ,]/)[0] || '';
  if (tono === 'serio') return [
    'Con todo nuestro cariño, acompañándolos en este momento.',
    `${n ? n + ', ' : ''}estamos cerca. Un abrazo grande y sentido.`,
    'Con respeto y afecto, en su memoria.',
  ];
  if (tono === 'calido') return [
    `${n ? n + ', ' : ''}que este día sea tan lindo como vos.`,
    'Estas flores tienen instrucciones claras: sacarte una sonrisa.',
    '¡Felicidades! Con mucho cariño.',
  ];
  return [
    `${n ? n + ', ' : ''}no hay flor que alcance para decirte cuánto te quiero. Perdoname.`,
    'Estas flores vienen a negociar mi regreso del sillón. 🌹',
    `${n ? n + ', ' : ''}me equivoqué y lo sé. Vos me importás más que tener razón.`,
  ];
}

// Colores del ramo: lo que pidió el cliente, o uno al azar si dijo "sorprendeme".
const SORPRESAS = ['rojo intenso con toques de bordó', 'rosa pastel y blanco', 'naranjas y amarillos de atardecer',
  'lilas y violetas', 'blanco y verde con eucalipto', 'fucsia y coral vibrantes'];
function elegirEstilo(pedido) {
  const t = normal(pedido);
  if (/sorpren|azar|aleatori|random|da igual|lo que sea|elegi vos|cualquiera/.test(t)) return SORPRESAS[Math.floor(Math.random() * SORPRESAS.length)];
  if (/^[^a-z]*rojos y pasion/.test(t)) return 'rojo intenso con toques de bordó';
  if (/^[^a-z]*rosas y pasteles/.test(t)) return 'rosa pastel y blanco';
  return pedido.replace(/^[^\p{L}]+/u, '').slice(0, 80);
}

async function escribirTarjetas(ficha, estado) {
  const tono = ficha.situaciones[estado.situacion]?.tono || 'calido';
  const nombres = TONOS[tono];
  const ia = await pedirJSON('Respondés solo JSON válido.', [
    `Escribí 3 tarjetas para un ramo de ${ficha.nombre}.`,
    `Situación: ${ficha.situaciones[estado.situacion]?.nombre || 'regalo'}. Qué pasó: ${estado.contexto || 'sin detalle'}. Para: ${estado.para || 'alguien querido'}.`,
    `Tonos, en este orden: ${nombres.join(', ')}. Español rioplatense, máximo 160 caracteres cada una, sin firmas.`,
    tono === 'serio' ? 'Es un duelo: nada de humor ni emojis.' : 'Podés usar un emoji como mucho.',
    `JSON: {"tarjetas":["...","...","..."]}`,
  ].join('\n'));
  const lista = Array.isArray(ia?.tarjetas) ? ia.tarjetas.filter(t => typeof t === 'string' && t.length <= 220).slice(0, 3) : [];
  const textos = (lista.length === 3 ? lista : tarjetasDeRespaldo(tono, estado.para)).map(t => t.charAt(0).toUpperCase() + t.slice(1));
  return { nombres, textos };
}

// ---------- Cálculos (siempre con código) ----------
export function zonaDe(ficha, texto) {
  const t = normal(texto);
  return ficha.zonas.find(z => z.barrios.some(b => t.includes(normal(b))));
}

export function calcular(ficha, estado) {
  const producto = ficha.productos.find(p => p.id === estado.producto);
  const extras = (estado.extras || []).map(id => ficha.extras.find(e => e.id === id)).filter(Boolean);
  const zona = ficha.zonas.find(z => z.id === estado.zona) || ficha.zonas.find(z => z.id === ficha.zona_por_defecto);
  const total = (producto?.precio || 0) + extras.reduce((s, e) => s + e.precio, 0) + zona.precio;
  return { producto, extras, zona, total };
}

function opcionesPara(ficha, estado) {
  const nivel = estado.gravedad || ficha.situaciones[estado.situacion]?.nivel_sugerido || 2;
  return ficha.productos
    .filter(p => p.para.includes(estado.situacion))
    .sort((a, b) => Math.abs(a.nivel - nivel) - Math.abs(b.nivel - nivel) || a.precio - b.precio)
    .slice(0, 3)
    .sort((a, b) => a.precio - b.precio);
}

// Arma la hora límite como fecha completa y la corrige si no llegamos.
function horaLimite(ficha, hhmmTexto, ahora = new Date()) {
  const [h, m] = hhmmTexto.split(':').map(Number);
  if (!(h >= 0 && h < 24)) return null;
  const pedida = new Date(ahora); pedida.setHours(h, m || 0, 0, 0);
  const masTemprano = new Date(ahora.getTime() + 90 * 60000);
  const corte = new Date(ahora); corte.setHours(ficha.horario.ultimo_envio_mismo_dia, 0, 0, 0);
  const abreHoy = ficha.horario.dias.includes(ahora.getDay());
  if (pedida < ahora || !abreHoy || ahora > corte) {
    // Pasa a mañana (o al próximo día que abrimos).
    const d = new Date(pedida);
    do d.setDate(d.getDate() + 1); while (!ficha.horario.dias.includes(d.getDay()));
    if (d.getHours() < ficha.horario.abre + 2) d.setHours(ficha.horario.abre + 2, 0, 0, 0);
    return { ms: d.getTime(), aviso: `Hoy ya no llegamos, así que lo programo para ${d.toLocaleDateString('es-AR', { weekday: 'long' })} antes de las ${hhmm(d)}.` };
  }
  if (pedida < masTemprano) {
    const redondeo = new Date(Math.ceil(masTemprano.getTime() / (15 * 60000)) * 15 * 60000);
    return { ms: redondeo.getTime(), aviso: `Lo más rápido que llegamos es a las ${hhmm(redondeo)}. Vamos a toda máquina. 🛵` };
  }
  return { ms: pedida.getTime(), aviso: '' };
}

function respuestaPregunta(ficha) {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const abre = ficha.horario.dias.map(d => dias[d]);
  return [
    `📍 Estamos en ${ficha.direccion_local}. Atendemos de ${abre[0]} a ${abre[abre.length - 1]}, de ${ficha.horario.abre} a ${ficha.horario.cierra} h.`,
    `🛵 Envíos en el día si pedís antes de las ${ficha.horario.ultimo_envio_mismo_dia} h. ${ficha.zonas.map(z => `${z.nombre}: ${pesos(z.precio)}`).join(' · ')}.`,
    `💳 ${ficha.pago}`,
  ].join('\n');
}

export function resumenParaPersona(ficha, estado, motivo, ultimo) {
  const { producto, extras, zona, total } = calcular(ficha, estado);
  return [
    `Motivo: ${motivo}`,
    estado.situacion ? `Situación: ${ficha.situaciones[estado.situacion]?.nombre}${estado.contexto ? ' — ' + estado.contexto : ''}` : null,
    estado.para ? `Para: ${estado.para}` : null,
    producto ? `Eligió: ${producto.nombre}${extras.length ? ' + ' + extras.map(e => e.nombre).join(', ') : ''} (total ${pesos(total)} con envío ${zona.nombre})` : 'Todavía no eligió producto',
    estado.notas ? `Notas: ${estado.notas}` : null,
    estado.direccion ? `Entrega: ${estado.direccion}${estado.hora_limite ? ', antes de las ' + hhmm(estado.hora_limite) : ''}` : null,
    `Último mensaje: "${ultimo}"`,
  ].filter(Boolean).join('\n');
}

// ---------- 2 y 3. Decidir y contestar ----------
// Devuelve { respuestas: [textos], pedido: datos|null, persona: motivo|null, estado }
export async function atender(ficha, estadoPrevio, historial, texto) {
  const estado = { ...estadoPrevio };
  const e = await entender(ficha, estado, historial, texto);
  const frase = fraseSegura(e.frase);
  const out = [];
  const decir = s => out.push(s);

  if (e.reclamo === true) {
    return { respuestas: ['Uh, perdón 🙏 Le paso tu reclamo ya mismo a una persona del equipo, con tu pedido a mano, para resolverlo rápido.'], persona: 'Reclamo', estado };
  }
  if (e.pide_persona) {
    return { respuestas: [FRASE_PERSONA], persona: 'El cliente pidió hablar con una persona', estado };
  }

  // Pedido ya cerrado: una charla nueva arranca de cero si cuenta otra macana.
  if (estado.pedido_id) {
    if (e.situacion && e.situacion !== estado.situacion) {
      Object.keys(estado).forEach(k => delete estado[k]);
    } else {
      return { respuestas: [`Tu pedido #${estado.pedido_id} ya está en marcha. Te aviso por acá cuando salga y cuando llegue. 🌷 Si querés mandar otro ramo, contame para quién es.`], estado };
    }
  }

  if (e.cancela && !estado.pedido_id) {
    Object.keys(estado).forEach(k => delete estado[k]);
    return { respuestas: ['Listo, lo dejamos acá. Si cambiás de idea, escribime y lo armamos en un minuto. 🌷'], estado };
  }

  // Volcar lo entendido al estado.
  if (e.situacion && !estado.producto) { estado.situacion = e.situacion; }
  if (e.gravedad && !estado.producto) estado.gravedad = Number(e.gravedad);
  if (e.para) estado.para = e.para;
  if (e.contexto && !estado.contexto) estado.contexto = e.contexto;
  if (e.nombre_cliente) estado.nombre_cliente = e.nombre_cliente;
  if (e.eleccion && (estado.opciones || estado.situacion)) estado.producto = e.eleccion;
  if (e.extras?.length) estado.extras = [...new Set([...(estado.extras || []), ...e.extras])];
  let tarjetaCambiada = false;
  const teniaTarjeta = Boolean(estado.tarjeta);
  if (estado.tarjetas && !estado.tarjeta && !e.eleccion_tarjeta) {
    // "la graciosa", "la romántica", "la de perdón" → número de tarjeta
    const tonos = TONOS[ficha.situaciones[estado.situacion]?.tono || 'calido'].map(normal);
    const i = tonos.findIndex(n => normal(texto).includes(n.split(' ')[0]));
    if (i >= 0) e.eleccion_tarjeta = i + 1;
  }
  if (e.tarjeta_propia && estado.producto) {
    tarjetaCambiada = Boolean(estado.tarjeta) && estado.tarjeta !== e.tarjeta_propia;
    estado.tarjeta = e.tarjeta_propia; // se puede dictar o cambiar en cualquier momento
  }
  if (estado.tarjetas && !estado.tarjeta) {
    if (e.sin_tarjeta) estado.tarjeta = '(sin tarjeta)';
    else if (e.eleccion_tarjeta) estado.tarjeta = estado.tarjetas[Number(e.eleccion_tarjeta) - 1];
  }
  if (estado.tarjeta || estado.producto) {
    if (e.direccion) estado.direccion = e.direccion;
    const zona = zonaDe(ficha, `${e.barrio || ''} ${e.direccion || ''} ${texto}`);
    if (zona) { estado.zona = zona.id; estado.barrio = e.barrio || zona.nombre; }
    if (e.recibe) estado.recibe = e.recibe;
    if (e.ventana) estado.ventana = e.ventana;
    if (e.notas && !(estado.notas || '').includes(e.notas)) estado.notas = [estado.notas, e.notas].filter(Boolean).join('. ');
    if (e.hora_limite) {
      const h = horaLimite(ficha, e.hora_limite);
      if (h) { estado.hora_limite = h.ms; if (h.aviso) decir(h.aviso); }
    }
  }

  if (e.catalogo && !estado.producto) {
    return { respuestas: [`Este es nuestro catálogo 🌸 ${ficha.productos.length} arreglos para cada macana. Contame qué pasó y te digo cuál conviene.`],
      imagenes: [{ archivo: 'catalogo/catalogo.jpg', texto: `Catálogo ${ficha.nombre}` }],
      botones: [{ id: 'olvido', texto: 'Me olvidé una fecha' }, { id: 'pelea', texto: 'Nos peleamos' }, { id: 'cumple', texto: 'Es un cumple' }], estado };
  }
  if (e.pregunta && e.pregunta_real) decir(respuestaPregunta(ficha));

  // Paso 1: qué pasó.
  if (!estado.situacion) {
    if (!historial.some(m => m.quien === 'flora')) {
      return { respuestas: [
        `¡Hola! Soy ${ficha.asistente}, de ${ficha.nombre} 🌹 ${ficha.lema}`,
        'Contame qué pasó y te ayudo a arreglarlo: ¿te olvidaste de una fecha, hubo una pelea, es un cumple, una despedida…?',
      ], botones: [{ id: 'olvido', texto: 'Me olvidé una fecha' }, { id: 'pelea', texto: 'Nos peleamos' }, { id: 'cumple', texto: 'Es un cumple' }], estado };
    }
    decir(frase || 'Contame un poquito más así te recomiendo bien.');
    decir('¿Para quién son las flores y qué pasó? Con eso te armo las opciones.');
    return { respuestas: out, estado };
  }

  // Paso 2: elegir.
  if (!estado.producto) {
    const ops = opcionesPara(ficha, estado);
    estado.opciones = ops.map(p => p.id);
    const serio = ficha.situaciones[estado.situacion].tono === 'serio';
    // En un duelo la apertura es siempre fija y sobria: no se arriesga una frase de la IA.
    decir(serio ? 'Lo siento mucho. Te ayudo a que llegue algo lindo y a tiempo.' : (frase || 'Tranqui, esto tiene arreglo. 🌹'));
    decir([
      serio ? 'Te sugiero estas opciones:' : 'Según el tamaño de la macana, te recomiendo:',
      ...ops.map((p, i) => `*${i + 1}.* ${p.nombre} — ${p.detalle} — *${pesos(p.precio)}*`),
      '',
      serio ? 'Tocá el que prefieras.' : `Tocá el que te guste. Si querés sumar ${ficha.extras.map(x => x.nombre.toLowerCase()).join(', ')}, escribilo.`,
    ].join('\n'));
    return { respuestas: out, estado,
      imagenes: ops.map((p, i) => ({ archivo: `catalogo/${p.id}.jpg`, texto: `*${i + 1}. ${p.nombre}* · ${pesos(p.precio)}\n${p.detalle}` })),
      botones: ops.map((p, i) => ({ id: String(i + 1), texto: `${i + 1}. ${p.corto} · ${pesos(p.precio)}`.slice(0, 25) })) };
  }

  // Paso 2b: colores (con eso la IA del evento dibuja el ramo). En un duelo no se pregunta.
  const elegido = ficha.productos.find(x => x.id === estado.producto);
  if (!estado.estilo) {
    if (ficha.situaciones[estado.situacion].tono === 'serio') estado.estilo = 'blancos y verdes, sobrio';
    else if (e.estilo) { estado.estilo = elegirEstilo(e.estilo); estado.estilo_sorpresa = /sorpren|azar|aleatori|random|da igual|lo que sea|elegi vos|cualquiera/.test(normal(e.estilo)); }
  }
  if (!estado.estilo) {
    decir(`Buenísima elección: *${elegido.nombre}*. 👌`);
    decir('¿Qué colores le gustan? Así te lo dibujo antes de armarlo 🎨 (también podés escribirme flores o colores, ej: "girasoles con algo violeta")');
    return { respuestas: out, estado, botones: [{ id: 'rojos', texto: '❤️ Rojos y pasión' }, { id: 'pastel', texto: '🌸 Rosas y pasteles' }, { id: 'sorpresa', texto: '🎲 Sorprendeme' }] };
  }

  // Paso 3: tarjeta.
  if (!estado.tarjeta) {
    if (!estado.tarjetas) {
      const { nombres, textos } = await escribirTarjetas(ficha, estado);
      estado.tarjetas = textos;
      decir(estado.estilo_sorpresa ? `🎲 Te tocó: *${estado.estilo}*. ¡Buena suerte la tuya!` : `Anotado: *${estado.estilo}* 🎨`);
      decir([
        'Te escribí la tarjeta en tres tonos:',
        ...textos.map((t, i) => `*${i + 1}. ${nombres[i][0].toUpperCase() + nombres[i].slice(1)}:* "${t}"`),
        '',
        'Tocá la que te guste, mandame tu propio texto o escribí "sin tarjeta".',
      ].join('\n'));
      return { respuestas: out, estado, botones: nombres.map((n, i) => ({ id: String(i + 1), texto: `${i + 1}. ${n[0].toUpperCase() + n.slice(1)}`.slice(0, 25) })) };
    }
    decir('Elegí la tarjeta con el número (1, 2 o 3), mandame tu texto o escribí "sin tarjeta".');
    return { respuestas: out, estado };
  }

  // Paso 4: entrega.
  const falta = [];
  if (!estado.direccion) falta.push('la dirección con el barrio');
  if (!estado.recibe) falta.push('el nombre de quien recibe');
  if (!estado.hora_limite) falta.push('antes de qué hora tiene que llegar');
  if (falta.length) {
    // Nunca repetir la misma pregunta como un loro: la segunda vez se pide con un ejemplo,
    // la tercera pasa a una persona con todo anotado.
    const pregunta = falta.join('|');
    estado.repreguntas = estado.ultima_pregunta === pregunta ? (estado.repreguntas || 0) + 1 : 0;
    estado.ultima_pregunta = pregunta;
    if (tarjetaCambiada) decir(`Listo, cambié la tarjeta: "${estado.tarjeta}" ✍️`);
    const anotado = [estado.direccion && `dirección: ${estado.direccion}`, estado.recibe && `recibe: ${estado.recibe}`,
      estado.hora_limite && `llega ${cuando(estado.hora_limite)}`].filter(Boolean);
    if (estado.repreguntas >= 2) {
      return { respuestas: [`Perdón, me estoy enredando 🙏 ${FRASE_PERSONA}`], persona: 'Flora no logró entender un dato de la entrega', estado };
    }
    if (falta.length === 3 || (!teniaTarjeta && estado.tarjeta)) decir('¡Tarjeta lista! ✍️ Ahora la entrega.');
    else if (anotado.length && !tarjetaCambiada) decir(`Anotado ✅ ${anotado.join(' · ')}.`);
    const ejemplo = { 'la dirección con el barrio': 'Mendoza 1500, Echesortu', 'el nombre de quien recibe': 'recibe Julieta', 'antes de qué hora tiene que llegar': 'antes de las 15' };
    decir(estado.repreguntas === 1
      ? `Me falta ${falta.join(', ').replace(/, ([^,]*)$/, ' y $1')}. Escribilo así, por ejemplo: "${falta.map(f => ejemplo[f]).join(', ')}".`
      : `Pasame ${falta.join(', ').replace(/, ([^,]*)$/, ' y $1')}.`);
    return { respuestas: out, estado };
  }
  estado.repreguntas = 0;

  // Paso 5: confirmar.
  const { producto, extras, zona, total } = calcular(ficha, estado);
  if (!estado.mostro_resumen || !e.confirma) {
    estado.mostro_resumen = true;
    decir([
      '*Tu pedido* 🌹',
      `• ${producto.nombre}: ${pesos(producto.precio)}`,
      ...extras.map(x => `• ${x.nombre}: ${pesos(x.precio)}`),
      `• Envío ${zona.nombre}: ${pesos(zona.precio)}`,
      `*Total: ${pesos(total)}*`,
      '',
      `Para: ${estado.recibe} — ${estado.direccion}`,
      `Llega ${cuando(estado.hora_limite)}${estado.ventana ? ` (está ${estado.ventana})` : ""}`,
      `Tarjeta: "${estado.tarjeta}"`,
      ...(estado.notas ? [`Nota: ${estado.notas}`] : []),
      '',
      '¿Lo confirmo?',
    ].join('\n'));
    return { respuestas: out, estado, botones: [{ id: 'si', texto: '✅ Confirmar pedido' }, { id: 'persona', texto: '🙋 Hablar con alguien' }] };
  }

  const datos = {
    situacion: ficha.situaciones[estado.situacion].nombre,
    contexto: estado.contexto || null,
    para: estado.para || null,
    producto: producto.nombre,
    extras: extras.map(x => x.nombre),
    tarjeta: estado.tarjeta,
    direccion: estado.direccion,
    zona: zona.nombre,
    envio: zona.precio,
    recibe: estado.recibe,
    ventana: estado.ventana || null,
    notas: estado.notas || null,
    cliente: estado.nombre_cliente || null,
    tono: ficha.situaciones[estado.situacion].tono,
  };
  return {
    respuestas: [],
    pedido: { datos, total, hora_limite: estado.hora_limite },
    estado,
  };
}

export function textoPedidoCreado(ficha, id, total, tono) {
  return [
    `¡Listo! Pedido *#${id}* confirmado. ${tono === 'serio' ? '🤍' : '🎉'}`,
    `Para pagar los ${pesos(total)}: transferencia al alias *${ficha.alias_pago}* o efectivo al recibir.`,
    'Te aviso por acá cuando lo estemos armando, cuando salga y cuando llegue.',
  ].join('\n');
}

export function textoCambioEstado(ficha, p) {
  const serio = p.datos.tono === 'serio';
  switch (p.estado) {
    case 'preparando': return `🌹 Ya estamos armando tu pedido #${p.id}.`;
    case 'listo': return `✨ Tu pedido #${p.id} está listo y sale en un ratito.`;
    case 'en_camino': return `🛵 Tu pedido #${p.id} salió para ${p.datos.direccion}.`;
    case 'entregado': return serio ? `🤍 Pedido #${p.id} entregado. Te acompañamos.` : `✅ ¡Entregado! ${p.datos.recibe} ya tiene sus flores. Suerte 🍀`;
    case 'cancelado': return `Tu pedido #${p.id} quedó cancelado. Si fue un error, escribinos.`;
    default: return null;
  }
}
