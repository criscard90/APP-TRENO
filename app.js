// === CONFIGURAZIONE API ===
// - APK (Capacitor): HTTP nativa via CapacitorHttp -> niente CORS, niente PC.
// - Web/PWA: fetch same-origin verso il server unico (local-proxy.mjs, :8787).
const NATIVE_API_URL = 'https://www.lefrecce.it/Channels.Website.BFF.WEB/website/ticket/solutions';
const WEB_API_URL = '/';

// === PERCORSI ===
const ROUTES = {
  andata: { from: 'Roma Tiburtina', to: 'Ponte Di Nona', dep: 830008217, arr: 830013705 },
  ritorno: { from: 'Ponte Di Nona', to: 'Roma Tiburtina', dep: 830013705, arr: 830008217 }
};

let currentDir = 'andata';
try { currentDir = localStorage.getItem('trenoDir') === 'ritorno' ? 'ritorno' : 'andata'; } catch {}

const PAYLOAD_TEMPLATE = {
  departureLocationId: 830008217,
  arrivalLocationId: 830013705,
  departureTime: '',
  adults: 1,
  children: 0,
  criteria: {
    frecceOnly: false,
    regionalOnly: false,
    intercityOnly: false,
    tourismOnly: false,
    noChanges: false,
    order: 'DEPARTURE_DATE',
    offset: 0,
    limit: 10
  },
  advancedSearchRequest: {
    bestFare: false,
    bikeFilter: false,
    forwardDiscountCodes: []
  }
};

function getCapacitorHttp() {
  try {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) || null;
  } catch {
    return null;
  }
}

// --- Data/ora ricerca ---

function getRoundedNow() {
  const now = new Date();
  now.setHours(now.getHours() + 1);
  now.setMinutes(0, 0, 0);
  return now;
}

function setDefaultInputs() {
  const d = getRoundedNow();
  const date = d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  const time = String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0');
  document.getElementById('inputDate').value = date;
  document.getElementById('inputTime').value = time;
}

function getChosenDeparture() {
  const date = document.getElementById('inputDate').value;
  const time = document.getElementById('inputTime').value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)) {
    return date + 'T' + time + ':00.000';
  }
  // fallback: adesso arrotondato all'ora successiva
  return formatToAPIDate(getRoundedNow());
}

function formatChosen(dateStr) {
  // "2026-09-14T16:00:00.000" -> "lun 14 set, 16:00"
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dateStr);
  if (!m) return dateStr;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' }) +
    ' · ' + m[4] + ':' + m[5];
}

// --- Utility formattazione ---

function formatToAPIDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + d + 'T' + h + ':' + min + ':00.000';
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' });
}

