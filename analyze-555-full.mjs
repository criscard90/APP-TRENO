// Analisi completa dei trip 555 nel feed GTFS-RT
// Uso: node analyze-555-full.mjs [file.pb]

import fs from 'node:fs';

const file = process.argv[2] || './tmp-gtfs/fresh.pb';
const buf = fs.readFileSync(new URL(file, import.meta.url));

function readVarint(b, pos) {
  let result = 0n, shift = 0n;
  while (true) {
    const byte = b[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, next: pos };
}
function decodeFields(b, start, end) {
  const fields = [];
  let pos = start;
  while (pos < end) {
    const tag = readVarint(b, pos);
    pos = tag.next;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (fieldNumber === 0) break;
    if (wireType === 0) { const v = readVarint(b, pos); pos = v.next; fields.push({ field: fieldNumber, varint: v.value }); }
    else if (wireType === 2) { const len = readVarint(b, pos); pos = len.next; const l = Number(len.value); if (pos + l > end) break; fields.push({ field: fieldNumber, data: b.subarray(pos, pos + l) }); pos += l; }
    else if (wireType === 5) pos += 4;
    else if (wireType === 1) pos += 8;
    else break;
  }
  return fields;
}
const all = (fs, n) => fs.filter(f => f.field === n);
const one = (fs, n) => fs.find(f => f.field === n);
const str = f => (f && f.data ? new TextDecoder().decode(f.data) : null);
const int = f => (f && f.varint !== undefined ? Number(f.varint) : null);

const top = decodeFields(buf, 0, buf.length);
const now = Date.now() / 1000;
const trips = [];

for (const entRaw of all(top, 2)) {
  const ef = decodeFields(entRaw.data, 0, entRaw.data.length);
  const tuRaw = one(ef, 3);
  if (!tuRaw) continue;
  const tu = decodeFields(tuRaw.data, 0, tuRaw.data.length);
  const tripRaw = one(tu, 1);
  if (!tripRaw) continue;
  const trip = decodeFields(tripRaw.data, 0, tripRaw.data.length);
  if (str(one(trip, 5)) !== '555') continue;

  const dir = int(one(trip, 6));
  const start = str(one(trip, 2));
  let stop82110 = null;
  let firstStop = null, firstArr = null;
  for (const stuRaw of all(tu, 2)) {
    const stu = decodeFields(stuRaw.data, 0, stuRaw.data.length);
    const stopId = str(one(stu, 4));
    const arrRaw = one(stu, 2);
    let epoch = null;
    if (arrRaw) { const arr = decodeFields(arrRaw.data, 0, arrRaw.data.length); epoch = int(one(arr, 2)); }
    if (firstStop === null) { firstStop = stopId; firstArr = epoch; }
    if (stopId === '82110' && epoch) stop82110 = epoch;
  }
  trips.push({ dir, start, stop82110, firstStop, firstArr });
}

trips.sort((a, b) => (a.stop82110 || a.firstArr || 0) - (b.stop82110 || b.firstArr || 0));
console.log(`Adesso: ${new Date(now * 1000).toLocaleTimeString('it-IT')} | Trip 555 nel feed: ${trips.length}\n`);
for (const t of trips) {
  const s8 = t.stop82110 ? new Date(t.stop82110 * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + ` (tra ${Math.round((t.stop82110 - now) / 60)} min)` : '—';
  const f1 = t.firstArr ? new Date(t.firstArr * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + ` (tra ${Math.round((t.firstArr - now) / 60)} min)` : '—';
  console.log(`dir ${t.dir} | partenza ${t.start} | prima fermata nel feed: ${t.firstStop} alle ${f1} | stop 82110: ${s8}`);
}
