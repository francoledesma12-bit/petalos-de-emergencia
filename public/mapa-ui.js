(function () {
  const valid = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180 && !(Number(lat) === 0 && Number(lng) === 0);
  const icon = (label, kind) => L.divIcon({ className: 'petalos-pin-wrap', html: `<span class="petalos-pin ${kind}">${label}</span>`, iconSize: [38, 38], iconAnchor: [19, 38] });
  function create(element) {
    if (!window.L || !element) return null;
    const map = L.map(element, { zoomControl: true, scrollWheelZoom: false }).setView([-32.9468, -60.6393], 13);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { attribution: 'Mapa &copy; Esri, OpenStreetMap', maxZoom: 19 }).addTo(map);
    const markers = L.layerGroup().addTo(map);
    let bike = null, line = null;
    // Simulación: si no hay paradas reales, un reparto de ejemplo que recorre calles reales de Rosario.
    let demo = null;
    function startDemo() {
      const D = window.PetalosDemoReparto;
      if (demo || !D) return;
      const SPEED = 15; // 1 segundo en pantalla = 15 segundos reales
      const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      const layer = L.layerGroup().addTo(map), legs = D.legs.map(l => {
        const c = l.c, acc = [0];
        for (let k = 1; k < c.length; k++) { const dy = c[k][0] - c[k - 1][0], dx = (c[k][1] - c[k - 1][1]) * Math.cos(c[k][0] * Math.PI / 180); acc.push(acc[k - 1] + Math.hypot(dx, dy)); }
        return { c, acc, total: acc[acc.length - 1], seconds: l.s };
      });
      const all = legs.flatMap(l => l.c);
      L.polyline(all, { color: '#a84353', weight: 4, opacity: .55, dashArray: '6 8' }).addTo(layer);
      const done = L.polyline([], { color: '#283d31', weight: 5, opacity: .85 }).addTo(layer);
      L.marker(D.local, { icon: icon('✿', 'shop') }).bindTooltip('Pétalos · local', { direction: 'top', offset: [0, -34] }).addTo(layer);
      const pins = D.stops.map((st, k) => L.marker(legs[k].c[legs[k].c.length - 1], { icon: icon(String(k + 1), 'stop') })
        .bindTooltip(`${esc(st.recibe.split(' ')[0])} · ${esc(st.franja)}`, { permanent: true, direction: 'top', offset: [0, -36], className: 'petalos-tip' })
        .bindPopup(`<strong>${esc(st.recibe)}</strong><br>${esc(st.direccion)}<br>${esc(st.ramo)}`).addTo(layer));
      const rider = L.marker(D.local, { icon: icon('🚲', 'rider'), zIndexOffset: 1000 }).bindTooltip(`${esc(D.repartidor)} · en bici`, { direction: 'right', offset: [14, -20] }).addTo(layer);
      const badge = L.control({ position: 'topright' });
      badge.onAdd = () => { const el = L.DomUtil.create('div', 'petalos-sim'); el.textContent = 'Simulación de reparto'; return el; };
      badge.addTo(map);
      const toast = L.DomUtil.create('div', 'petalos-toast', map.getContainer());
      const panel = document.createElement('div'); panel.className = 'petalos-ruta';
      element.insertAdjacentElement('afterend', panel);
      map.fitBounds(all, { padding: [40, 40] });
      const status = D.stops.map(() => 'pendiente');
      const legStart = k => legs.slice(0, k).reduce((n, l) => n + l.c.length, 0);
      let leg = 0, progress = 0, last = performance.now(), waitUntil = 0, frame = 0, lastRender = 0;
      function say(text, ms) { toast.textContent = text; toast.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove('on'), ms); }
      function render() {
        const delivered = status.filter(x => x === 'entregado').length;
        panel.innerHTML = `<div class="petalos-ruta-head"><div><strong>${esc(D.repartidor)}</strong> está repartiendo · ${delivered} de ${D.stops.length} entregados</div><div class="petalos-ruta-bar"><span style="width:${delivered / D.stops.length * 100}%"></span></div></div>` +
          D.stops.map((st, k) => {
            const s = status[k], chip = { pendiente: 'Pendiente', camino: 'En camino', llego: 'En la puerta', entregado: 'Entregado ✓' }[s];
            const eta = s === 'camino' ? ` · llega en ${Math.max(1, Math.round(legs[k].seconds * (1 - progress / legs[k].total) / 60))} min` : '';
            const btn = s === 'llego' || s === 'camino' ? `<button type="button" data-entregar="${k}">Marcar entregado</button>` : '';
            return `<div class="petalos-parada ${s}"><span class="n">${s === 'entregado' ? '✓' : k + 1}</span><div class="d"><strong>${esc(st.recibe)}</strong><small>${esc(st.direccion)} · ${esc(st.franja)}</small><small>${esc(st.ramo)} · “${esc(st.tarjeta)}”</small></div><div class="a"><span class="chip">${chip}${eta}</span>${btn}</div></div>`;
          }).join('');
      }
      function deliver(k) {
        if (status[k] === 'entregado' || k !== leg) return;
        status[k] = 'entregado'; pins[k].setIcon(icon('✓', 'stop done'));
        rider.setLatLng(legs[k].c[legs[k].c.length - 1]);
        leg += 1; progress = 0; done.setLatLngs(all.slice(0, legStart(leg)));
        say(`✓ Entregado a ${D.stops[k].recibe} · se le avisó a quien compró`, 3500);
        waitUntil = performance.now() + 1500; render();
      }
      panel.addEventListener('click', e => { const b = e.target.closest('[data-entregar]'); if (b) deliver(Number(b.dataset.entregar)); });
      function pointAt(l, d) { let k = 1; while (k < l.acc.length - 1 && l.acc[k] < d) k++; const a = l.c[k - 1], b = l.c[k], seg = (l.acc[k] - l.acc[k - 1]) || 1, f = Math.min(1, Math.max(0, (d - l.acc[k - 1]) / seg)); return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], k }; }
      function restart() { status.fill('pendiente'); pins.forEach((p, k) => p.setIcon(icon(String(k + 1), 'stop'))); leg = 0; progress = 0; done.setLatLngs([]); rider.setLatLng(D.local); render(); }
      function tick(now) {
        const dt = Math.min(100, now - last) / 1000; last = now;
        if (now > waitUntil && leg < legs.length) {
          const l = legs[leg], isStop = leg < D.stops.length;
          if (isStop && status[leg] === 'llego') deliver(leg); // si nadie lo marca, el repartidor lo confirma solo
          else {
            if (isStop && status[leg] === 'pendiente') { status[leg] = 'camino'; render(); }
            progress = Math.min(l.total, progress + l.total / l.seconds * SPEED * dt);
            const { p, k } = pointAt(l, progress); rider.setLatLng(p); done.setLatLngs([...all.slice(0, legStart(leg)), ...l.c.slice(0, k), p]);
            if (progress >= l.total) {
              if (isStop) { status[leg] = 'llego'; waitUntil = now + 7000; say(`${D.repartidor} llegó a lo de ${D.stops[leg].recibe}`, 3000); render(); }
              else { leg += 1; say(`${D.repartidor} volvió al local · ruta terminada`, 4500); setTimeout(restart, 5000); }
            }
          }
        }
        if (now - lastRender > 5000) { lastRender = now; if (status.includes('camino')) render(); }
        frame = requestAnimationFrame(tick);
      }
      render(); frame = requestAnimationFrame(tick);
      demo = { stop() { cancelAnimationFrame(frame); map.removeLayer(layer); badge.remove(); toast.remove(); panel.remove(); demo = null; } };
    }
    function update(data) {
      markers.clearLayers(); if (line) { map.removeLayer(line); line = null; }
      const points = [], origin = data.local || {}, orders = Array.isArray(data.pedidos) ? data.pedidos : [];
      if (valid(origin.lat, origin.lng)) { const p = [Number(origin.lat), Number(origin.lng)]; L.marker(p, { icon: icon('✿', 'shop') }).bindPopup('Pétalos de Emergencia · local').addTo(markers); points.push(p); }
      orders.forEach((order, i) => { const d = order.datos || {}; if (!valid(d.lat, d.lng)) return; const p = [Number(d.lat), Number(d.lng)]; const popup = document.createElement('div'); popup.textContent = `Parada ${i + 1} · Pedido #${order.id} · ${d.recibe || 'Entrega'}`; L.marker(p, { icon: icon(String(i + 1), 'stop') }).bindPopup(popup).addTo(markers); points.push(p); });
      if (points.length > 1) line = L.polyline(points, { color: '#a84353', weight: 4, opacity: .75, dashArray: '8 8' }).addTo(map);
      if (bike) { map.removeLayer(bike); bike = null; }
      const rider = data.repartidor; if (rider && valid(rider.lat, rider.lng)) { bike = L.marker([Number(rider.lat), Number(rider.lng)], { icon: icon('🚲', 'rider'), zIndexOffset: 1000 }).bindPopup('Repartidor · ubicación compartida').addTo(map); points.push([Number(rider.lat), Number(rider.lng)]); }
      const realStops = orders.some(o => valid((o.datos || {}).lat, (o.datos || {}).lng));
      if (!realStops && !bike) { startDemo(); setTimeout(() => map.invalidateSize(), 50); return; }
      if (demo) demo.stop();
      if (points.length > 1) map.fitBounds(points, { padding: [36, 36], maxZoom: 14 }); else if (points.length === 1) map.setView(points[0], 13);
      setTimeout(() => map.invalidateSize(), 50);
    }
    function rider(position) { if (!position || !valid(position.lat, position.lng)) return; const destination = [Number(position.lat), Number(position.lng)]; if (!bike) { bike = L.marker(destination, { icon: icon('🚲', 'rider'), zIndexOffset: 1000 }).bindPopup('Repartidor · ubicación compartida').addTo(map); return; } const start = bike.getLatLng(), began = performance.now(); function step(now) { const f = Math.min(1, (now - began) / 800); const eased = 1 - Math.pow(1 - f, 3); bike.setLatLng([start.lat + (destination[0] - start.lat) * eased, start.lng + (destination[1] - start.lng) * eased]); if (f < 1) requestAnimationFrame(step); } requestAnimationFrame(step); }
    return { update, rider };
  }
  window.PetalosMapa = { create };
})();