function getCountdownParts(targetDate, now) {
  const diff = targetDate.getTime() - now.getTime();
  if (diff <= 0) return null;
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

function pad2(n) { return String(n).padStart(2, '0'); }

// --- Chiamata API (dual-mode: nativa APK / web same-origin) ---

async function searchTrains(departureTime) {
  const route = ROUTES[currentDir] || ROUTES.andata;
  const payload = {
    ...PAYLOAD_TEMPLATE,
    departureLocationId: route.dep,
    arrivalLocationId: route.arr,
    departureTime: departureTime
  };

  const http = getCapacitorHttp();
  if (http) {
    const response = await http.request({
      url: NATIVE_API_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: payload
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error('Errore API: ' + response.status);
    }
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  }

  const response = await fetch(WEB_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'ngrok-skip-browser-warning': '1'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error('Errore API: ' + response.status + ' ' + response.statusText);
  }
  return response.json();
}

// --- Render soluzioni ---

let activeSolutions = [];
const countdownIntervals = [];

function renderSolutions(data) {
  const container = document.getElementById('solutions');
  const info = document.getElementById('resultsInfo');
  container.innerHTML = '';

  const all = (data && data.solutions) || [];
  const direct = all
    .slice(0, 3)
    .map(item => item.solution)
    .filter(s => s && s.trains && s.trains.length === 1);

  if (direct.length === 0) {
    info.style.display = 'none';
    container.innerHTML = '<div class="error"><p>Nessun treno diretto trovato. Prova a cambiare data o ora.</p></div>';
    return;
  }

  activeSolutions = direct;
  info.style.display = 'block';
  info.textContent = direct.length + (direct.length === 1 ? ' treno diretto' : ' treni diretti') + ' · tocca la card per i dettagli';

  direct.forEach((solution, i) => {
    container.appendChild(createCard(solution, i, i === 0));
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function createCard(solution, index, isNext) {
  const div = document.createElement('div');
  div.className = 'card' + (isNext ? ' next' : '');
  div.dataset.idx = String(index);

  const train = solution.trains[0];
  const trainLabel = (train.acronym || '') + ' ' + (train.description || '');

  div.innerHTML = `
    <div class="card-top">
      <span class="train-chip">${escapeHtml(trainLabel)}</span>
      ${isNext ? '<span class="next-chip">PROSSIMO</span>' : ''}
      <span class="dur-chip">${escapeHtml(solution.duration || '')}</span>
    </div>
    <div class="times-row">
      <div class="t-block">
        <span class="t-label">Partenza</span>
        <span class="t-time">${formatTime(solution.departureTime)}</span>
        <span class="t-date">${formatDate(solution.departureTime)}</span>
      </div>
      <span class="t-arrow">→</span>
      <div class="t-block right">
        <span class="t-label">Arrivo</span>
        <span class="t-time">${formatTime(solution.arrivalTime)}</span>
        <span class="t-date">${formatDate(solution.arrivalTime)}</span>
      </div>
    </div>
    <div class="cd-row">
      <span class="cd-label">${isNext ? 'Prossimo arrivo' : 'Arrivo'}</span>
      <span class="cd-value" id="cd-${index}">--:--:--</span>
    </div>
    <button class="btn-details" type="button">Dettagli</button>
  `;

  return div;
}

// --- Countdown realtime ---

function startCountdowns() {
  countdownIntervals.forEach(id => clearInterval(id));
  countdownIntervals.length = 0;

  activeSolutions.forEach((solution, index) => {
    const target = new Date(solution.arrivalTime);
    const el = document.getElementById('cd-' + index);
    if (!el) return;

    const tick = () => {
      const parts = getCountdownParts(target, new Date());
      if (!parts) {
        el.textContent = '✓ arrivato';
        el.classList.add('done');
        clearInterval(countdownIntervals[index]);
        return;
      }
      el.textContent = pad2(parts.hours) + ':' + pad2(parts.minutes) + ':' + pad2(parts.seconds);
    };

    tick();
    countdownIntervals[index] = setInterval(tick, 1000);
  });
}

// --- Scheda dettagli (bottom sheet) ---

function openSheet(index) {
  const s = activeSolutions[index];
  if (!s) return;

  const train = s.trains[0];
  const price = s.price && typeof s.price.amount === 'number'
    ? s.price.amount.toFixed(2) + ' €' : '—';
  const grid = s.grids && s.grids[0];
  const service = grid && grid.services && grid.services[0];
  const offer = service && service.offers && service.offers[0];
  const status = s.status === 'SALEABLE' ? 'Acquistabile' : (s.status || '—');

  let legsHtml = '';
  if (s.nodes && s.nodes.length) {
    legsHtml = s.nodes.map(n =>
      '<div class="leg">' +
        '<span class="train-name">' + escapeHtml(((n.train && n.train.acronym) || '') + ' ' + ((n.train && n.train.description) || '')) + '</span>' +
        '<span class="leg-times">' + formatTime(n.departureTime) + ' → ' + formatTime(n.arrivalTime) + '</span>' +
      '</div>'
    ).join('');
  }

  document.getElementById('sheetContent').innerHTML = `
    <div class="sheet-title">${escapeHtml(s.origin)} → ${escapeHtml(s.destination)}</div>
    <div class="sheet-sub">${escapeHtml((train.denomination || '') + ' ' + (train.description || ''))} · ${escapeHtml(s.duration || '')}</div>
    <div class="sheet-grid">
      <div class="info-box">
        <div class="k">Partenza</div>
        <div class="v big">${formatTime(s.departureTime)}</div>
        <div class="v">${formatDate(s.departureTime)}</div>
      </div>
      <div class="info-box">
        <div class="k">Arrivo</div>
        <div class="v big">${formatTime(s.arrivalTime)}</div>
        <div class="v">${formatDate(s.arrivalTime)}</div>
      </div>
      <div class="info-box">
        <div class="k">Prezzo</div>
        <div class="v big accent">${price}</div>
      </div>
      <div class="info-box">
        <div class="k">Stato</div>
        <div class="v ${s.status === 'SALEABLE' ? 'good' : ''}">${escapeHtml(status)}</div>
      </div>
      <div class="info-box">
        <div class="k">Classe</div>
        <div class="v">${escapeHtml((service && service.shortName) || '—')}</div>
      </div>
      <div class="info-box">
        <div class="k">Tariffa</div>
        <div class="v">${escapeHtml((offer && offer.name) || '—')}</div>
      </div>
    </div>
    ${legsHtml ? '<div class="legs"><div class="legs-title">Tratte</div>' + legsHtml + '</div>' : ''}
  `;

  document.getElementById('sheetBackdrop').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheetBackdrop').classList.remove('open');
}

// --- Percorso (direzione) ---

function updateRouteUI() {
  const route = ROUTES[currentDir] || ROUTES.andata;
  document.getElementById('routeFrom').textContent = route.from;
  document.getElementById('routeTo').textContent = route.to;
}

function swapDirection() {
  currentDir = currentDir === 'andata' ? 'ritorno' : 'andata';
  try { localStorage.setItem('trenoDir', currentDir); } catch {}
  updateRouteUI();
  doSearch();
}

// --- Orologio realtime (in alto a destra) ---

function updateClock() {
  const now = new Date();
  document.getElementById('currentTime').textContent =
    now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' +
    now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// --- Flusso principale ---

async function doSearch() {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const solutions = document.getElementById('solutions');
  const info = document.getElementById('resultsInfo');

  const departureTime = getChosenDeparture();

  loading.style.display = 'flex';
  error.style.display = 'none';
  solutions.innerHTML = '';
  info.style.display = 'none';

  countdownIntervals.forEach(id => clearInterval(id));
  countdownIntervals.length = 0;
  activeSolutions = [];

  try {
    const data = await searchTrains(departureTime);
    loading.style.display = 'none';
    renderSolutions(data);
    startCountdowns();
  } catch (err) {
    loading.style.display = 'none';
    error.style.display = 'block';
    document.getElementById('errorMessage').textContent = 'Errore: ' + err.message;
  }
}

// --- Service worker (solo web, non in APK) ---

if ('serviceWorker' in navigator && !getCapacitorHttp()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
  setDefaultInputs();
  updateRouteUI();
  updateClock();
  setInterval(updateClock, 1000);

  doSearch();

  document.getElementById('routeBadge').addEventListener('click', swapDirection);
  document.getElementById('btnSearch').addEventListener('click', doSearch);
  document.getElementById('btnNow').addEventListener('click', () => {
    setDefaultInputs();
    doSearch();
  });

  document.getElementById('solutions').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openSheet(Number(card.dataset.idx));
  });

  document.getElementById('sheetBackdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSheet();
  });
});
