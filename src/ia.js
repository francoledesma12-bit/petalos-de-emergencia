// Conexión con la inteligencia artificial. Funciona con cualquier servicio
// compatible con el formato de chat de OpenAI (se configura con 3 variables).
// Si no hay IA configurada o falla, devuelve null y el cerebro sigue con reglas.
const URL_IA = (process.env.IA_URL || '').replace(/\/$/, '');
const CLAVE = process.env.IA_CLAVE || '';
const MODELO = process.env.IA_MODELO || '';

export const iaActiva = () => Boolean(URL_IA && CLAVE && MODELO);

export async function pedirJSON(sistema, usuario, { maxTokens = 600, segundos = 15 } = {}) {
  if (!iaActiva()) return null;
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), segundos * 1000);
  try {
    const r = await fetch(`${URL_IA}/chat/completions`, {
      method: 'POST',
      signal: control.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLAVE}` },
      body: JSON.stringify({
        model: MODELO,
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
      }),
    });
    if (!r.ok) {
      console.error('[ia] respuesta', r.status, (await r.text()).slice(0, 300));
      return null;
    }
    const j = await r.json();
    const texto = j.choices?.[0]?.message?.content || '';
    const inicio = texto.indexOf('{');
    const fin = texto.lastIndexOf('}');
    if (inicio < 0 || fin < inicio) return null;
    return JSON.parse(texto.slice(inicio, fin + 1));
  } catch (e) {
    console.error('[ia] falló:', e.name === 'AbortError' ? 'tardó demasiado' : e.message);
    return null;
  } finally {
    clearTimeout(corte);
  }
}
