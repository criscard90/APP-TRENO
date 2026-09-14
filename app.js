// === CONFIGURAZIONE ===
// Fonte dati: viaggiatreno.it (dati real-time FS, no CORS con proxy/APK nativo)
const VT_BASE = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const API_PREFIX = '/api'; // proxy locale (web). In APK nativo chiamiamo VT_BASE direttamente

const STATIONS = {
  tiburtina: { code: 'S08217', name: 'Roma Tiburtina' },
  ponte:     { code: 'S08529', name: 'Ponte Di Nona' }
};

let currentDir = 'andata'; // andata: Tiburtina → Ponte di Nona | ritorno: Ponte di Nona → Tiburtina
try { currentDir = localStorage.getItem('trenoDir') === 'ritorno' ? 'ritorno' : 'andata'; } catch {}

function getCapacitorHttp() {
  try {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) || null;
  } catch {
    return null;
  }
}

// --- Data/ora ricerca ---

function pad2(n) { return String(n).padStart(2, '0'); }

// Formato richiesto da viaggiatreno: "Mon Sep 14 2026 08:04:44 GMT+0200"
function formatVTDate(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hh = pad2(Math.floor(Math.abs(offset) / 60));
  const mm = pad2(Math.abs(offset) % 60);
  return encodeURIComponent(
    `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()} ${date.getFullYear()} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} GMT${sign}${hh}${mm}`
  );
}

function getNow() {
  const now = new Date();
  now.setSeconds(0, 0);
  return now;
}

function setDefaultInputs() {
  const d = getNow();
  const date = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  document.getElementById('inputDate').value = date;
  document.getElementById('inputTime').value = time;
}

function getChosenDate() {
  const date = document.getElementById('inputDate').value;
  const time = document.getElementById('inputTime').value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)) {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }
  return getNow();
}

// --- Chiamate API viaggiatreno ---

async function vtGet(endpoint) {
  // endpoint es: /partenze/S08217/<encodedDate>
  const url = VT_BASE + endpoint;
  const http = getCapacitorHttp();

  if (http) {
    const response = await http.request({ url, method: 'GET', headers: { 'Accept': 'application/json' } });
    if (response.status < 200 || response.status >= 300) {
      throw new Error('Errore API: ' + response.status);
    }
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  }

  // Web: via proxy locale
  const proxyUrl = API_PREFIX + endpoint;
  const response = await fetch(proxyUrl);
  if (!response.ok) throw new Error('Errore API: ' + response.status);
  return response.json();
}

