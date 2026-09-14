// Decodificatore protobuf generico (senza librerie) per esplorare il feed GTFS-RT
// Uso: node decode-gtfs.mjs tmp-gtfs/rome_rtgtfs_trip_updates_feed.pb

import fs from 'node:fs';

const file = process.argv[2];
const buf = fs.readFileSync(file);
console.error('File:', file, '-', buf.length, 'bytes');

// Legge una varint
function readVarint(buf, pos) {
  let result = 0n, shift = 0n, start = pos;
  while (true) {
    if (pos >= buf.length) throw new Error('varint overflow');
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, next: pos };
}

// Decodifica ricorsivamente i campi di un messaggio
function decodeFields(buf, start, end, depth = 0) {
  const fields = [];
  let pos = start;
  while (pos < end) {
    const tag = readVarint(buf, pos);
    pos = tag.next;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (fieldNumber === 0) break; // corrotto, esco
    if (wireType === 0) { // varint
      const v = readVarint(buf, pos);
      pos = v.next;
      fields.push({ field: fieldNumber, type: 'varint', value: v.value });
    } else if (wireType === 2) { // length-delimited
      const len = readVarint(buf, pos);
      pos = len.next;
      const l = Number(len.value);
      if (pos + l > end) break;
      const data = buf.subarray(pos, pos + l);
      pos += l;
      // Prova a interpretare come stringa UTF-8
      let str = null;
      try {
        str = data.toString('utf8');
        if (/[\u0000-\u0008\u000e-\u001f]/.test(str)) str = null; // contiene byte di controllo → non testo
      } catch {}
      // Prova a interpretare come messaggio annidato
      let nested = null;
      try {
        nested = decodeFields(buf, pos - l, pos, depth + 1);
        if (nested.length === 0) nested = null;
      } catch {}
      fields.push({ field: fieldNumber, type: 'bytes', str, nested });
    } else if (wireType === 5) { // 32-bit
      pos += 4;
    } else if (wireType === 1) { // 64-bit
      pos += 8;
    } else {
      break; // wire type sconosciuto
    }
    if (depth > 12) break; // limite profondità
  }
  return fields;
}

// Rappresentazione leggibile
function dump(fields, indent = '') {
  for (const f of fields) {
    if (f.str !== null && f.str !== undefined) {
      console.log(indent + `f${f.field} str: ${JSON.stringify(f.str)}`);
    } else if (f.nested) {
      console.log(indent + `f${f.field} msg:`);
      dump(f.nested, indent + '  ');
    } else if (f.type === 'varint') {
      console.log(indent + `f${f.field} varint: ${f.value}`);
    }
  }
}

const fields = decodeFields(buf, 0, buf.length);
console.error('Campi top-level:', fields.length);

// Modalità search: cerca una stringa nei campi str
const search = process.argv[3];
if (search) {
  let count = 0;
  function find(fields, path = '') {
    for (const f of fields) {
      const p = path + `/f${f.field}`;
      if (f.str && f.str.includes(search)) {
        count++;
        if (count <= 20) console.log(p, '->', JSON.stringify(f.str));
      }
      if (f.nested) find(f.nested, p);
    }
  }
  find(fields);
  console.log(`\nTotale occorrenze di "${search}": ${count}`);
} else {
  // Dump dei primi 3 entity (GTFS-RT: header=f1, entity=f2 ripetuto)
  const entities = fields.filter(f => f.field === 2); // FeedEntity
  console.error('FeedEntity:', entities.length);
  dump(entities.slice(0, 3));
}
