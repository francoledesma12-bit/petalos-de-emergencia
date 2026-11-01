// Convierte una dirección en un punto del mapa con OpenStreetMap (gratis, una consulta por segundo).
let ultima = 0;

export async function ubicar(direccion, ciudad) {
  const espera = ultima + 1100 - Date.now();
  if (espera > 0) await new Promise(r => setTimeout(r, espera));
  ultima = Date.now();
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', `${direccion}, ${ciudad}, Santa Fe, Argentina`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'ar');
    const r = await fetch(url, { headers: { 'User-Agent': 'PetalosDeEmergencia/1.0 (hackaton DonWeb)' }, signal: AbortSignal.timeout(6000) });
    const [primero] = r.ok ? await r.json() : [];
    return primero ? { lat: Number(primero.lat), lng: Number(primero.lon) } : null;
  } catch (e) {
    console.error('[mapa] no se pudo ubicar la dirección:', e.message);
    return null;
  }
}
