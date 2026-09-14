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
    ${isNext && currentDir === 'andata' ? '<div class="bus-info" id="bus555"><span>🚌 Bus 555: aggiornamento...</span></div>' : ''}
    <div class="card-meta">
      <span class="meta-item"${delayClass}>${escapeHtml(delayText)}</span>
      ${sol.platform ? `<span class="meta-item">Bin. ${escapeHtml(sol.platform)}</span>` : ''}
    </div>
    <button class="btn-details" type="button">Dettagli</button>
  `;

  const busEl = div.querySelector('#bus555');
  if (busEl) {
    busEl.addEventListener('click', (e) => {
      e.stopPropagation(); // non aprire la scheda dettagli
      updateBusInfo();
    });
  }

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

function renderBusInfo() {
  const el = document.getElementById('bus555');
  if (!el) return;
  if (busArrivals && busArrivals.length > 0) {
    const now = Date.now() / 1000;
    const first = busArrivals[0];
    const min = Math.max(0, Math.round((first - now) / 60));
    const t = new Date(first * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML =
      '🚌 Troverai il <b>555</b> verso Lunghezza: <b>tra ' + min + ' min</b> (arrivo ' + t + ')';
  } else if (busArrivals) {
    el.innerHTML = '🚌 Nessun <b>555</b> verso Lunghezza in arrivo alla palina di Ponte Di Nona';
  } else {
    el.innerHTML = '🚌 Bus 555: aggiornamento...';
  }
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
  const el = document.getElementById('bus555');
  if (!el) return;

  // Tutte le vetture 555 tracciate in real-time (in corsa / in capolinea)
  const now = Date.now() / 1000;
  const etas = (busArrivals || []).map(m => {
    const t = new Date(m.epoch * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (m.dir === 1) {
      // bus in arrivo al capolinea (come ProBus)
      const min = Math.max(0, Math.round((m.epoch - now) / 60));
      return min <= 0 ? 'in capolinea' : 'in arrivo tra ' + min + ' min (' + t + ')';
    }
    if (m.stopsAway === 0 && m.depEpoch) {
      // bus fermo in capolinea: countdown alla ripartenza
      const min = Math.max(0, Math.round((m.depEpoch - now) / 60));
      const dt = new Date(m.depEpoch * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      return 'parte tra ' + min + ' min (' + dt + ')';
    }
    const min = Math.max(0, Math.round((m.epoch - now) / 60));
    return min <= 0 ? 'in arrivo' : m.stopsAway + " Ferm. (" + min + "')";
  });
  const head = etas.length > 0 ? ' ' + etas.join(' · ') : '';

  // Partenze programmate di oggi (servizio: 10=feriale, 20=sabato, 30=festivi)
  const nowD = new Date();
  const dow = nowD.getDay(); // 0 dom, 6 sab
  const svc = dow === 0 ? '30' : (dow === 6 ? '20' : '10');
  const hhmm = pad2(nowD.getHours()) + ':' + pad2(nowD.getMinutes());
  let sched = [];
  if (busSchedule) {
    sched = (busSchedule.departures || [])
      .filter(d => d.s.includes(svc) && d.t >= hhmm)
      .slice(0, 3)
      .map(d => d.t);
  }

  // Correzione real-time sul primo orario in arrivo (solo vetture dir 0 = partenze)
  if (busArrivals && busArrivals.length > 0) {
    const first = busArrivals.find(m => m.dir === 0) || busArrivals[0];
    const d = new Date(first.epoch * 1000);
    const rtT = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const diff = (a, b) => {
      const [ah, am] = a.split(':').map(Number);
      const [bh, bm] = b.split(':').map(Number);
      return (ah * 60 + am) - (bh * 60 + bm);
    };
    const idx = sched.findIndex(t => Math.abs(diff(t, rtT)) <= 15);
    if (idx >= 0) sched[idx] = rtT;
    else sched.unshift(rtT);
    sched.sort();
  }

  if (!busArrivals && !busSchedule) {
    el.innerHTML = '🚌 <b>555</b> · tocca qui per aggiornare';
  } else {
    const fresh = busArrivals && Date.now() - busLastFetch < 90000;
    const live = busArrivals && busArrivals.length > 0 || fresh ? '' : ' · <i>tocca qui per aggiornamento live</i>';
    el.innerHTML = '🚌 <b>555</b>' + head + ' · partenze da Ponte Di Nona: <b>' +
      (sched.length ? sched.join(' - ') : '—') + '</b>' + live;
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

  document.getElementById('solutions').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openSheet(Number(card.dataset.idx));
  });

  document.getElementById('sheetBackdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSheet();
  });
});
