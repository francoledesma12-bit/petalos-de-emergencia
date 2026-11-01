// La API que dio el evento (formato OpenAI): dibuja el ramo con su tarjeta y pasa audios a texto.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const CLAVE = process.env.EVENTO_IA_CLAVE || '';
const BASE = (process.env.EVENTO_IA_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODELO_IMAGEN = process.env.EVENTO_IMAGEN_MODELO || 'gpt-image-2';
const MODELO_AUDIO = process.env.EVENTO_AUDIO_MODELO || 'gpt-4o-mini-transcribe';

export const eventoActivo = () => Boolean(CLAVE);

// Ilustración del ramo con la tarjeta escrita. Devuelve el nombre del archivo guardado o null.
export async function dibujarRamo({ id, producto, detalle, extras = [], tarjeta, tono, estilo }, carpeta) {
  if (!CLAVE) return null;
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
  try {
    const r = await fetch(`${BASE}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLAVE}` },
      body: JSON.stringify({ model: MODELO_IMAGEN, prompt, size: '1024x1024', quality: 'medium', n: 1 }),
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json();
    const b64 = j.data?.[0]?.b64_json;
    if (!r.ok || !b64) { console.error('[evento] imagen falló', r.status, j.error?.message); return null; }
    await mkdir(carpeta, { recursive: true });
    const archivo = `ramo-${id}-${Date.now().toString(36)}.png`;
    await writeFile(join(carpeta, archivo), Buffer.from(b64, 'base64'));
    return archivo;
  } catch (e) {
    console.error('[evento] imagen error:', e.message);
    return null;
  }
}

// Tarjeta de agradecimiento para quien compró, con su nombre y el número de pedido.
export async function dibujarAgradecimiento({ id, nombre, estilo, tono, negocio }, carpeta) {
  if (!CLAVE) return null;
  const prompt = [
    `Tarjeta de agradecimiento elegante y moderna de la florería "${negocio}", formato cuadrado, diseño editorial.`,
    `Texto principal grande, en español y perfectamente legible: "¡Gracias${nombre ? ', ' + nombre : ''}!".`,
    `Debajo, en letra más chica: "Gracias por elegir ${negocio}" y "Pedido #${id}".`,
    `Decorada con una ilustración delicada de flores en ${estilo || 'tonos bordó y crema'}${tono === 'serio' ? ', estilo sobrio y respetuoso' : ''}.`,
    'Fondo crema, detalles en bordó, mucho aire, sin otros textos, sin logos de marcas.',
  ].join(' ');
  try {
    const r = await fetch(`${BASE}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLAVE}` },
      body: JSON.stringify({ model: MODELO_IMAGEN, prompt, size: '1024x1024', quality: 'medium', n: 1 }),
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json();
    const b64 = j.data?.[0]?.b64_json;
    if (!r.ok || !b64) { console.error('[evento] agradecimiento falló', r.status, j.error?.message); return null; }
    await mkdir(carpeta, { recursive: true });
    const archivo = `ramo-${id}-gracias${Date.now().toString(36)}.png`;
    await writeFile(join(carpeta, archivo), Buffer.from(b64, 'base64'));
    return archivo;
  } catch (e) {
    console.error('[evento] agradecimiento error:', e.message);
    return null;
  }
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
