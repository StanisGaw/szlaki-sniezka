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
  el.summary.textContent = visible.length === total
    ? `Wszystkie szlaki: ${total}`
    : `Pokazuję ${visible.length} z ${total} szlaków`;
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
  el.locate.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el.locate.disabled = false;
      const { latitude, longitude, accuracy } = pos.coords;
      state.userLatLng = [latitude, longitude];
      if (userMarker) map.removeLayer(userMarker);
      if (userCircle) map.removeLayer(userCircle);
      userMarker = L.circleMarker(state.userLatLng, {
        radius: 7, color: '#fff', weight: 2, fillColor: '#1f6feb', fillOpacity: 1,
      }).addTo(map).bindPopup('Twoja lokalizacja');
      userCircle = L.circle(state.userLatLng, {
        radius: accuracy, color: '#1f6feb', weight: 1, fillOpacity: 0.08,
      }).addTo(map);
      map.setView(state.userLatLng, 14);
      render();
    },
    (err) => {
      el.locate.disabled = false;
      const reasons = {
        1: 'Brak zgody na dostęp do lokalizacji.',
        2: 'Nie udało się ustalić lokalizacji.',
        3: 'Ustalanie lokalizacji trwało zbyt długo.',
      };
      el.summary.textContent = reasons[err.code] || 'Nie udało się ustalić lokalizacji.';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

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

async function init() {
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