async function searchTrains() {
  const date = getChosenDate();
  const dateParam = formatVTDate(date);

  const isAndata = currentDir === 'andata';
  const originCode = isAndata ? STATIONS.tiburtina.code : STATIONS.ponte.code;
  const destCode = isAndata ? STATIONS.ponte.code : STATIONS.tiburtina.code;

  // Partenze dalla stazione di origine + arrivi alla stazione di destinazione
  const [departures, arrivals] = await Promise.all([
    vtGet(`/partenze/${originCode}/${dateParam}`),
    vtGet(`/arrivi/${destCode}/${dateParam}`)
  ]);

  // Mappa arrivi per numero treno (solo regionali)
  const arrivalMap = {};
  (arrivals || []).forEach(a => {
    if (a.categoria === 'REG' && a.numeroTreno != null) {
      arrivalMap[a.numeroTreno] = a;
    }
  });

  // Filtra partenze regionali che hanno un arrivo corrispondente alla destinazione
  const now = Date.now();
  const solutions = (departures || [])
    .filter(d => d.categoria === 'REG' && d.numeroTreno != null)
    .map(d => {
      const arr = arrivalMap[d.numeroTreno];
      if (!arr) return null;
      const depMs = d.orarioPartenza;
      const arrMs = arr.orarioArrivo;
      if (!depMs || !arrMs) return null;
      if (depMs < now) return null; // già partito
      const durationMs = arrMs - depMs;
      return {
        trainNumber: d.numeroTreno,
        category: (d.categoriaDescrizione || d.categoria || '').trim(),
        formattedTrain: d.compNumeroTreno || (d.categoria + ' ' + d.numeroTreno),
        departureMs: depMs,
        arrivalMs: arrMs,
        durationMs: durationMs,
        delay: d.ritardo || 0,
        platform: d.binarioProgrammatoPartenzaDescrizione || d.binarioEffettivoPartenzaDescrizione || '',
        nonPartito: d.nonPartito !== false,
        origin: isAndata ? STATIONS.tiburtina.name : STATIONS.ponte.name,
        destination: isAndata ? STATIONS.ponte.name : STATIONS.tiburtina.name
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.departureMs - b.departureMs)
    .slice(0, 5);

  return solutions;
}

// --- Render soluzioni ---

let activeSolutions = [];
const countdownIntervals = [];

function formatTime(ms) {
  const d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' });
}

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return totalMin + ' min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? h + 'h ' + m + 'min' : h + 'h';
}

function getCountdownParts(targetMs, nowMs) {
  const diff = targetMs - nowMs;
  if (diff <= 0) return null;
  const totalSec = Math.floor(diff / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { hours, minutes, seconds };
}

function renderSolutions(solutions) {
  const container = document.getElementById('solutions');
  const info = document.getElementById('resultsInfo');
  container.innerHTML = '';

  if (!solutions || solutions.length === 0) {
    info.style.display = 'none';
    container.innerHTML = '<div class="error"><p>Nessun treno regionale trovato. Prova a cambiare data o ora.</p></div>';
    return;
  }

  activeSolutions = solutions;
  info.style.display = 'block';
  info.textContent = solutions.length + (solutions.length === 1 ? ' treno regionale' : ' treni regionali') + ' · tocca la card per i dettagli';

  solutions.forEach((sol, i) => {
    container.appendChild(createCard(sol, i, i === 0));
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function createCard(sol, index, isNext) {
  const div = document.createElement('div');
  div.className = 'card' + (isNext ? ' next' : '');
  div.dataset.idx = String(index);

  const delayText = sol.delay > 0 ? '+' + sol.delay + ' min' : 'in orario';
  const delayClass = sol.delay > 0 ? ' style="color:var(--accent)"' : ' style="color:var(--good)"';

  div.innerHTML = `
    <div class="card-top">
      <span class="train-chip">${escapeHtml(sol.formattedTrain)}</span>
      ${isNext ? '<span class="next-chip">PROSSIMO</span>' : ''}
      <span class="dur-chip">${escapeHtml(formatDuration(sol.durationMs))}</span>
    </div>
    <div class="times-row">
      <div class="t-block">
        <span class="t-label">Partenza</span>
        <span class="t-time">${formatTime(sol.departureMs)}</span>
        <span class="t-date">${formatDate(sol.departureMs)}</span>
      </div>
      <span class="t-arrow">→</span>
      <div class="t-block right">
        <span class="t-label">Arrivo</span>
        <span class="t-time">${formatTime(sol.arrivalMs)}</span>
        <span class="t-date">${formatDate(sol.arrivalMs)}</span>
      </div>
    </div>
    <div class="cd-row">
      <span class="cd-label">Parte tra</span>
      <span class="cd-value" id="cd-${index}">--:--:--</span>
    </div>
    <div class="card-meta">
      <span class="meta-item"${delayClass}>${escapeHtml(delayText)}</span>
      ${sol.platform ? `<span class="meta-item">Bin. ${escapeHtml(sol.platform)}</span>` : ''}
    </div>
    <button class="btn-details" type="button">Dettagli</button>
  `;

  return div;
}

// --- Countdown realtime ---

function startCountdowns() {
  countdownIntervals.forEach(id => clearInterval(id));
  countdownIntervals.length = 0;

  activeSolutions.forEach((sol, index) => {
    const el = document.getElementById('cd-' + index);
    if (!el) return;

    const tick = () => {
      const parts = getCountdownParts(sol.departureMs, Date.now());
      if (!parts) {
        el.textContent = '✓ partito';
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

  const delayText = s.delay > 0 ? '+' + s.delay + ' min di ritardo' : 'In orario';
  const delayClass = s.delay > 0 ? 'accent' : 'good';

  document.getElementById('sheetContent').innerHTML = `
    <div class="sheet-title">${escapeHtml(s.origin)} → ${escapeHtml(s.destination)}</div>
    <div class="sheet-sub">${escapeHtml(s.formattedTrain)} · ${escapeHtml(formatDuration(s.durationMs))}</div>
    <div class="sheet-grid">
      <div class="info-box">
        <div class="k">Partenza</div>
        <div class="v big">${formatTime(s.departureMs)}</div>
        <div class="v">${formatDate(s.departureMs)}</div>
      </div>
      <div class="info-box">
        <div class="k">Arrivo</div>
        <div class="v big">${formatTime(s.arrivalMs)}</div>
        <div class="v">${formatDate(s.arrivalMs)}</div>
      </div>
      <div class="info-box">
        <div class="k">Ritardo</div>
        <div class="v big ${delayClass}">${escapeHtml(delayText)}</div>
      </div>
      <div class="info-box">
        <div class="k">Binario</div>
        <div class="v big">${escapeHtml(s.platform || '—')}</div>
      </div>
      <div class="info-box">
        <div class="k">Categoria</div>
        <div class="v">${escapeHtml(s.category || 'Regionale')}</div>
      </div>
      <div class="info-box">
        <div class="k">Numero treno</div>
        <div class="v">${escapeHtml(s.trainNumber)}</div>
      </div>
    </div>
  `;

  document.getElementById('sheetBackdrop').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheetBackdrop').classList.remove('open');
}

// --- Percorso (direzione) ---

function updateRouteUI() {
  const isAndata = currentDir === 'andata';
  document.getElementById('routeFrom').textContent = isAndata ? STATIONS.tiburtina.name : STATIONS.ponte.name;
  document.getElementById('routeTo').textContent = isAndata ? STATIONS.ponte.name : STATIONS.tiburtina.name;
}

function swapDirection() {
  currentDir = currentDir === 'andata' ? 'ritorno' : 'andata';
  try { localStorage.setItem('trenoDir', currentDir); } catch {}
  updateRouteUI();
  doSearch();
}

// --- Orologio realtime ---

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

  loading.style.display = 'flex';
  error.style.display = 'none';
  solutions.innerHTML = '';
  info.style.display = 'none';

  countdownIntervals.forEach(id => clearInterval(id));
  countdownIntervals.length = 0;
  activeSolutions = [];

  try {
    const solutions = await searchTrains();
    loading.style.display = 'none';
    renderSolutions(solutions);
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
