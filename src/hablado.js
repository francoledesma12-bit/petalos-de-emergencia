// Versión hablada de una respuesta de Flora: corta, clara y con la pregunta del paso.
// Claude la reescribe; el código controla que no cambie ningún número ni precio.
import { pedirJSON } from './ia.js';

const limpiar = s => s.replace(/[*_~]/g, '').replace(/\p{Extended_Pictographic}|️/gu, '').replace(/[ \t]+/g, ' ').trim();
const numeros = s => (s.replace(/(\d)\.(\d{3})/g, '$1$2').match(/\d+/g) || []);

// Respaldo sin IA: la primera oración y la última pregunta.
function corta(texto) {
  const t = limpiar(texto).replace(/\n+/g, ' ');
  const oraciones = t.match(/[^.!?¿¡]*[.!?]+|¿[^?]*\?/g) || [t];
  const pregunta = [...oraciones].reverse().find(o => o.includes('?'));
  const primera = oraciones[0];
  return [primera, pregunta && pregunta !== primera ? pregunta : null].filter(Boolean).join(' ').slice(0, 300);
}

export async function versionHablada(texto, historial = []) {
  const charla = historial.slice(-6).map(m => `${m.quien}: ${m.texto}`).join('\n');
  const ia = await pedirJSON('Respondés solo JSON válido.', [
    'Sos Flora, vendedora de una florería, y vas a decir este mensaje en una nota de voz de WhatsApp.',
    'Reescribilo para decirlo en voz alta: 1 o 2 oraciones (máximo 35 palabras), claro, cálido y profesional, en español rioplatense.',
    'Reglas: sin emojis, sin listas, sin ejemplos ni opciones de relleno, UNA sola pregunta al final (no la repitas con otras palabras). No agregues ni cambies datos.',
    'Si hay opciones con precio, nombralas cortas con su precio en miles (ej: "el Sillón a 52 mil"). Terminá con la pregunta de lo que falta.',
    charla ? `Charla reciente (para no perder el hilo):\n${charla}` : '',
    `Mensaje escrito:\n"""${texto}"""`,
    'JSON: {"audio":"..."}',
  ].join('\n'), { maxTokens: 1500 });
  const audio = typeof ia?.audio === 'string' ? limpiar(ia.audio) : '';
  // Control: todo número del audio tiene que estar en el mensaje original (en miles o completo).
  const originales = numeros(texto);
  const valido = audio && audio.length <= 400 && numeros(audio).every(n => originales.some(o => o === n || o === `${n}000` || o.startsWith(n)));
  return valido ? audio : corta(texto);
}
