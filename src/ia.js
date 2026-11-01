// Conexión con Claude. Si no hay clave o falla, devuelve null y el cerebro sigue con reglas.
import Anthropic from '@anthropic-ai/sdk';

const MODELO = process.env.IA_MODELO || 'claude-opus-5-5';
const cliente = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 20000, maxRetries: 1 }) : null;

export const iaActiva = () => Boolean(cliente);

export async function pedirJSON(sistema, usuario, { maxTokens = 2000 } = {}) {
  if (!cliente) return null;
  try {
    const r = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: maxTokens,
      output_config: { effort: 'low' }, // respuestas cortas y rápidas
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // si el modelo declina, otro modelo contesta en la misma llamada
      system: sistema,
      messages: [{ role: 'user', content: usuario }],
    });
    if (r.stop_reason === 'refusal') return null;
    const texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const inicio = texto.indexOf('{');
    const fin = texto.lastIndexOf('}');
    if (inicio < 0 || fin < inicio) return null;
    return JSON.parse(texto.slice(inicio, fin + 1));
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.error('[ia] la clave de Claude no es válida');
    else if (e instanceof Anthropic.RateLimitError) console.error('[ia] demasiados pedidos a Claude, sigo con reglas');
    else if (e instanceof Anthropic.APIError) console.error(`[ia] Claude respondió ${e.status}:`, e.message);
    else console.error('[ia] falló:', e.message);
    return null;
  }
}
