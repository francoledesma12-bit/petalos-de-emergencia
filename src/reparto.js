// Ruta del repartidor: la IA ordena las entregas pensando en la hora límite de cada una y en
// la distancia desde el local. Si la IA no responde, ordena por urgencia y cercanía.
import { pedirJSON } from './ia.js';

const memoria = new Map(); // misma lista de paradas → misma ruta, sin volver a preguntarle a la IA
const hhmm = ms => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
const lugar = (ficha, direccion) => `${direccion}, ${ficha.ciudad}, Santa Fe, Argentina`;

function mapa(ficha, paradas) {
  if (!paradas.length) return null;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', lugar(ficha, ficha.direccion_local));
  url.searchParams.set('destination', lugar(ficha, paradas.at(-1).datos.direccion));
  if (paradas.length > 1) url.searchParams.set('waypoints', paradas.slice(0, -1).map(p => lugar(ficha, p.datos.direccion)).join('|'));
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}

function porReglas(ficha, pedidos) {
  const cercania = Object.fromEntries(ficha.zonas.map((z, i) => [z.nombre, i]));
  const orden = [...pedidos].sort((a, b) =>
    (a.hora_limite ?? Infinity) - (b.hora_limite ?? Infinity) || (cercania[a.datos.zona] ?? 9) - (cercania[b.datos.zona] ?? 9));
  return { orden: orden.map(p => p.id), explicacion: 'Primero lo que vence antes; a igual hora, lo más cerca del local.' };
}

export async function rutaDeReparto(ficha, pedidos) {
  if (!pedidos.length) return { orden: [], explicacion: 'No hay entregas pendientes.', mapa: null };
  const clave = pedidos.map(p => `${p.id}:${p.hora_limite}`).sort().join(',');
  if (memoria.has(clave)) return memoria.get(clave);

  const lista = pedidos.map(p => `#${p.id}: ${p.datos.direccion} (${p.datos.zona}), tiene que llegar antes de las ${hhmm(p.hora_limite)}`).join('\n');
  const ia = await pedirJSON('Respondés solo JSON válido.', [
    `Sos el que organiza el reparto de una florería en ${ficha.direccion_local}. Ahora son las ${hhmm(Date.now())}.`,
    `Ordená estas entregas para que ninguna llegue tarde y se maneje lo menos posible (conocés las calles de ${ficha.ciudad}):`,
    lista,
    'JSON: {"orden":[números de pedido en orden],"explicacion":"una o dos frases simples para el repartidor: en qué orden va y por qué (urgencia, cercanía). NO des indicaciones de calles ni giros"}',
  ].join('\n'));

  const ids = new Set(pedidos.map(p => p.id));
  let ruta = porReglas(ficha, pedidos);
  if (Array.isArray(ia?.orden)) {
    const orden = ia.orden.map(Number).filter(id => ids.has(id));
    if (orden.length === ids.size && new Set(orden).size === ids.size) {
      ruta = { orden, explicacion: String(ia.explicacion || '').slice(0, 300) || ruta.explicacion };
    }
  }
  const ordenados = ruta.orden.map(id => pedidos.find(p => p.id === id));
  ruta.mapa = mapa(ficha, ordenados);
  memoria.set(clave, ruta);
  if (memoria.size > 50) memoria.delete(memoria.keys().next().value);
  return ruta;
}
