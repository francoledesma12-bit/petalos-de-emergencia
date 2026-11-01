// WhatsApp por GREEN-API. Recibe por aviso (webhook) y, si no hay aviso
// configurado, puede ir a buscar los mensajes cada pocos segundos.
const API = (process.env.WA_API_URL || 'https://api.green-api.com').replace(/\/$/, '');
const INSTANCIA = process.env.WA_INSTANCIA || '';
const TOKEN = process.env.WA_TOKEN || '';

export const waActivo = () => Boolean(INSTANCIA && TOKEN);
const base = () => `${API}/waInstance${INSTANCIA}`;

async function llamar(metodo, cuerpo) {
  try {
    const r = await fetch(`${base()}/${metodo}/${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (!r.ok) console.error(`[wa] ${metodo} falló`, r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) {
    console.error(`[wa] ${metodo} error:`, e.message);
    return false;
  }
}

// Texto simple, o con hasta 3 botones de respuesta. Si los botones fallan, va como texto.
export async function enviar(chatId, texto, botones = []) {
  if (!waActivo()) return false;
  if (botones.length) {
    const ok = await llamar('sendInteractiveButtonsReply', {
      chatId, body: texto, footer: 'Pétalos de Emergencia',
      buttons: botones.slice(0, 3).map(b => ({ buttonId: b.id, buttonText: b.texto.slice(0, 25) })),
    });
    if (ok) return true;
  }
  return llamar('sendMessage', { chatId, message: texto });
}

// Botones de acción (abrir un enlace, llamar). Se usan en los avisos al dueño.
export async function enviarConAcciones(chatId, texto, acciones) {
  if (!waActivo()) return false;
  const ok = await llamar('sendInteractiveButtons', {
    chatId, body: texto,
    buttons: acciones.slice(0, 3).map((a, i) => ({ buttonId: String(i + 1), buttonText: a.texto.slice(0, 25), type: a.tipo,
      ...(a.tipo === 'url' ? { url: a.valor } : a.tipo === 'call' ? { phoneNumber: a.valor } : { copyCode: a.valor }) })),
  });
  return ok || llamar('sendMessage', { chatId, message: texto });
}

// Imagen con epígrafe (el archivo tiene que estar publicado en internet).
export function imagen(chatId, url, epigrafe) {
  if (!waActivo()) return Promise.resolve(false);
  return llamar('sendFileByUrl', { chatId, urlFile: url, fileName: url.split('/').pop(), caption: epigrafe });
}

// GREEN-API envía el MP3 como audio reproducible dentro de WhatsApp.
export function audio(chatId, url) {
  if (!waActivo()) return Promise.resolve(false);
  return llamar('sendFileByUrl', { chatId, urlFile: url, fileName: url.split('/').pop(), caption: '' });
}

// "Escribiendo…" mientras Flora piensa.
export function escribiendo(chatId, ms = 3000) {
  if (waActivo()) llamar('sendTyping', { chatId, typingTime: Math.min(20000, Math.max(1000, ms)) });
}

export function ubicacion(chatId, { nombre, direccion, lat, lng }) {
  if (waActivo()) return llamar('sendLocation', { chatId, nameLocation: nombre, address: direccion, latitude: lat, longitude: lng });
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
    case 'templateButtonsReplyMessage': return m.templateButtonReplyMessage?.selectedDisplayText || m.templateButtonsReplyMessage?.selectedDisplayText || '';
    case 'interactiveButtonsResponse': return m.interactiveButtonsResponse?.selectedDisplayText || '';
    case 'listResponseMessage': return m.listResponseMessage?.title || '';
    case 'imageMessage': return m.fileMessageData?.caption || '[foto]';
    case 'audioMessage': return '[audio]';
    default: return '';
  }
}

// Convierte el aviso de GREEN-API en { tipo, chatId, nombre, texto } o null si no hay nada que hacer.
// tipo 'entrante' = escribió un cliente; 'saliente' = alguien contestó a mano desde el celular de la línea.
export function leerAviso(aviso) {
  const tipo = aviso?.typeWebhook === 'incomingMessageReceived' ? 'entrante'
    : aviso?.typeWebhook === 'outgoingMessageReceived' ? 'saliente' : null;
  if (!tipo) return null;
  const chatId = aviso.senderData?.chatId || '';
  if (!chatId.endsWith('@c.us')) return null; // grupos y difusiones no se atienden
  const loc = aviso.messageData?.locationMessageData;
  if (tipo === 'entrante' && loc && Number.isFinite(loc.latitude)) return { tipo: 'ubicacion', chatId, lat: loc.latitude, lng: loc.longitude };
  if (tipo === 'entrante' && aviso.messageData?.typeMessage === 'audioMessage') {
    return { tipo: 'audio', chatId, nombre: aviso.senderData?.senderName || '', url: aviso.messageData.fileMessageData?.downloadUrl || '' };
  }
  const texto = textoDe(aviso.messageData).trim();
  if (!texto) return null;
  return { tipo, chatId, nombre: tipo === 'entrante' ? (aviso.senderData?.senderName || aviso.senderData?.chatName || '') : '', texto };
}

// Número de WhatsApp (solo dígitos) → chatId de GREEN-API.
export const chatDe = numero => (numero || '').replace(/\D/g, '') ? `${numero.replace(/\D/g, '')}@c.us` : '';

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
