// === CONFIGURAZIONE API ===
// - APK (Capacitor): chiamata HTTP NATIVA via CapacitorHttp -> niente CORS,
//   funziona senza PC acceso, senza server e senza tunnel.
// - Web/PWA: fallback fetch same-origin verso il server unico (local-proxy.mjs,
//   porta 8787) che serve l'app e fa da proxy verso lefrecce.it.
const NATIVE_API_URL = 'https://www.lefrecce.it/Channels.Website.BFF.WEB/website/ticket/solutions';
const WEB_API_URL = '/';

function getCapacitorHttp() {
  try {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) || null;
  } catch {
    return null;
  }
}

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

// --- Utility ---

function getRoundedNow() {
  const now = new Date();
  now.setHours(now.getHours() + 1);
  now.setMinutes(0, 0, 0);
  return now;
}

function formatToAPIDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:00.000`;
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}

function formatFullDateTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
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

// --- API call ---

async function searchTrains() {
  const departureTime = getRoundedNow();
  const payload = { ...PAYLOAD_TEMPLATE, departureTime: formatToAPIDate(departureTime) };

  document.getElementById('searchDepartureTime').textContent = formatFullDateTime(departureTime);

  // Modalità APK (Capacitor): HTTP nativa, bypassa il CORS
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

  // Modalità web: same-origin verso il server unico (local-proxy.mjs)
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

// --- Render ---

function renderSolutions(data) {
  const container = document.getElementById('solutions');
  container.innerHTML = '';

  if (!data.solutions || data.solutions.length === 0) {
    container.innerHTML = '<div class="error"><p>Nessuna soluzione trovata.</p></div>';
    return;
  }

  // Take first 3 solutions, filter those with exactly 1 train (direct)
  const directTrains = data.solutions
    .slice(0, 3)
    .map(item => item.solution)
    .filter(solution => solution && solution.trains && solution.trains.length === 1);

  if (directTrains.length === 0) {
    container.innerHTML = '<div class="error"><p>Nessun treno diretto trovato nelle prime 3 soluzioni.</p></div>';
    return;
  }

  directTrains.forEach((solution, index) => {
    const card = createCard(solution, index);
    container.appendChild(card);
  });
}

function createCard(solution, index) {
  const div = document.createElement('div');
  div.className = 'solution-card';
  div.id = `card-${index}`;

  const train = solution.trains[0];
  const arrivalTime = solution.arrivalTime;
  const departureTime = solution.departureTime;
  const duration = solution.duration;

  div.innerHTML = `
    <div class="card-header">
      <div class="train-badge">
        <span class="train-icon">🚄</span>
        <span>${train.description}</span>
      </div>
      <span class="train-type">${train.denomination}</span>
    </div>
    <div class="card-times">
      <div class="time-block">
        <span class="label">Partenza</span>
        <span class="time">${formatTime(departureTime)}</span>
        <span class="date">${formatDate(departureTime)}</span>
      </div>
      <div class="time-divider">
        <span class="duration">${duration}</span>
        <div class="line"></div>
      </div>
      <div class="time-block" style="text-align:right">
        <span class="label">Arrivo</span>
        <span class="time">${formatTime(arrivalTime)}</span>
        <span class="date">${formatDate(arrivalTime)}</span>
      </div>
    </div>
    <div class="countdown-section">
      <div class="countdown-label">Countdown all'arrivo</div>
      <div class="countdown" id="countdown-${index}">
        <div class="countdown-unit"><span class="value">--</span><span class="unit">ore</span></div>
        <span class="countdown-sep">:</span>
        <div class="countdown-unit"><span class="value">--</span><span class="unit">min</span></div>
        <span class="countdown-sep">:</span>
        <div class="countdown-unit"><span class="value">--</span><span class="unit">sec</span></div>
      </div>
    </div>
  `;

  return div;
}

// --- Countdown updater ---

const countdownIntervals = [];

function startCountdowns(data) {
  countdownIntervals.forEach(id => clearInterval(id));
  countdownIntervals.length = 0;

  if (!data.solutions) return;

  const directTrains = data.solutions
    .slice(0, 3)
    .map(item => item.solution)
    .filter(solution => solution && solution.trains && solution.trains.length === 1);

  directTrains.forEach((solution, index) => {
    const target = new Date(solution.arrivalTime);
    const el = document.getElementById(`countdown-${index}`);
    if (!el) return;

    const intervalId = setInterval(() => {
      const now = new Date();
      const parts = getCountdownParts(target, now);

      if (!parts) {
        el.innerHTML = '<div class="countdown-finished">✓ Arrivato</div>';
        clearInterval(intervalId);
        return;
      }

      const units = el.querySelectorAll('.countdown-unit .value');
      if (units.length === 3) {
        units[0].textContent = String(parts.hours).padStart(2, '0');
        units[1].textContent = String(parts.minutes).padStart(2, '0');
        units[2].textContent = String(parts.seconds).padStart(2, '0');
      }
    }, 1000);

    countdownIntervals.push(intervalId);
  });
}

// --- Current time display ---

function updateCurrentTime() {
  const el = document.getElementById('currentTime');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
}

// --- Main flow ---

async function doSearch() {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const solutions = document.getElementById('solutions');
  const btnReload = document.getElementById('btnReload');

  loading.style.display = 'flex';
  error.style.display = 'none';
  solutions.innerHTML = '';
  btnReload.classList.add('spinning');

  countdownIntervals.forEach(id => clearInterval(id));
  countdownIntervals.length = 0;

  try {
    const data = await searchTrains();
    loading.style.display = 'none';
    btnReload.classList.remove('spinning');
    renderSolutions(data);
    startCountdowns(data);
  } catch (err) {
    loading.style.display = 'none';
    btnReload.classList.remove('spinning');
    error.style.display = 'block';
    document.getElementById('errorMessage').textContent = `Errore: ${err.message}`;
  }
}

// --- Service Worker registration ---

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
  updateCurrentTime();
  setInterval(updateCurrentTime, 1000);

  doSearch();

  document.getElementById('btnReload').addEventListener('click', doSearch);
});
