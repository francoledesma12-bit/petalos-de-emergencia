// Prueba de punta a punta: una charla completa por el chat web y el panel.
// Uso: node probar.js [direccion]   (por defecto http://localhost:3000)
const BASE = process.argv[2] || 'http://localhost:3000';
const sesion = 'prueba-' + Date.now();

async function decir(texto) {
  const r = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sesion, texto }) });
  const j = await r.json();
  console.log(`\n🙋 ${texto}`);
  for (const t of j.respuestas || [j.error]) console.log(`🌹 ${t.replace(/\n/g, '\n   ')}`);
  return j;
}

await decir('hola');
await decir('me olvidé del aniversario con Caro y está furiosa');
await decir('la 2 con bombones');
await decir('la 2');
await decir('Bv Oroño 1200, Centro, recibe Carolina, antes de las 19');
const fin = await decir('sí, dale');

const entrar = await fetch(`${BASE}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: process.env.PANEL_CLAVE || 'flores' }) });
const cookie = entrar.headers.get('set-cookie')?.split(';')[0];
const tablero = await (await fetch(`${BASE}/api/tablero`, { headers: { cookie } })).json();
const ultimo = tablero.pedidos.at(-1);
console.log('\n📋 Panel:', tablero.hoy, ultimo && { id: ultimo.id, estado: ultimo.estado, total: ultimo.total, producto: ultimo.datos.producto });
const ok = fin.respuestas?.some(t => t.includes('confirmado')) && ultimo;
console.log(ok ? '\n✅ La charla terminó en pedido.' : '\n❌ La charla NO terminó en pedido.');
process.exitCode = ok ? 0 : 1;
