// Server unico: serve l'app (file statici) E fa da proxy per lefrecce.it
// Stessa origine = niente CORS, niente GitHub Pages necessario.
//
//  - Desktop:  http://localhost:8787
//  - Mobile:   esponi con tunnel HTTPS (vedi README.md)
//              cloudflared tunnel --url http://localhost:8787
//
// Nessuna dipendenza, richiede Node 18+ (fetch integrato)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8787;
const TARGET = 'https://www.lefrecce.it/Channels.Website.BFF.WEB/website/ticket/solutions';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// --- Proxy lefrecce.it ---

function handleProxy(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      const upstream = await fetch(TARGET, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body
      });

      const text = await upstream.text();
      console.log(new Date().toLocaleTimeString('it-IT'), 'API ->', upstream.status);
      res.writeHead(upstream.status, { ...CORS, 'Content-Type': 'application/json' });
      res.end(text);
    } catch (err) {
      console.error('Errore upstream:', err.message);
      res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// --- Server ---

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (req.method === 'POST') {
    return handleProxy(req, res);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(pathname, res);
  }

  res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Metodo non supportato' }));
});

server.listen(PORT, () => {
  console.log('Treno App attiva su http://localhost:' + PORT);
  console.log('Per il mobile avvia il tunnel (vedi README.md):');
  console.log('  cloudflared tunnel --url http://localhost:' + PORT);
  console.log('Ctrl+C per fermare');
});
