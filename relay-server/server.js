#!/usr/bin/env node
// Tiny realtime relay for sitin-pwa-automation — a path-addressed JSON tree store
// with SSE subscribe and wide-open CORS. It's the `relay` backend's server side:
// self-host it on any box you control (a domestic VPS for China), point the
// injection at it, and you get Firebase-RTDB semantics with none of the GFW /
// origin-whitelist problems. Zero dependencies (Node built-ins only).
//
//   GET    /data/<path>   -> value at <path> (404 if missing)
//   PUT    /data/<path>   -> set value (JSON body)
//   PATCH  /data/<path>   -> shallow-merge object into value
//   DELETE /data/<path>   -> remove
//   GET    /watch/<path>  -> SSE; a message on every change at/under/over <path>
//   GET    /health        -> "ok"
//
// Env: PORT (default 8787), RELAY_DATA_FILE (optional JSON persistence path),
//      RELAY_TOKEN (optional; if set, require ?token=... on every request).

const http = require('http');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '8787', 10);
const DATA_FILE = process.env.RELAY_DATA_FILE || '';
const TOKEN = process.env.RELAY_TOKEN || '';

let tree = {};
if (DATA_FILE) {
  try { tree = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
}
let saveTimer = null;
function persist() {
  if (!DATA_FILE) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(tree)); } catch {}
  }, 500);
}

const segs = (p) => p.split('/').map(decodeURIComponent).filter(Boolean);

function getAt(path) {
  let node = tree;
  for (const s of segs(path)) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[s];
  }
  return node;
}
function setAt(path, value) {
  const parts = segs(path);
  if (!parts.length) { tree = value == null ? {} : value; return; }
  let node = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (node[k] == null || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  node[parts[parts.length - 1]] = value;
}
function deleteAt(path) {
  const parts = segs(path);
  if (!parts.length) { tree = {}; return; }
  let node = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (node[k] == null || typeof node[k] !== 'object') return;
    node = node[k];
  }
  delete node[parts[parts.length - 1]];
}

// Firebase-style: a watcher on W fires when data at, under, or above W changes —
// i.e. whenever the changed path and W are in a prefix relationship.
const watchers = new Set(); // { parts, res }
function related(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
function notify(path) {
  const cp = segs(path);
  for (const w of watchers) {
    if (related(w.parts, cp)) {
      try { w.res.write('data: 1\n\n'); } catch {}
    }
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, body) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : null); } catch { resolve(undefined); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (TOKEN && u.searchParams.get('token') !== TOKEN) return json(res, 401, { error: 'unauthorized' });
  if (path === '/health') { cors(res); res.writeHead(200); return res.end('ok'); }

  if (path.startsWith('/data/') || path === '/data') {
    const key = path.slice('/data'.length);
    if (req.method === 'GET') {
      const v = getAt(key);
      if (v === undefined) return json(res, 404, null);
      return json(res, 200, v);
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (body === undefined) return json(res, 400, { error: 'bad json' });
      setAt(key, body); persist(); notify(key);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (body === undefined || typeof body !== 'object' || body === null) return json(res, 400, { error: 'bad json' });
      const cur = getAt(key);
      const merged = (cur && typeof cur === 'object') ? { ...cur, ...body } : body;
      setAt(key, merged); persist(); notify(key);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      deleteAt(key); persist(); notify(key);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'method' });
  }

  if (path.startsWith('/watch/') || path === '/watch') {
    if (req.method !== 'GET') return json(res, 405, { error: 'method' });
    cors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    const w = { parts: segs(path.slice('/watch'.length)), res };
    watchers.add(w);
    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(ka); watchers.delete(w); });
    return;
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`relay listening on :${PORT}`));
