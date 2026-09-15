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
      if (depMs >= arrMs) return null; // partenza dopo l'arrivo = treno nella direzione opposta, scarta
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
  info.textContent = solutions.length + (solutions.length === 1 ? ' treno regionale' : ' treni regionali');

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

// --- Bus 555 (GTFS-RT ufficiale romamobilita.it, palina Ponte Di Nona 82110) ---

const BUS_RT_URL = 'https://romamobilita.it/sites/default/files/rome_rtgtfs_trip_updates_feed.pb';
const BUS_PROXY = '/bus555rt'; // proxy locale filtrato (web). In APK chiamiamo BUS_RT_URL direttamente
const BUS_STOP_ID = '82110';   // PONTE DI NONA (FL2)
const BUS_DIR = 0;             // 0 = verso Lunghezza/Pantano (il bus che prendi a Ponte Di Nona)
let busIntervalId = null;
let busRenderId = null;
let busAutoInterval = null;
let busFetching = false;
let busAutoActive = false;
let busArrivals = null; // [{epoch, stopsAway}] dir 0, già ordinate
let busSchedule = null; // schedule-555.json (orario programmato ufficiale)
let busLastFetch = 0;

function pbReadVarint(b, pos) {
  let result = 0n, shift = 0n;
  while (true) {
    if (pos >= b.length) throw new Error('varint overflow');
    const byte = b[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, next: pos };
}

function pbDecodeFields(b, start, end) {
  const fields = [];
  let pos = start;
  while (pos < end) {
    const tag = pbReadVarint(b, pos);
    pos = tag.next;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (fieldNumber === 0) break;
    if (wireType === 0) {
      const v = pbReadVarint(b, pos);
      pos = v.next;
      fields.push({ field: fieldNumber, varint: v.value });
    } else if (wireType === 2) {
      const len = pbReadVarint(b, pos);
      pos = len.next;
      const l = Number(len.value);
      if (pos + l > end) break;
      fields.push({ field: fieldNumber, data: b.subarray(pos, pos + l) });
      pos += l;
    } else if (wireType === 5) pos += 4;
    else if (wireType === 1) pos += 8;
    else break;
  }
  return fields;
}

const pbAll = (fs, n) => fs.filter(f => f.field === n);
const pbOne = (fs, n) => fs.find(f => f.field === n);
const pbStr = f => (f && f.data ? new TextDecoder().decode(f.data) : null);
const pbInt = f => (f && f.varint !== undefined ? Number(f.varint) : null);

// Estrae TUTTE le vetture 555 tracciate in tempo reale alla palina 82110:
// - dir 0 = partenza da capolinea verso Lunghezza (stopsAway = fermate di distanza, depEpoch = ripartenza)
// - dir 1 = in arrivo al capolinea (stessa visualizzazione di ProBus)
function parseBus555RT(pb) {
  const top = pbDecodeFields(pb, 0, pb.length);
  const now = Date.now() / 1000;
  const out = [];

  for (const entRaw of pbAll(top, 2)) { // FeedEntity
    const ef = pbDecodeFields(entRaw.data, 0, entRaw.data.length);
    const tuRaw = pbOne(ef, 3); // TripUpdate
    if (!tuRaw) continue;
    const tu = pbDecodeFields(tuRaw.data, 0, tuRaw.data.length);

    const tripRaw = pbOne(tu, 1); // TripDescriptor
    if (!tripRaw) continue;
    const trip = pbDecodeFields(tripRaw.data, 0, tripRaw.data.length);
    if (pbStr(pbOne(trip, 5)) !== '555') continue;
    const dir = pbInt(pbOne(trip, 6));
    if (dir !== 0 && dir !== 1) continue;

    const stus = pbAll(tu, 2).map(s => pbDecodeFields(s.data, 0, s.data.length));
    const myStop = stus.find(s => pbStr(pbOne(s, 4)) === BUS_STOP_ID);
    if (!myStop) continue;
    const arrRaw = pbOne(myStop, 2);
    if (!arrRaw) continue;
    const arr = pbDecodeFields(arrRaw.data, 0, arrRaw.data.length);
    const epoch = pbInt(pbOne(arr, 2));
    if (!epoch || epoch - now <= -60) continue;

    // partenza prevista dalla palina (dir 0 fermo in capolinea: stopsAway = 0)
    const depRaw = pbOne(myStop, 3);
    let depEpoch = null;
    if (depRaw) {
      const dep = pbDecodeFields(depRaw.data, 0, depRaw.data.length);
      depEpoch = pbInt(pbOne(dep, 2));
    }

    // fermate di distanza (solo dir 0)
    const mySeq = pbInt(pbOne(myStop, 1));
    const stopsAway = dir === 0
      ? stus.filter(s => {
          const seq = pbInt(pbOne(s, 1));
          return seq !== null && mySeq !== null && seq < mySeq;
        }).length
      : -1; // dir 1: non applicabile

    out.push({ epoch, depEpoch, stopsAway, dir });
  }
  return out.sort((a, b) => a.epoch - b.epoch);
}

async function fetchBus555() {
  const http = getCapacitorHttp();
  if (http) {
    const resp = await http.request({
      url: BUS_RT_URL,
      method: 'GET',
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (resp.status !== 200) return null;
    let bytes;
    if (resp.data instanceof ArrayBuffer) bytes = new Uint8Array(resp.data);
    else if (resp.data && resp.data.buffer instanceof ArrayBuffer) bytes = new Uint8Array(resp.data.buffer);
    else if (typeof resp.data === 'string') { // fallback base64
      const bin = atob(resp.data);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else return null;
    return parseBus555RT(bytes);
  }
  const resp = await fetch(BUS_PROXY);
  if (!resp.ok) return null;
  return parseBus555RT(new Uint8Array(await resp.arrayBuffer()));
}

async function updateBusInfo() {
  if (busFetching) return;
  busFetching = true;
  renderBusInfo();
  try {
    const arrivals = await fetchBus555();
    busArrivals = arrivals || [];
    busLastFetch = Date.now();
  } catch {
    busArrivals = busArrivals || [];
  }
  busFetching = false;
  renderBusInfo();
}

function renderBusInfo() {
  const liveEl = document.getElementById('busLive');
  const nextEl = document.getElementById('busNext');
  const updEl = document.getElementById('busUpdated');
  if (!liveEl || !nextEl) return;

  const now = Date.now() / 1000;
  const tOf = e => {
    const d = new Date(e * 1000);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };
  const row = (label, time, badge, cls) =>
    '<div class="bus-row' + (cls ? ' ' + cls : '') + '">' +
      '<span class="bus-label">' + label + '</span>' +
      '<span class="bus-right"><b class="bus-time">' + time + '</b>' +
      (badge ? '<span class="bus-badge">' + badge + '</span>' : '') + '</span>' +
    '</div>';

  // --- Sezione: in tempo reale (tutte le vetture tracciate) ---
  let liveHtml;
  if (busArrivals === null) {
    liveHtml = '<div class="bus-row muted">Aggiornamento…</div>';
  } else if (busArrivals.length === 0) {
    liveHtml = '<div class="bus-row muted">Nessuna vettura 555 tracciata in questo momento</div>';
  } else {
    liveHtml = busArrivals.map(m => {
      const min = Math.max(0, Math.round((m.epoch - now) / 60));
      if (m.dir === 1) {
        // bus in arrivo al capolinea (stessa vista di ProBus)
        return row('In arrivo al capolinea', tOf(m.epoch), min <= 0 ? 'in capolinea' : 'tra ' + min + ' min');
      }
      if (m.stopsAway === 0 && m.depEpoch) {
        // bus fermo in capolinea: countdown alla ripartenza
        const dmin = Math.max(0, Math.round((m.depEpoch - now) / 60));
        return row('In capolinea · riparte', tOf(m.depEpoch), 'tra ' + dmin + ' min', 'ready');
      }
      return row('In corsa · ' + m.stopsAway + (m.stopsAway === 1 ? ' fermata' : ' fermate'), tOf(m.epoch),
        min <= 0 ? 'in arrivo' : 'tra ' + min + ' min');
    }).join('');
  }
  liveEl.innerHTML = liveHtml;

  // --- Sezione: prossime partenze programmate di oggi (10=feriale, 20=sabato, 30=festivi) ---
  const nowD = new Date();
  const dow = nowD.getDay(); // 0 dom, 6 sab
  const svc = dow === 0 ? '30' : (dow === 6 ? '20' : '10');
  const hhmm = pad2(nowD.getHours()) + ':' + pad2(nowD.getMinutes());
  let sched = busSchedule
    ? (busSchedule.departures || [])
        .filter(d => d.s.includes(svc) && d.t >= hhmm)
        .slice(0, 3)
        .map(d => ({ t: d.t, live: false, arriving: false }))
    : [];

  // Correzione real-time:
  // - dir 0 = vettura che parte dalla palina → sostituisce/inserisce l'orario programmato
  // - dir 1 = vettura in arrivo al capolinea → è la stessa che poi riparte: evidenzia la
  //   partenza programmata corrispondente (stesso orario = stesso bus, non due eventi)
  const diff = (a, b) => {
    const [ah, am] = a.split(':').map(Number);
    const [bh, bm] = b.split(':').map(Number);
    return (ah * 60 + am) - (bh * 60 + bm);
  };
  if (busArrivals && busArrivals.length > 0) {
    const dep0 = busArrivals.find(m => m.dir === 0);
    if (dep0) {
      const rtT = tOf(dep0.epoch);
      const idx = sched.findIndex(o => Math.abs(diff(o.t, rtT)) <= 15);
      if (idx >= 0) sched[idx] = { t: rtT, live: true, arriving: false };
      else { sched.unshift({ t: rtT, live: true, arriving: false }); sched.sort((a, b) => diff(a.t, b.t)); }
      sched = sched.slice(0, 3);
    }
    const arr1 = busArrivals.find(m => m.dir === 1);
    if (arr1) {
      const at = tOf(arr1.epoch);
      const idx = sched.findIndex(o => Math.abs(diff(o.t, at)) <= 5);
      if (idx >= 0 && !sched[idx].live) sched[idx] = { t: at, live: true, arriving: true };
    }
  }

  nextEl.innerHTML = sched.length
    ? sched.map(o =>
        '<div class="bus-dep' + (o.live ? ' live' : '') + '">' +
          '<span class="bus-dep-time">' + o.t + '</span>' +
          (o.arriving ? '<span class="bus-dep-tag arr">bus in arrivo → poi riparte</span>'
            : o.live ? '<span class="bus-dep-tag">tempo reale</span>' : '<span class="bus-dep-tag">programmato</span>') +
        '</div>'
      ).join('')
    : '<div class="bus-row muted">Nessuna partenza programmata per il resto di oggi</div>';

  if (updEl) {
    updEl.textContent = busLastFetch
      ? 'Dati RT aggiornati alle ' + new Date(busLastFetch).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '';
  }
}

// Tick ogni 15s: aggiorna i minuti a schermo e attiva la modalità automatica
// quando l'arrivo del prossimo treno è a ≤ 5 minuti (finestra di 5 min prima a 10 min dopo)
function busTick() {
  const sol = currentDir === 'andata' ? activeSolutions[0] : null;
  const nowMs = Date.now();
  const shouldAuto = !!(sol && nowMs >= sol.arrivalMs - 5 * 60000 && nowMs <= sol.arrivalMs + 10 * 60000);
  if (shouldAuto && !busAutoActive) {
    busAutoActive = true;
    updateBusInfo();
    busAutoInterval = setInterval(updateBusInfo, 60000);
  } else if (!shouldAuto && busAutoActive) {
    busAutoActive = false;
    clearInterval(busAutoInterval);
    busAutoInterval = null;
  }
  renderBusInfo();
}

function startBusPolling() {
  if (busRenderId) clearInterval(busRenderId);
  busRenderId = setInterval(busTick, 15000);
  busTick();
}

// --- Tab (Treni / Bus 555) ---

let currentTab = 'treni';

function switchTab(tab) {
  currentTab = tab;
  const treni = tab === 'treni';
  document.getElementById('tabTreni').classList.toggle('active', treni);
  document.getElementById('tabBus').classList.toggle('active', !treni);
  document.getElementById('pageTreni').style.display = treni ? '' : 'none';
  document.getElementById('pageBus').style.display = treni ? 'none' : '';
  if (!treni) renderBusInfo();
  try { localStorage.setItem('trenoTab', tab); } catch {}
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
    renderBusInfo();
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
  startBusPolling();
  updateBusInfo(); // primo fetch tempo reale all'avvio

  fetch('schedule-555.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => { busSchedule = j; renderBusInfo(); })
    .catch(() => {});

  document.getElementById('routeBadge').addEventListener('click', swapDirection);
  document.getElementById('btnSearch').addEventListener('click', doSearch);
  document.getElementById('btnNow').addEventListener('click', () => {
    setDefaultInputs();
    doSearch();
  });

  document.getElementById('btnRefresh').addEventListener('click', () => {
    doSearch();
    updateBusInfo();
  });

  document.getElementById('btnBusRefresh').addEventListener('click', updateBusInfo);
  document.getElementById('tabTreni').addEventListener('click', () => switchTab('treni'));
  document.getElementById('tabBus').addEventListener('click', () => switchTab('bus'));

  try {
    const saved = localStorage.getItem('trenoTab');
    if (saved === 'bus') switchTab('bus');
  } catch {}
});
