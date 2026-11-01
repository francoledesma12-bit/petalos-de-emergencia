// La API que dio el evento (formato OpenAI): dibuja el ramo, la tarjeta de agradecimiento y pasa audios a texto.
// Las imágenes van en una fila (pocas a la vez) para aguantar muchos pedidos simultáneos sin saturar la API,
// que además comparten todos los equipos del evento.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const CLAVE = process.env.EVENTO_IA_CLAVE || '';
const BASE = (process.env.EVENTO_IA_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODELO_IMAGEN = process.env.EVENTO_IMAGEN_MODELO || 'gpt-image-2';
const MODELO_AUDIO = process.env.EVENTO_AUDIO_MODELO || 'gpt-4o-mini-transcribe';
const A_LA_VEZ = Number(process.env.EVENTO_IMAGENES_A_LA_VEZ || 4);

export const eventoActivo = () => Boolean(CLAVE);

// ---------- Fila de imágenes ----------
let enCurso = 0;
const espera = [];
export const filaDeImagenes = () => ({ enCurso, esperando: espera.length });

async function turno(tarea) {
  if (enCurso >= A_LA_VEZ) await new Promise(r => espera.push(r));
  enCurso++;
  try { return await tarea(); } finally { enCurso--; espera.shift()?.(); }
}

async function generar(prompt, archivo, carpeta) {
  if (!CLAVE) return null;
  return turno(async () => {
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const r = await fetch(`${BASE}/images/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLAVE}` },
          body: JSON.stringify({ model: MODELO_IMAGEN, prompt, size: '1024x1024', quality: 'medium', n: 1 }),
          signal: AbortSignal.timeout(120000),
        });
        const j = await r.json().catch(() => ({}));
        const b64 = j.data?.[0]?.b64_json;
        if (r.ok && b64) {
          await mkdir(carpeta, { recursive: true });
          await writeFile(join(carpeta, archivo), Buffer.from(b64, 'base64'));
          return archivo;
        }
        console.error(`[evento] imagen falló (intento ${intento})`, r.status, j.error?.message);
        if (r.status !== 429 && r.status < 500) return null; // error del pedido: no tiene sentido reintentar
      } catch (e) {
        console.error(`[evento] imagen error (intento ${intento}):`, e.message);
      }
      await new Promise(r => setTimeout(r, intento * 6000)); // la API está ocupada: esperar y reintentar
    }
    return null;
  });
}

const sello = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// Ilustración del ramo con la tarjeta escrita, fiel a lo pedido. Devuelve el nombre del archivo o null.
export function dibujarRamo({ id, detalle, extras = [], tarjeta, tono, estilo }, carpeta) {
  const serio = tono === 'serio';
  // El nombre comercial del ramo NO va al dibujo (con "Dormí en el Sillón" dibujaba un sillón).
  const tamano = /24|corona|caja/i.test(detalle) ? 'grande y abundante' : /6 |suculenta|cesta/i.test(detalle) ? 'chico y delicado' : 'mediano';
  const prompt = [
    `Fotografía de producto, estilo editorial cálido, de un arreglo floral ${tamano} de una florería boutique.`,
    `El arreglo es exactamente: ${detalle} (respetá la cantidad, el tipo de flor y el envoltorio).`,
    estilo ? `El cliente pidió: "${estilo}". Si nombró flores, usá esas flores; si solo nombró colores, mantené el tipo y la cantidad del arreglo pero en esos colores. Que se vea fiel a lo pedido.` : '',
    extras.length ? `Al lado del ramo, bien visibles: ${extras.join(', ')}.` : '',
    tarjeta && tarjeta !== '(sin tarjeta)'
      ? `Apoyada en el ramo, una tarjeta de papel crema SIN dibujos, solo con este texto escrito a mano en tinta bordó, en español, legible y completo: "${tarjeta}".`
      : '',
    serio ? 'Clima sobrio y respetuoso, luz suave, fondo neutro.' : 'Luz natural de tarde, fondo crema liso, sensación de regalo especial.',
    'Sin logos, sin marcas, sin personas, sin texto extra fuera de la tarjeta.',
  ].join(' ');
  return generar(prompt, `ramo-${id}-${sello()}.png`, carpeta);
}

// Tarjeta de agradecimiento para quien compró, con TODO el pedido y un diseño distinto cada vez.
const DISENOS = [
  'acuarela suave con manchas de color y tipografía serif elegante',
  'editorial minimalista, mucho aire, tipografía fina y líneas doradas',
  'botánico vintage, como lámina antigua de herbario, papel envejecido',
  'art déco con marcos geométricos dorados y tipografía display',
  'papel kraft con sello de lacre y etiqueta escrita a mano',
  'collage moderno de flores recortadas sobre fondo de color pleno',
  'ilustración de línea continua con acentos de color',
  'estilo ticket de florería boutique, tipográfico y prolijo, con un ramo pequeño ilustrado',
];

export function dibujarAgradecimiento({ id, nombre, negocio, producto, estilo, extras = [], recibe, entrega, total, tarjeta, tono }, carpeta) {
  const diseno = tono === 'serio' ? 'sobrio y respetuoso, blancos y verdes, tipografía serif clásica' : DISENOS[Math.floor(Math.random() * DISENOS.length)];
  const lineas = [
    `Ramo: ${producto}`,
    estilo ? `Flores y colores: ${estilo}` : null,
    extras.length ? `Extras: ${extras.join(', ')}` : null,
    recibe ? `Para: ${recibe}` : null,
    entrega ? `Entrega: ${entrega}` : null,
    total ? `Total: ${total}` : null,
  ].filter(Boolean);
  const frase = tarjeta && tarjeta !== '(sin tarjeta)' ? tarjeta.slice(0, 90) : null;
  const prompt = [
    `Tarjeta de agradecimiento cuadrada de la florería "${negocio}". Estilo de diseño: ${diseno}.`,
    `Título grande, en español y perfectamente legible: "¡Gracias${nombre ? ', ' + nombre : ''}!" y debajo "Gracias por elegir ${negocio} · Pedido #${id}".`,
    `Incluí un recuadro prolijo con el resumen del pedido, cada línea exactamente así, sin cambiar ni agregar nada:`,
    ...lineas.map(l => `• ${l}`),
    frase ? `Y una cita corta en cursiva con el mensaje de la tarjeta: "${frase}".` : '',
    `Decorada con una ilustración de flores en ${estilo || 'tonos bordó y crema'}.`,
    'Todo el texto en español, bien escrito y legible. Sin logos ni marcas.',
  ].join('\n');
  return generar(prompt, `ramo-${id}-gracias${sello()}.png`, carpeta);
}

// Audio de WhatsApp → texto (español).
export async function pasarATexto(url) {
  if (!CLAVE || !url) return null;
  try {
    const audio = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!audio.ok) return null;
    const form = new FormData();
    form.append('file', new Blob([await audio.arrayBuffer()], { type: 'audio/ogg' }), 'audio.ogg');
    form.append('model', MODELO_AUDIO);
    form.append('language', 'es');
    const r = await fetch(`${BASE}/audio/transcriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${CLAVE}` }, body: form, signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    if (!r.ok) { console.error('[evento] audio falló', r.status, j.error?.message); return null; }
    return (j.text || '').trim() || null;
  } catch (e) {
    console.error('[evento] audio error:', e.message);
    return null;
  }
}
