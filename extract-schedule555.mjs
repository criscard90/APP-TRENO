// Estrae dal GTFS statico l'orario delle partenze del bus 555 da Ponte Di Nona (82110)
// direzione 0 (verso Lunghezza/Pantano) e genera schedule-555.json per l'app.
// Convenzione GTFS Roma: service_id 10 = feriale, 20 = sabato, 30 = festivi.
// Uso: node extract-schedule555.mjs

import fs from 'node:fs';
import readline from 'node:readline';

const STATIC = './tmp-gtfs/static';
const OUT = './schedule-555.json';
const STOP = '82110';

// --- 1. Trip della 555 con direzione 0 ---
const tripService = {}; // trip_id -> service_id
const rl1 = readline.createInterface({ input: fs.createReadStream(`${STATIC}/trips.txt`) });
let header1 = true;
for await (const line of rl1) {
  if (header1) { header1 = false; continue; }
  const p = line.split(',');
  if (p[0] !== '555' || p[5] !== '0') continue;
  tripService[p[2]] = p[1];
}
console.error('Trip 555 dir 0:', Object.keys(tripService).length);

// --- 2. Partenze alla palina (stream su stop_times.txt, ~250MB) ---
const depByTrip = {}; // trip_id -> "HH:MM:SS"
const rl2 = readline.createInterface({ input: fs.createReadStream(`${STATIC}/stop_times.txt`) });
let header2 = true;
let scanned = 0;
for await (const line of rl2) {
  if (header2) { header2 = false; continue; }
  const p = line.split(',');
  if (p[3] !== STOP) continue;
  scanned++;
  if (tripService[p[0]] && p[2]) depByTrip[p[0]] = p[2];
}
console.error('Righe palina 82110 trovate:', scanned, '| partenze dir 0:', Object.keys(depByTrip).length);

// --- 3. Raggruppa per orario → servizi ---
const byTime = {};
for (const [tripId, t] of Object.entries(depByTrip)) {
  const svc = tripService[tripId];
  const key = t.slice(0, 5); // HH:MM
  (byTime[key] = byTime[key] || new Set()).add(svc);
}

const departures = Object.entries(byTime)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([t, svcs]) => ({ t, s: [...svcs].sort() }));

console.error('Orari distinti:', departures.length);
console.log(departures.map(d => `${d.t} [${d.s.join(',')}]`).join('\n'));

fs.writeFileSync(new URL(OUT, import.meta.url), JSON.stringify({
  generated: new Date().toISOString(),
  stop: STOP,
  note: 'Partenze bus 555 da Ponte Di Nona (82110) verso Lunghezza/Pantano. s: 10=feriale, 20=sabato, 30=festivi',
  departures
}, null, 1));
console.error('Scritto', OUT);
