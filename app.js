/* Szlaki na Śnieżkę — mapa szlaków z OpenStreetMap. */

const COLORS = {
  red: { label: 'czerwony', css: '#e23b2e' },
  blue: { label: 'niebieski', css: '#1f6feb' },
  green: { label: 'zielony', css: '#1f9e4a' },
  yellow: { label: 'żółty', css: '#e0a800' },
  black: { label: 'czarny', css: '#26282d' },
  white: { label: 'biały', css: '#f2f2f2' },
  other: { label: 'inny', css: '#8b5cf6' },
};

const NEAR_RADIUS_KM = 5;

const state = {
  trails: [],
  activeColors: new Set(),
  query: '',
  nearOnly: false,
  selectedId: null,
  userLatLng: null,
  layers: new Map(),
};

const el = {
  map: document.getElementById('map'),
  colorFilters: document.getElementById('color-filters'),
  list: document.getElementById('trail-list'),
  search: document.getElementById('search'),
  nearMe: document.getElementById('near-me'),
  summary: document.getElementById('summary'),
  loading: document.getElementById('loading'),
  panel: document.getElementById('panel'),
  menuToggle: document.getElementById('menu-toggle'),
  locate: document.getElementById('locate'),
};

const map = L.map(el.map, { zoomControl: true }).setView([50.7361, 15.7397], 13);

const baseLayers = {
  'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)',
  }),
  'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }),
};
baseLayers['OpenTopoMap'].addTo(map);
L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

const summitIcon = L.divIcon({
  className: 'summit-marker',
  html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">⛰️</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 20],
});

let userMarker = null;
let userCircle = null;
let watchId = null;
let compassHeading = null;
let follow = true;
let lastFix = null;

const userIcon = L.divIcon({
  className: 'user-marker',
  html: '<div class="user-arrow" id="user-arrow"><div class="user-dot"></div><div class="user-cone"></div></div>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function minDistanceToTrailKm(trail, point) {
  let best = Infinity;
  for (const seg of trail.segments) {
    for (const p of seg) {
      const d = haversineKm(point, p);
      if (d < best) best = d;
    }
  }
  return best;
}

function trailMatches(trail) {
  if (state.activeColors.size && !state.activeColors.has(trail.color)) return false;
  if (state.query) {
    const haystack = `${trail.name} ${trail.nameOrig} ${trail.from} ${trail.to}`.toLowerCase();
    if (!haystack.includes(state.query)) return false;
  }
  if (state.nearOnly) {
    if (!state.userLatLng) return false;
    if (minDistanceToTrailKm(trail, state.userLatLng) > NEAR_RADIUS_KM) return false;
  }
  return true;
}

function buildColorFilters() {
  const counts = new Map();
  for (const t of state.trails) counts.set(t.color, (counts.get(t.color) || 0) + 1);

  el.colorFilters.innerHTML = '';
  for (const [key, meta] of Object.entries(COLORS)) {
    const count = counts.get(key);
    if (!count) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.setAttribute('aria-pressed', 'false');
    btn.dataset.color = key;
    btn.innerHTML = `<span class="dot" style="background:${meta.css}"></span>${meta.label} (${count})`;
    btn.addEventListener('click', () => {
      if (state.activeColors.has(key)) state.activeColors.delete(key);
      else state.activeColors.add(key);
      btn.setAttribute('aria-pressed', String(state.activeColors.has(key)));
      render();
    });
    el.colorFilters.appendChild(btn);
  }
}

function createLayer(trail) {
  const color = (COLORS[trail.color] || COLORS.other).css;
  const group = L.layerGroup();
  for (const seg of trail.segments) {
    L.polyline(seg, { color: '#ffffff', weight: 6, opacity: 0.55 }).addTo(group);
    L.polyline(seg, { color, weight: 3, opacity: 0.95 }).addTo(group);
  }
  const parts = [
    `<h3>${escapeHtml(trail.name)}</h3>`,
    `<p>Kolor: ${(COLORS[trail.color] || COLORS.other).label}</p>`,
    `<p>Długość całej trasy: ${trail.distanceKm} km</p>`,
    trail.from || trail.to ? `<p>${escapeHtml(trail.from)} → ${escapeHtml(trail.to)}</p>` : '',
    `<p>Od szczytu Śnieżki: ${trail.distToSummitKm} km</p>`,
    `<p><a href="https://www.openstreetmap.org/relation/${trail.id}" target="_blank" rel="noopener">Szlak w OpenStreetMap</a></p>`,
  ];
  group.on('click', () => selectTrail(trail.id, { fly: false }));
  group.bindPopup(parts.join(''));
  return group;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function render() {
  const visible = state.trails.filter(trailMatches);
  const visibleIds = new Set(visible.map((t) => t.id));

  for (const [id, layer] of state.layers) {
    if (visibleIds.has(id)) {
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }

  el.list.innerHTML = '';
  for (const trail of visible) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    if (trail.id === state.selectedId) btn.setAttribute('aria-current', 'true');
    const meta = [`${trail.distanceKm} km`];
    if (trail.from && trail.to) meta.push(`${trail.from} → ${trail.to}`);
    if (state.userLatLng) meta.push(`${minDistanceToTrailKm(trail, state.userLatLng).toFixed(1)} km od Ciebie`);
    btn.innerHTML =
      `<span class="stripe" style="background:${(COLORS[trail.color] || COLORS.other).css}"></span>` +
      `<span><span class="name">${escapeHtml(trail.name)}</span>` +
      `<span class="meta">${escapeHtml(meta.join(' · '))}</span></span>`;
    btn.addEventListener('click', () => selectTrail(trail.id, { fly: true }));
    li.appendChild(btn);
    el.list.appendChild(li);
  }

  const total = state.trails.length;
  const count = visible.length === total
    ? `Wszystkie szlaki: ${total}`
    : `Pokazuję ${visible.length} z ${total} szlaków`;
  // Podczas śledzenia w tym miejscu jest status GPS (updateHeading), więc licznik idzie do listy.
  if (watchId === null) el.summary.textContent = count;
  el.list.setAttribute('aria-label', count);
}

function selectTrail(id, { fly }) {
  state.selectedId = id;
  const layer = state.layers.get(id);
  if (layer && fly) {
    map.fitBounds(L.featureGroup(layer.getLayers()).getBounds(), { padding: [30, 30] });
    if (window.matchMedia('(max-width: 760px)').matches) el.panel.classList.remove('open');
  }
  render();
}

function locateUser() {
  if (!navigator.geolocation) {
    el.summary.textContent = 'Ta przeglądarka nie udostępnia geolokalizacji.';
    return;
  }
  if (watchId !== null) {
    // Śledzenie trwa: po ręcznym przesunięciu mapy wracamy do podążania, w innym razie zatrzymujemy.
    if (!follow && state.userLatLng) {
      follow = true;
      map.panTo(state.userLatLng);
      return;
    }
    stopTracking();
    return;
  }
  startTracking();
}

function startTracking() {
  el.locate.classList.add('active');
  el.locate.setAttribute('aria-label', 'Zatrzymaj śledzenie pozycji');
  follow = true;
  requestCompass();
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 2000,
  });
}

