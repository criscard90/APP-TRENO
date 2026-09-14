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

// --- Proxy romamobile.it (palina bus Ponte Di Nona 82110) ---

const BUS_URL = 'https://romamobile.it/paline/palina/82110?nav=3';

function handleBusProxy(res) {
  // romamobile.it a volte risponde 500 in modo intermittente: riprova fino a 4 volte
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const MAX_TRIES = 4;
  let attempt = 0;

  function tryFetch() {
    attempt++;
    fetch(BUS_URL, { method: 'GET', headers: UA })
      .then(async (upstream) => {
        const text = await upstream.text();
        if (upstream.status >= 500 && attempt < MAX_TRIES) {
          setTimeout(tryFetch, 800);
          return;
        }
        res.writeHead(upstream.status, {
          ...CORS,
          'Content-Type': 'text/html; charset=utf-8'
        });
        res.end(text);
      })
      .catch((err) => {
        if (attempt < MAX_TRIES) {
          setTimeout(tryFetch, 800);
          return;
        }
        console.error('Errore proxy romamobile:', err.message);
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

  // Palina bus 555 (romamobile.it) → proxy
  if (pathname === '/bus555') {
    return handleBusProxy(res);
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
