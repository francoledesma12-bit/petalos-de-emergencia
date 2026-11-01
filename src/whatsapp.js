// WhatsApp por GREEN-API. Recibe por aviso (webhook) y, si no hay aviso
// configurado, puede ir a buscar los mensajes cada pocos segundos.
const API = (process.env.WA_API_URL || 'https://api.green-api.com').replace(/\/$/, '');
const INSTANCIA = process.env.WA_INSTANCIA || '';
const TOKEN = process.env.WA_TOKEN || '';

export const waActivo = () => Boolean(INSTANCIA && TOKEN);
const base = () => `${API}/waInstance${INSTANCIA}`;

export async function enviar(chatId, texto) {
  if (!waActivo()) return false;
  try {
    const r = await fetch(`${base()}/sendMessage/${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message: texto }),
    });
    if (!r.ok) console.error('[wa] no se pudo enviar', r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) {
    console.error('[wa] error al enviar:', e.message);
    return false;
  }
}

export async function estado() {
  if (!waActivo()) return 'sin_configurar';
  try {
    const r = await fetch(`${base()}/getStateInstance/${TOKEN}`);
    return (await r.json()).stateInstance || 'desconocido';
  } catch {
    return 'sin_respuesta';
  }
}

// Saca el texto de cualquier tipo de mensaje que manda GREEN-API.
function textoDe(m = {}) {
  switch (m.typeMessage) {
    case 'textMessage': return m.textMessageData?.textMessage || '';
    case 'extendedTextMessage': return m.extendedTextMessageData?.text || '';
    case 'quotedMessage': return m.extendedTextMessageData?.text || '';
    case 'editedMessage': return m.editedMessageData?.textMessage || '';
    case 'buttonsResponseMessage': return m.buttonsResponseMessage?.selectedButtonText || '';
    case 'listResponseMessage': return m.listResponseMessage?.title || '';
    case 'imageMessage': return m.fileMessageData?.caption || '[foto]';
    case 'audioMessage': return '[audio]';
    default: return '';
  }
}

// Convierte el aviso de GREEN-API en { chatId, nombre, texto } o null si no es para atender.
export function leerAviso(aviso) {
  if (aviso?.typeWebhook !== 'incomingMessageReceived') return null;
  const chatId = aviso.senderData?.chatId || '';
  if (!chatId.endsWith('@c.us')) return null; // grupos y difusiones no se atienden
  const texto = textoDe(aviso.messageData).trim();
  if (!texto) return null;
  return { chatId, nombre: aviso.senderData?.senderName || aviso.senderData?.chatName || '', texto };
}

// Modo "ir a buscar": útil cuando la línea todavía no tiene la dirección del aviso cargada.
export async function buscarMensajes(alRecibir) {
  if (!waActivo()) return;
  for (;;) {
    try {
      const r = await fetch(`${base()}/receiveNotification/${TOKEN}?receiveTimeout=20`);
      const n = r.ok ? await r.json() : null;
      if (n?.receiptId) {
        await fetch(`${base()}/deleteNotification/${TOKEN}/${n.receiptId}`, { method: 'DELETE' });
        const m = leerAviso(n.body);
        if (m) alRecibir(m);
        continue;
      }
    } catch (e) {
      console.error('[wa] error buscando mensajes:', e.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}