function stopTracking() {
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
  el.locate.classList.remove('active');
  el.locate.setAttribute('aria-label', 'Śledź moją pozycję');
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
  compassHeading = null;
  el.summary.textContent = 'Śledzenie zatrzymane.';
}

function onPosition(pos) {
  const { latitude, longitude, accuracy, heading, speed } = pos.coords;
  state.userLatLng = [latitude, longitude];
  lastFix = { heading, speed, accuracy, time: pos.timestamp };

  if (!userMarker) {
    userMarker = L.marker(state.userLatLng, { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
    userCircle = L.circle(state.userLatLng, {
      radius: accuracy, color: '#1f6feb', weight: 1, fillOpacity: 0.08,
    }).addTo(map);
    map.setView(state.userLatLng, 15);
  } else {
    userMarker.setLatLng(state.userLatLng);
    userCircle.setLatLng(state.userLatLng).setRadius(accuracy);
    if (follow) map.panTo(state.userLatLng, { animate: true });
  }
  updateHeading();
  render();
}

function onPositionError(err) {
  const reasons = {
    1: 'Brak zgody na dostęp do lokalizacji.',
    2: 'Nie udało się ustalić lokalizacji.',
    3: 'Ustalanie lokalizacji trwa zbyt długo — czekam na sygnał GPS.',
  };
  el.summary.textContent = reasons[err.code] || 'Nie udało się ustalić lokalizacji.';
  if (err.code === 1) stopTracking();
}

/* Kierunek: najpierw kompas telefonu, a gdy go nie ma — kierunek ruchu z GPS. */
function requestCompass() {
  const attach = () => {
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onOrientation);
    } else {
      window.addEventListener('deviceorientation', onOrientation);
    }
  };
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') attach(); }).catch(() => {});
  } else {
    attach();
  }
}

function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
  if (h !== null) {
    compassHeading = h;
    updateHeading();
  }
}

function currentHeading() {
  if (compassHeading !== null) return compassHeading;
  if (lastFix && typeof lastFix.heading === 'number' && !Number.isNaN(lastFix.heading) &&
      lastFix.speed > 0.5) return lastFix.heading;
  return null;
}

function updateHeading() {
  const arrow = document.getElementById('user-arrow');
  if (!arrow) return;
  const h = currentHeading();
  arrow.classList.toggle('no-heading', h === null);
  if (h !== null) arrow.style.transform = `rotate(${h}deg)`;

  if (lastFix) {
    const parts = [`Dokładność ±${Math.round(lastFix.accuracy)} m`];
    if (h !== null) parts.push(`kierunek ${Math.round(h)}°`);
    if (lastFix.speed > 0.3) parts.push(`${(lastFix.speed * 3.6).toFixed(1)} km/h`);
    el.summary.textContent = parts.join(' · ');
  }
}

