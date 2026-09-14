// Test end-to-end:Scarica il feed filtrato dal proxy e lo parsa con la stessa logica dell'app
const PROXY = 'http://localhost:8787/bus555rt';

function readVarint(b, pos) {
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

const buf = new Uint8Array(await (await fetch(PROXY)).arrayBuffer());
console.log('Feed filtrato:', buf.length, 'bytes');

const top = decodeFields(buf, 0, buf.length);
const now = Date.now() / 1000;
const rows = [];
for (const entRaw of all(top, 2)) {
  const ef = decodeFields(entRaw.data, 0, entRaw.data.length);
  const tuRaw = one(ef, 3);
  if (!tuRaw) continue;
  const tu = decodeFields(tuRaw.data, 0, tuRaw.data.length);
  const tripRaw = one(tu, 1);
  if (!tripRaw) continue;
  const trip = decodeFields(tripRaw.data, 0, tripRaw.data.length);
  const routeId = str(one(trip, 5));
  const dirId = int(one(trip, 6));
  const startTime = str(one(trip, 2));
  for (const stuRaw of all(tu, 2)) {
    const stu = decodeFields(stuRaw.data, 0, stuRaw.data.length);
    const stopId = str(one(stu, 4));
    const arrRaw = one(stu, 2);
    let epoch = null;
    if (arrRaw) { const arr = decodeFields(arrRaw.data, 0, arrRaw.data.length); epoch = int(one(arr, 2)); }
    rows.push({ routeId, dirId, startTime, stopId, epoch });
  }
}
console.log('Route 555 trovate:', rows.length);
for (const r of rows) {
  const t = r.epoch ? new Date(r.epoch * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '?';
  const min = r.epoch ? Math.round((r.epoch - now) / 60) : '?';
  console.log(`  route ${r.routeId} dir ${r.dirId} | partenza ${r.startTime} | stop ${r.stopId} | arrivo ${t} (${min} min da adesso)`);
}
