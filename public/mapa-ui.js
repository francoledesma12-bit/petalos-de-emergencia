(function () {
  const valid = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180 && !(Number(lat) === 0 && Number(lng) === 0);
  const icon = (label, kind) => L.divIcon({ className: 'petalos-pin-wrap', html: `<span class="petalos-pin ${kind}">${label}</span>`, iconSize: [38, 38], iconAnchor: [19, 38] });
  function create(element) {
    if (!window.L || !element) return null;
    const map = L.map(element, { zoomControl: true, scrollWheelZoom: false }).setView([-32.9468, -60.6393], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
    const markers = L.layerGroup().addTo(map);
    let bike = null, line = null;
    function update(data) {
      markers.clearLayers(); if (line) { map.removeLayer(line); line = null; }
      const points = [], origin = data.local || {}, orders = Array.isArray(data.pedidos) ? data.pedidos : [];
      if (valid(origin.lat, origin.lng)) { const p = [Number(origin.lat), Number(origin.lng)]; L.marker(p, { icon: icon('✿', 'shop') }).bindPopup('Pétalos de Emergencia · local').addTo(markers); points.push(p); }
      orders.forEach((order, i) => { const d = order.datos || {}; if (!valid(d.lat, d.lng)) return; const p = [Number(d.lat), Number(d.lng)]; const popup = document.createElement('div'); popup.textContent = `Parada ${i + 1} · Pedido #${order.id} · ${d.recibe || 'Entrega'}`; L.marker(p, { icon: icon(String(i + 1), 'stop') }).bindPopup(popup).addTo(markers); points.push(p); });
      if (points.length > 1) line = L.polyline(points, { color: '#a84353', weight: 4, opacity: .75, dashArray: '8 8' }).addTo(map);
      if (bike) { map.removeLayer(bike); bike = null; }
      const rider = data.repartidor; if (rider && valid(rider.lat, rider.lng)) { bike = L.marker([Number(rider.lat), Number(rider.lng)], { icon: icon('🚲', 'rider'), zIndexOffset: 1000 }).bindPopup('Repartidor · ubicación compartida').addTo(map); points.push([Number(rider.lat), Number(rider.lng)]); }
      if (points.length > 1) map.fitBounds(points, { padding: [36, 36], maxZoom: 14 }); else if (points.length === 1) map.setView(points[0], 13);
      setTimeout(() => map.invalidateSize(), 50);
    }
    function rider(position) { if (!position || !valid(position.lat, position.lng)) return; const destination = [Number(position.lat), Number(position.lng)]; if (!bike) { bike = L.marker(destination, { icon: icon('🚲', 'rider'), zIndexOffset: 1000 }).bindPopup('Repartidor · ubicación compartida').addTo(map); return; } const start = bike.getLatLng(), began = performance.now(); function step(now) { const f = Math.min(1, (now - began) / 800); const eased = 1 - Math.pow(1 - f, 3); bike.setLatLng([start.lat + (destination[0] - start.lat) * eased, start.lng + (destination[1] - start.lng) * eased]); if (f < 1) requestAnimationFrame(step); } requestAnimationFrame(step); }
    return { update, rider };
  }
  window.PetalosMapa = { create };
})();
