// Server unico: serve l'app (file statici) E fa da proxy per viaggiatreno.it
// Stessa origine = niente CORS, niente GitHub Pages necessario.
//
//  - Desktop:  http://localhost:8787
//  - Mobile:   esponi con tunnel HTTPS (cloudflared) oppure build APK Capacitor
//
// Nessuna dipendenza, richiede Node 18+ (fetch integrato)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8787;
const UPSTREAM = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning',
  'Access-Control-Max-Age': '86400'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// --- File statici (l'app) ---

function serveStatic(pathname, res) {
  let rel = '/';
  try { rel = decodeURIComponent(pathname); } catch {}
  if (rel === '/' || rel === '') rel = '/index.html';

  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

// --- Proxy viaggiatreno ---

function handleProxy(req, res) {
  // Inoltra tutto il path (es. /partenze/S08217/<data>) a viaggiatreno
  const targetUrl = UPSTREAM + req.url;

  fetch(targetUrl, { method: 'GET' })
    .then(async (upstream) => {
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        ...CORS,
        'Content-Type': 'application/json'
      });
      res.end(text);
    })
    .catch((err) => {
      console.error('Errore proxy viaggiatreno:', err.message);
      res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
}

// --- Proxy GTFS-RT romamobilita.it (bus 555, dati ufficiali real-time) ---
// Scarica il feed .pb (~880KB), lo filtra tenendo solo le entità della linea 555
// e restituisce un protobuf ridotto (~1KB) con la stessa struttura.

const BUS_RT_URL = 'https://romamobilita.it/sites/default/files/rome_rtgtfs_trip_updates_feed.pb';

function readVarintBuf(b, pos) {
  let result = 0n, shift = 0n;
  while (true) {
    const byte = b[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, next: pos };
}

function decodeFieldsBuf(b, start, end) {
  const fields = [];
  let pos = start;
  while (pos < end) {
    const tag = readVarintBuf(b, pos);
    pos = tag.next;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (fieldNumber === 0) break;
    if (wireType === 0) {
      const v = readVarintBuf(b, pos);
      pos = v.next;
      fields.push({ field: fieldNumber, varint: v.value });
    } else if (wireType === 2) {
      const len = readVarintBuf(b, pos);
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

function writeVarint(n) {
  const bytes = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    bytes.push(b);
  } while (v);
  return Buffer.from(bytes);
}

function lengthDelimited(field, data) {
  return Buffer.concat([writeVarint((field << 3) | 2), writeVarint(data.length), data]);
}

function filterRoute555(pb) {
  const top = decodeFieldsBuf(pb, 0, pb.length);
  const header = top.find(f => f.field === 1);
  const out = [];
  if (header) out.push(lengthDelimited(1, header.data));
  for (const ent of top.filter(f => f.field === 2)) {
    const ef = decodeFieldsBuf(ent.data, 0, ent.data.length);
    const tuRaw = ef.find(f => f.field === 3);
    if (!tuRaw) continue;
    const tu = decodeFieldsBuf(tuRaw.data, 0, tuRaw.data.length);
    const tripRaw = tu.find(f => f.field === 1);
    if (!tripRaw) continue;
    const trip = decodeFieldsBuf(tripRaw.data, 0, tripRaw.data.length);
    const routeId = trip.find(f => f.field === 5);
    if (routeId && routeId.data && routeId.data.toString('utf8') === '555') {
      out.push(lengthDelimited(2, ent.data));
    }
  }
  return Buffer.concat(out);
}

function handleBusRtProxy(res) {
  // romamobilita.it a volte risponde 5xx in modo intermittente: riprova fino a 4 volte
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const MAX_TRIES = 4;
  let attempt = 0;

  function tryFetch() {
    attempt++;
    fetch(BUS_RT_URL, { method: 'GET', headers: UA })
      .then(async (upstream) => {
        if (upstream.status >= 500 && attempt < MAX_TRIES) {
          upstream.body?.cancel();
          setTimeout(tryFetch, 800);
          return;
        }
        if (upstream.status !== 200) {
          res.writeHead(upstream.status, { ...CORS, 'Content-Type': 'text/plain' });
          return res.end('Errore feed bus: HTTP ' + upstream.status);
        }
        const ab = await upstream.arrayBuffer();
        const filtered = filterRoute555(Buffer.from(ab));
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/octet-stream' });
        res.end(filtered);
      })
      .catch((err) => {
        if (attempt < MAX_TRIES) {
          setTimeout(tryFetch, 800);
          return;
        }
        console.error('Errore proxy GTFS-RT:', err.message);
        res.writeHead(502, { ...CORS, 'Content-Type': 'text/plain' });
        res.end('Errore proxy bus: ' + err.message);
      });
  }

  tryFetch();
}

// --- Server ---

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // Richieste API → proxy viaggiatreno
  if (pathname.startsWith('/api/')) {
    // /api/partenze/S08217/<data> → upstream
    req.url = pathname.slice(4); // rimuovi /api
    return handleProxy(req, res);
  }

  // Feed GTFS-RT bus 555 (romamobilita.it, dati ufficiali) → proxy filtrato
  if (pathname === '/bus555rt') {
    return handleBusRtProxy(res);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(pathname, res);
  }

  res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Metodo non supportato' }));
});

server.listen(PORT, () => {
  console.log('Treno App attiva su http://localhost:' + PORT);
  console.log('API viaggiatreno proxy su /api/*');
  console.log('Per il mobile avvia il tunnel:');
  console.log('  cloudflared tunnel --url http://localhost:' + PORT);
  console.log('Ctrl+C per fermare');
});
