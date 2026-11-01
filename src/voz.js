// Respuestas de voz para los audios de WhatsApp. La clave nunca llega al navegador.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const CLAVE = process.env.ELEVENLABS_API_KEY || '';
const VOZ = process.env.ELEVENLABS_VOICE_ID || '';
const MODELO = process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5';

export const vozActiva = () => Boolean(CLAVE && VOZ);

export async function sintetizar(texto, carpeta) {
  if (!vozActiva() || !texto?.trim()) return null;
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOZ)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': CLAVE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto.replace(/\*([^*]+)\*/g, '$1').replace(/[🌷🌹💐✅💳🧸🍫🎈]/gu, '').slice(0, 3000), model_id: MODELO }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { console.error('[voz] ElevenLabs falló', r.status, (await r.text()).slice(0, 200)); return null; }
    const audio = Buffer.from(await r.arrayBuffer());
    if (!audio.length || audio.length > 12 * 1024 * 1024) return null;
    await mkdir(carpeta, { recursive: true });
    const archivo = `flora-${randomUUID()}.mp3`;
    await writeFile(join(carpeta, archivo), audio);
    return archivo;
  } catch (e) {
    console.error('[voz] error:', e.message);
    return null;
  }
}
