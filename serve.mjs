// ============================================================
// Minimaler statischer Webserver fuer FRAGSTORM.
// Laeuft auf Windows, Linux und macOS mit Node.js >= 16.
//
//   node serve.mjs              -> http://localhost:8080 (Browser oeffnet sich)
//   PORT=3000 node serve.mjs    -> anderer Port
//   node serve.mjs --no-open    -> Browser nicht automatisch oeffnen
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROOT_PREFIX = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
const ARGS = process.argv.slice(2);
const NO_OPEN = ARGS.includes('--no-open') || process.env.NO_OPEN === '1';
const HOST = process.env.HOST || '127.0.0.1';
let port = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    send(res, 400, 'Bad Request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  // Pfad absichern: keine Verzeichniswechsel ausserhalb des Projektordners
  const rel = path.normalize(urlPath).replace(/^[/\\]+/, '');
  const filePath = path.join(ROOT, rel);
  if (filePath !== ROOT && !filePath.startsWith(ROOT_PREFIX)) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      send(res, 404, '404 - nicht gefunden: ' + urlPath);
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { try { res.destroy(); } catch (e) {} });
    stream.pipe(res);
  });
});

function openBrowser(url) {
  if (NO_OPEN) return;
  const plat = process.platform;
  let cmd, args, opts = { stdio: 'ignore', detached: true };
  if (plat === 'win32') {
    // "start" ist ein Shell-Builtin; leerer Titel-Parameter noetig
    cmd = 'cmd'; args = ['/c', 'start', '""', url];
  } else if (plat === 'darwin') {
    cmd = 'open'; args = [url];
  } else {
    cmd = 'xdg-open'; args = [url];
  }
  try {
    const child = spawn(cmd, args, opts);
    child.on('error', () => {});
    child.unref();
  } catch (e) { /* kein Browser verfuegbar (z.B. Server ohne Desktop) */ }
}

function listen() {
  server.listen(port, HOST, () => {
    const url = 'http://localhost:' + port;
    const lan = Object.values(os.networkInterfaces()).flat()
      .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log('');
    console.log('  FRAGSTORM laeuft auf:  ' + url);
    if (HOST !== '127.0.0.1' && lan.length) console.log('  Im LAN erreichbar:     http://' + lan[0] + ':' + port);
    console.log('  Beenden mit Strg+C');
    console.log('');
    openBrowser(url);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < 8100) {
    console.log('  Port ' + port + ' ist belegt, versuche ' + (port + 1) + ' ...');
    port++;
    setTimeout(listen, 50);
  } else {
    console.error('  Server-Fehler: ' + err.message);
    process.exit(1);
  }
});

listen();
