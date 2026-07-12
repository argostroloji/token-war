// TOKEN WAR dev server — static files + rate-limited caching /gt proxy to GeckoTerminal (zero deps)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5178;
const ROOT = __dirname;
const GT_HOST = 'api.geckoterminal.com';
const MIN_GAP_MS = 2600;              // min spacing between upstream calls (free tier is bursty-throttled)
const TTL_POOLS = 45000, TTL_TRADES = 8000;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const cache = new Map();   // key -> { t, status, body }
const inflight = new Map(); // key -> Promise
let chain = Promise.resolve();
let lastUpstream = 0;

function upstream(upath) {
  return new Promise(resolve => {
    const preq = https.request({ host: GT_HOST, path: upath, method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'token-war-dev' } }, pres => {
      let body = '';
      pres.on('data', d => body += d);
      pres.on('end', () => resolve({ status: pres.statusCode, body }));
    });
    preq.on('error', e => resolve({ status: 502, body: JSON.stringify({ error: e.message }) }));
    preq.setTimeout(15000, () => { preq.destroy(); resolve({ status: 504, body: '{"error":"timeout"}' }); });
    preq.end();
  });
}

function getGt(upath) {
  const key = upath;
  const ttl = upath.includes('/trades') ? TTL_TRADES : TTL_POOLS;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return Promise.resolve({ ...hit, from: 'cache' });
  if (inflight.has(key)) return inflight.get(key);
  const p = new Promise(resolve => {
    chain = chain.then(async () => {
      // someone may have filled the cache while we queued
      const h2 = cache.get(key);
      if (h2 && Date.now() - h2.t < ttl) { resolve({ ...h2, from: 'cache' }); return; }
      const wait = Math.max(0, lastUpstream + MIN_GAP_MS - Date.now());
      if (wait) await new Promise(r => setTimeout(r, wait));
      lastUpstream = Date.now();
      let r = await upstream(upath);
      // free tier throws intermittent 429s; roster pages are critical, so retry them harder
      const tries = upath.includes('/pools?') ? 3 : 1;
      for (let a = 0; a < tries && r.status === 429; a++) {
        await new Promise(x => setTimeout(x, 3500 + a * 1500));
        lastUpstream = Date.now();
        r = await upstream(upath);
      }
      if (r.status === 200) { cache.set(key, { t: Date.now(), status: 200, body: r.body }); resolve({ ...r, from: 'live' }); }
      else if (hit) resolve({ ...hit, from: 'stale' });        // throttled -> serve stale
      else resolve({ ...r, from: 'live' });
      if (cache.size > 300) { const k = cache.keys().next().value; cache.delete(k); }
    });
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/snap') { // dev aid: page posts its canvas as a PNG data URL
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const b64 = body.replace(/^data:image\/png;base64,/, '');
      fs.writeFile(path.join(ROOT, 'snapshot.png'), Buffer.from(b64, 'base64'), () => {});
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  if (u.pathname.startsWith('/gt/')) {
    const upath = '/api/v2/' + u.pathname.slice(4) + (u.search || '');
    const r = await getGt(upath);
    console.log(`[gt] ${r.status} ${r.from} ${upath.slice(0, 110)}`);
    res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-gt-source': r.from });
    res.end(r.body);
    return;
  }
  let p = path.normalize(path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('TOKEN WAR dev server on http://localhost:' + PORT));
