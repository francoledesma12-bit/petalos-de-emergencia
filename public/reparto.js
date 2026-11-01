const $ = selector => document.querySelector(selector);
const routes = {dueno:'/panel', taller:'/taller', reparto:'/reparto'};
let loading = false;
function node(tag, className, value) { const n = document.createElement(tag); if (className) n.className = className; if (value != null) n.textContent = String(value); return n; }
function error(message) { $('#error').textContent = message || ''; $('#error').hidden = !message; }
async function api(path, options) { const response = await fetch(path, {credentials:'same-origin',...options}); const data = await response.json().catch(()=>({})); if (!response.ok) {const e = new Error(data.error || 'No se pudo conectar.'); e.status=response.status; throw e;} return data; }
function deadline(value) { if (!value) return 'Sin hora indicada'; const d = new Date(value); if (Number.isNaN(d.getTime())) return String(value); return `Entregar ${d.toLocaleString('es-AR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`; }
function mapsUrl(address) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${address}, Rosario, Argentina`); }
function safeMap(value) { try { const u = new URL(value); return u.protocol==='https:' && (u.hostname==='google.com' || u.hostname.endsWith('.google.com') || u.hostname==='maps.app.goo.gl') ? u.href : ''; } catch { return ''; } }
function stop(p, index) {
  const d=p.datos||{}, c=node('article','stop-card'); const top=node('div','stop-top'); top.append(node('span','stop-number',`PARADA ${index+1} · #${p.id}`),node('span','deadline',deadline(p.hora_limite))); c.append(top);
  c.append(node('h3','',d.recibe || 'Persona por confirmar'));
  c.append(node('p','address',d.direccion || d.zona || 'Dirección pendiente'));
  if (d.zona && d.direccion) c.append(node('p','',d.zona));
  c.append(node('p','',d.producto || 'Pedido floral'));
  const actions=node('div','stop-actions');
  if (d.direccion) {const link=node('a','','Cómo llegar ↗'); link.href=mapsUrl(d.direccion); link.target='_blank'; link.rel='noopener noreferrer'; actions.append(link);}
  const next=p.estado==='listo'?'en_camino':'entregado'; const b=node('button','primary-button',next==='en_camino'?'Salgo con este pedido →':'Marcar entregado ✓'); b.type='button';
  b.addEventListener('click',async()=>{b.disabled=true;error('');try{await api(`/api/pedidos/${encodeURIComponent(p.id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({estado:next})});await refresh();}catch(e){error(e.message);b.disabled=false;}});
  actions.append(b); c.append(actions); return c;
}
async function refresh() {
  if (loading) return; loading=true;
  try {const data=await api('/api/reparto'), orders=Array.isArray(data.pedidos)?data.pedidos:[], route=data.ruta||{}; const box=$('#route-box'), link=$('#map-link'); box.hidden=!orders.length; $('#route-explanation').textContent=route.explicacion||'Seguí el orden sugerido y confirmá cada parada.'; const map=safeMap(route.mapa); link.hidden=!map; if(map) link.href=map; const stops=$('#stops'); stops.replaceChildren(); if(orders.length) stops.append(...orders.map(stop)); else stops.append(node('div','empty','Todavía no hay entregas listas para salir.')); error('');}
  catch(e){if(e.status===401){location.replace('/panel');return;}error(e.message);}finally{loading=false;}
}
$('#refresh').addEventListener('click',refresh);
(async()=>{try{const who=await api('/api/yo');if(who.rol!=='reparto'&&who.rol!=='dueno'){location.replace(routes[who.rol]||'/panel');return;}await refresh();const events=new EventSource('/api/eventos');events.addEventListener('tablero',refresh);setInterval(refresh,30000);}catch{location.replace('/panel');}})();
