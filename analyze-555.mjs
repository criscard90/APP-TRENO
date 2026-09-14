// Estrae i trip della linea 555 con arrivo alla palina Ponte Di Nona (stop 82110)
// dal feed GTFS-RT trip updates di romamobilita.it
// Uso: node analyze-555.mjs

import fs from 'node:fs';

const buf = fs.readFileSync(new URL('./tmp-gtfs/rome_rtgtfs_trip_updates_feed.pb', import.meta.url));

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
    if (wireType === 0) {
      const v = readVarint(b, pos);
      pos = v.next;
      fields.push({ field: fieldNumber, varint: v.value });
    } else if (wireType === 2) {
      const len = readVarint(b, pos);
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

const all = (fs, n) => fs.filter(f => f.field === n);
const one = (fs, n) => fs.find(f => f.field === n);
const str = f => (f && f.data ? f.data.toString('utf8') : null);
const int = f => (f && f.varint !== undefined ? Number(f.varint) : null);

const top = decodeFields(buf, 0, buf.length);
const entities = all(top, 2);
console.error('Entity totali:', entities.length);

const now = Date.now() / 1000;
const rows = [];

for (const ent of entities) {
  const entFields = ent.data ? decodeFields(ent.data, 0, ent.data.length) : [];
  const tripUpdateRaw = one(entFields, 3); // FeedEntity.f3 = TripUpdate
  if (!tripUpdateRaw) continue;
  const tu = decodeFields(tripUpdateRaw.data, 0, tripUpdateRaw.data.length);

  const tripRaw = one(tu, 1); // TripUpdate.f1 = TripDescriptor
  if (!tripRaw) continue;
  const trip = decodeFields(tripRaw.data, 0, tripRaw.data.length);
  const routeId = str(one(trip, 5));
  const directionId = int(one(trip, 6));
  const tripId = str(one(trip, 1));
  const startTime = str(one(trip, 2));

  if (routeId !== '555') continue;

  for (const stuRaw of all(tu, 2)) { // TripUpdate.f2 = StopTimeUpdate
    const stu = decodeFields(stuRaw.data, 0, stuRaw.data.length);
    const stopId = str(one(stu, 4));
    if (stopId !== '82110') continue; // palina Ponte Di Nona (FL2)

    const arrRaw = one(stu, 2); // arrival
    let arrivalEpoch = null;
    if (arrRaw) {
      const arr = decodeFields(arrRaw.data, 0, arrRaw.data.length);
      arrivalEpoch = int(one(arr, 2)); // time (epoch sec)
    }
    if (!arrivalEpoch) continue;

    const deltaMin = Math.round((arrivalEpoch - now) / 60);
    if (deltaMin < -1) continue; // già passato
    rows.push({ tripId, startTime, directionId, arrivalEpoch, deltaMin });
  }
}

rows.sort((a, b) => a.arrivalEpoch - b.arrivalEpoch);

console.log('\n=== BUS 555 IN ARRIVO A PONTE DI NONA (stop 82110) ===');
if (rows.length === 0) console.log('Nessun bus 555 in arrivo (o non ancora nel feed)');
for (const r of rows) {
  const t = new Date(r.arrivalEpoch * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  console.log(`partenza ${r.startTime} | dir ${r.directionId} | arrivo palina ${t} | tra ${r.deltaMin} min`);
}
console.log(`\nTotale: ${rows.length}`);
