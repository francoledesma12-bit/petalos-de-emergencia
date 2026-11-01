const $ = selector => document.querySelector(selector);
const routes = {dueno:'/panel', taller:'/taller', reparto:'/reparto'};
let loading = false;
function node(tag, className, value) { const n = document.createElement(tag); if (className) n.className = className; if (value != null) n.textContent = String(value); return n; }
function error(message) { $('#error').textContent = message || ''; $('#error').hidden = !message; }
async function api(path, options) { const response = await fetch(path, { credentials:'same-origin', ...options }); const data = await response.json().catch(() => ({})); if (!response.ok) { const e = new Error(data.error || 'No se pudo conectar.'); e.status = response.status; throw e; } return data; }
function deadline(value) { if (!value) return 'Sin hora indicada'; const d = new Date(value); if (Number.isNaN(d.getTime())) return String(value); return `Entrega ${d.toLocaleString('es-AR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`; }
function extras(value) { if (!value) return ''; if (Array.isArray(value)) return value.join(', '); return typeof value === 'object' ? Object.values(value).filter(Boolean).join(', ') : String(value); }
function card(p) {
  const d = p.datos || {}, c = node('article','work-card');
  const top = node('div','work-top'); top.append(node('span','',`PEDIDO #${p.id}`),node('span','deadline',deadline(p.hora_limite))); c.append(top);
  c.append(node('h3','',d.producto || 'Ramo por confirmar'));
  const extra = extras(d.extras); if (extra) c.append(node('p','extras',`Agregar: ${extra}`));
  if (d.recibe) c.append(node('p','',`Recibe: ${d.recibe}`));
  c.append(node('span','card-label','TEXTO DE LA TARJETA'));
  c.append(node('div','card-text',d.tarjeta || 'Sin texto de tarjeta'));
  if (d.tono) c.append(node('p','extras',`Tono: ${d.tono}`));
  const next = p.estado === 'nuevo' ? 'preparando' : 'listo';
  const b = node('button','primary-button',p.estado === 'nuevo' ? 'Empezar a armar →' : 'Listo para salir →'); b.type = 'button';
  b.addEventListener('click', async () => { b.disabled = true; error(''); try { await api(`/api/pedidos/${encodeURIComponent(p.id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({estado:next})}); await refresh(); } catch (e) { error(e.message); b.disabled = false; } });
  c.append(b); return c;
}
async function refresh() {
  if (loading) return; loading = true;
  try { const data = await api('/api/taller'); const orders = Array.isArray(data.pedidos) ? data.pedidos : []; const fresh = orders.filter(p=>p.estado==='nuevo'), working = orders.filter(p=>p.estado==='preparando');
    $('#nuevos').textContent = fresh.length; $('#preparando').textContent = working.length;
    for (const [selector,list,empty] of [['#lista-nuevo',fresh,'Todavía no hay pedidos nuevos.'],['#lista-preparando',working,'Nada en preparación por ahora.']]) { const target = $(selector); target.replaceChildren(); if (list.length) target.append(...list.map(card)); else target.append(node('div','empty',empty)); }
    error('');
  } catch (e) { if (e.status===401) { location.replace('/panel'); return; } error(e.message); } finally { loading = false; }
}
$('#refresh').addEventListener('click',refresh);
(async()=>{try { const who = await api('/api/yo'); if (who.rol !== 'taller' && who.rol !== 'dueno') { location.replace(routes[who.rol] || '/panel'); return; } await refresh(); const events = new EventSource('/api/eventos'); events.addEventListener('tablero',refresh); setInterval(refresh,30000); } catch { location.replace('/panel'); }})();
