// Pruebas de punta a punta contra el servidor (local o publicado).
// Uso: node probar.js [direccion]   (por defecto http://localhost:3000)
// Cada caso es una charla real por el chat web o por un aviso de WhatsApp simulado.
const BASE = process.argv[2] || 'http://localhost:3000';
const fallas = [];
const ver = (ok, que) => { console.log(`${ok ? '  ✅' : '  ❌'} ${que}`); if (!ok) fallas.push(que); };

function cliente() {
  const sesion = 'prueba-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  return async texto => {
    const r = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sesion, texto }) });
    const j = await r.json();
    console.log(`\n🙋 ${texto}`);
    for (const t of j.respuestas || [j.error]) console.log(`🌹 ${String(t).replace(/\n/g, '\n   ')}`);
    return (j.respuestas || []).join('\n');
  };
}

const entrar = await fetch(`${BASE}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: process.env.PANEL_CLAVE || 'flores' }) });
const cookie = entrar.headers.get('set-cookie')?.split(';')[0];
const panel = async (ruta, cuerpo) => (await fetch(`${BASE}${ruta}`, {
  method: cuerpo ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: cuerpo && JSON.stringify(cuerpo) })).json();

console.log('\n━━━ 1. Macana: olvido de aniversario, de punta a punta');
{
  const d = cliente();
  await d('hola');
  ver((await d('me olvidé del aniversario con Caro y está furiosa')).includes('Sillón'), 'recomienda ramos para la macana');
  ver((await d('la 2 con bombones')).includes('tres tonos'), 'escribe la tarjeta en 3 tonos');
  await d('la 2');
  const resumen = await d('Bv Oroño 1200, Centro, recibe Carolina, antes de las 19');
  ver(resumen.includes('68.500'), 'total calculado con código: $ 68.500');
  ver((await d('sí, dale')).includes('confirmado'), 'pedido confirmado');
  const t = await panel('/api/tablero');
  const p = t.pedidos.filter(x => x.total === 68500).at(-1);
  ver(p?.datos.producto === 'Ramo Dormí en el Sillón' && p.total === 68500, 'el pedido aparece en el panel');
  const cambio = await panel(`/api/pedidos/${p.id}`, { estado: 'en_camino' });
  ver(cambio.pedido?.estado === 'en_camino', 'el dueño lo pasa a "en camino"');
}

console.log('\n━━━ 2. Condolencias: cambia el tono');
{
  const d = cliente();
  await d('hola');
  const r = await d('falleció el papá de mi mejor amigo, quiero mandar algo al velorio');
  ver(r.includes('Blanco Sereno') || r.includes('Corona'), 'ofrece arreglos sobrios');
  ver(!/macana|sillón/i.test(r), 'sin chistes');
}

console.log('\n━━━ 3. Reclamo: pasa a una persona y la persona contesta desde el panel');
{
  const d = cliente();
  await d('hola');
  ver((await d('las flores llegaron aplastadas, quiero hacer un reclamo')).includes('persona'), 'avisa que pasa a una persona');
  ver((await d('mandé foto por mail también')) === '', 'Flora se calla mientras la atiende una persona');
  const t = await panel('/api/tablero');
  const a = t.avisos.at(-1);
  ver(a?.motivo === 'Reclamo' && a.resumen.includes('Agregó'), 'el caso llega al panel con resumen y la actualización');
  await panel(`/api/charlas/${a.charla_id}/responder`, { texto: 'Hola, soy Marta de la florería. Te mandamos otro ramo hoy sin cargo.' });
  const c = await panel(`/api/charlas/${a.charla_id}`);
  ver(c.mensajes.at(-1)?.quien === 'persona', 'la respuesta de la persona queda en la charla');
  await panel(`/api/charlas/${a.charla_id}/devolver`, {});
  ver(!(await panel('/api/tablero')).avisos.some(x => x.charla_id === a.charla_id), 'al devolverla a Flora, el caso se cierra');
}

console.log('\n━━━ 4. WhatsApp: mensaje entrante y alguien que contesta desde el celular');
{
  const chatId = `549341${Date.now() % 10000000}@c.us`;
  const aviso = (typeWebhook, texto) => fetch(`${BASE}/wa/aviso`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.WA_AVISO_TOKEN ? { Authorization: `Bearer ${process.env.WA_AVISO_TOKEN}` } : {}) },
    body: JSON.stringify({ typeWebhook, senderData: { chatId, senderName: 'Prueba' }, messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: texto } } }) });
  await aviso('incomingMessageReceived', 'hola, me peleé con mi novio');
  await new Promise(r => setTimeout(r, 3500));
  await aviso('outgoingMessageReceived', 'Hola! Te atiendo yo, soy Marta');
  await new Promise(r => setTimeout(r, 800));
  await aviso('incomingMessageReceived', 'genial, gracias Marta');
  await new Promise(r => setTimeout(r, 3000));
  const t = await panel('/api/tablero');
  ver((await fetch(`${BASE}/wa/aviso`, { method: 'POST', body: '{}' })).status !== 500, 'el aviso de WhatsApp responde');
  void t;
}

console.log('\n━━━ 5. Botones en la charla');
{
  const sesion = 'prueba-botones-' + Date.now();
  const r = await (await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sesion, texto: 'hola' }) })).json();
  ver(r.botones?.length === 3 && r.botones.every(b => b.texto.length <= 25), 'el saludo trae 3 botones (máx. 25 letras)');
  const r2 = await (await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sesion, texto: r.botones[1].texto }) })).json();
  ver(r2.botones?.length === 3 && /Sillón|Perdoncito|Rodillas/.test(r2.botones.map(b => b.texto).join()), 'tocar "Nos peleamos" muestra los ramos como botones');
  const r3 = await (await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sesion, texto: r2.botones[1].texto }) })).json();
  ver(r3.respuestas.join().includes('tres tonos') && r3.botones?.length === 3, 'tocar un ramo pasa a las tarjetas con botones');
}

if (process.env.TALLER_CLAVE && process.env.REPARTO_CLAVE) {
  console.log('\n━━━ 6. Roles: taller y reparto');
  const entrarCon = async clave => {
    const r = await fetch(`${BASE}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave }) });
    return { rol: (await r.json()).rol, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  const como = cookie => async (ruta, cuerpo) => {
    const r = await fetch(`${BASE}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: cuerpo && JSON.stringify(cuerpo) });
    return { status: r.status, j: await r.json() };
  };
  const taller = await entrarCon(process.env.TALLER_CLAVE);
  const reparto = await entrarCon(process.env.REPARTO_CLAVE);
  ver(taller.rol === 'taller' && reparto.rol === 'reparto', 'cada clave entra con su rol');
  const t = como(taller.cookie), rp = como(reparto.cookie);
  const d = cliente();
  await d('hola'); await d('nos peleamos con Juli'); await d('1'); await d('2');
  await d('Mendoza 1500, Echesortu, recibe Juli, antes de las 21'); await d('si');
  const cola = (await t('/api/taller')).j.pedidos;
  ver(Array.isArray(cola) && cola.every(p => !('total' in p) && p.datos.tarjeta !== undefined), 'el taller ve qué armar y la tarjeta, sin precios');
  ver((await t('/api/tablero')).status === 403, 'el taller no ve el panel del dueño');
  const id = cola[0]?.id;
  if (id) {
    ver((await t(`/api/pedidos/${id}`, { estado: 'entregado' })).status === 403, 'el taller no puede marcar "entregado"');
    await t(`/api/pedidos/${id}`, { estado: 'preparando' });
    ver((await t(`/api/pedidos/${id}`, { estado: 'listo' })).status === 200, 'el taller lo marca "listo para salir"');
    const rep = (await rp('/api/reparto')).j;
    ver(rep.pedidos.some(p => p.id === id) && rep.ruta.orden.includes(id) && rep.ruta.mapa?.startsWith('https://www.google.com/maps'), 'el repartidor lo ve en su ruta con mapa');
    ver((await rp(`/api/pedidos/${id}`, { estado: 'en_camino' })).status === 200, 'el repartidor sale');
    ver((await rp('/api/reparto/posicion', { lat: -32.95, lng: -60.65 })).status === 200, 'el repartidor manda su ubicación');
  }
}

console.log(fallas.length ? `\n❌ ${fallas.length} prueba(s) fallaron` : '\n✅ Todas las pruebas pasaron');
process.exitCode = fallas.length ? 1 : 0;