/* Przesunięcie mapy ręką wyłącza podążanie; ponowne kliknięcie 📍 je włącza. */
map.on('dragstart', () => { follow = false; });
el.locate.addEventListener('dblclick', (e) => e.preventDefault());

el.search.addEventListener('input', () => {
  state.query = el.search.value.trim().toLowerCase();
  render();
});

el.nearMe.addEventListener('change', () => {
  state.nearOnly = el.nearMe.checked;
  if (state.nearOnly && !state.userLatLng) locateUser();
  render();
});

el.locate.addEventListener('click', locateUser);

el.menuToggle.addEventListener('click', () => {
  const open = el.panel.classList.toggle('open');
  el.menuToggle.setAttribute('aria-expanded', String(open));
});

/* ---------- Tryb offline (PWA) ---------- */

const OFFLINE_BBOX = { south: 50.68, west: 15.63, north: 50.78, east: 15.82 };
const OFFLINE_ZOOMS = [11, 12, 13, 14, 15];
const SUBDOMAINS = ['a', 'b', 'c'];

const offlineBtn = document.getElementById('offline-btn');
const offlineStatus = document.getElementById('offline-status');

function lonToX(lon, z) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
function latToY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function currentTileTemplate() {
  for (const [name, layer] of Object.entries(baseLayers)) {
    if (map.hasLayer(layer)) return { name, url: layer._url };
  }
  return { name: 'OpenTopoMap', url: baseLayers.OpenTopoMap._url };
}

function tileUrlsForArea(template) {
  const urls = [];
  let i = 0;
  for (const z of OFFLINE_ZOOMS) {
    const x0 = lonToX(OFFLINE_BBOX.west, z), x1 = lonToX(OFFLINE_BBOX.east, z);
    const y0 = latToY(OFFLINE_BBOX.north, z), y1 = latToY(OFFLINE_BBOX.south, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const s = SUBDOMAINS[i++ % SUBDOMAINS.length];
        urls.push(template.replace('{s}', s).replace('{z}', z).replace('{x}', x).replace('{y}', y));
      }
    }
  }
  return urls;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    offlineBtn.disabled = true;
    offlineStatus.textContent = 'Ta przeglądarka nie obsługuje trybu offline.';
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'prefetch-progress') {
        offlineStatus.textContent = `Pobieram kafelki: ${m.done}/${m.total}`;
      } else if (m.type === 'prefetch-done') {
        offlineBtn.disabled = false;
        offlineStatus.textContent = m.failed
          ? `Gotowe, nie udało się pobrać ${m.failed} z ${m.total} kafelków.`
          : `Mapa okolicy Śnieżki zapisana (${m.total} kafelków).`;
      }
    });
  } catch (err) {
    offlineStatus.textContent = `Tryb offline niedostępny: ${err.message}`;
  }
}

offlineBtn.addEventListener('click', async () => {
  const reg = await navigator.serviceWorker.ready;
  const sw = reg.active;
  if (!sw) { offlineStatus.textContent = 'Poczekaj chwilę i spróbuj ponownie.'; return; }
  if (!navigator.onLine) { offlineStatus.textContent = 'Brak internetu — pobieranie wymaga połączenia.'; return; }
  const tpl = currentTileTemplate();
  const urls = tileUrlsForArea(tpl.url);
  offlineBtn.disabled = true;
  offlineStatus.textContent = `Pobieram ${urls.length} kafelków (${tpl.name})…`;
  sw.postMessage({ type: 'prefetch-tiles', urls });
});

function updateOnlineBadge() {
  document.body.classList.toggle('offline', !navigator.onLine);
  if (!navigator.onLine) offlineStatus.textContent = 'Jesteś offline — mapa z zapisanych kafelków.';
  else if (offlineStatus.textContent.startsWith('Jesteś offline')) offlineStatus.textContent = '';
}
window.addEventListener('online', updateOnlineBadge);
window.addEventListener('offline', updateOnlineBadge);

async function init() {
  registerServiceWorker();
  updateOnlineBadge();
  try {
    const res = await fetch('trails.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.trails = data.trails;

    L.marker([data.summit.lat, data.summit.lon], { icon: summitIcon })
      .addTo(map)
      .bindPopup('<h3>Śnieżka</h3><p>1603 m n.p.m.</p>');

    for (const trail of state.trails) state.layers.set(trail.id, createLayer(trail));

    buildColorFilters();
    render();
    el.loading.hidden = true;
  } catch (err) {
    el.loading.textContent = `Nie udało się wczytać szlaków: ${err.message}`;
  }
}

init();
