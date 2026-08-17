/* ============================================================
   Facturier — serveur (Node natif, zéro dépendance)
   ------------------------------------------------------------
   - Sert les fichiers statiques (index.html, style.css, js/)
   - API de synchronisation de l'état (settings/clients/invoices)
     stocké dans un fichier JSON du volume Docker (/data/state.json)
   - Auth : email + mot de passe (hash SHA-256 en variable d'env),
     session par cookie signé HMAC, tentatives limitées par IP.
   ------------------------------------------------------------
   Variables d'environnement :
     PORT                  (déf. 3000)
     DATA_FILE             (déf. /data/state.json)
     AUTH_EMAIL            email de connexion (ex. user@example.com)
     AUTH_PASSWORD_SHA256  SHA-256 hex du mot de passe
     SESSION_SECRET        secret HMAC long et aléatoire
     COOKIE_SECURE         1 = cookie Secure (HTTPS), 0 sinon
     SESSION_TTL_DAYS      durée de session (déf. 30)
   ============================================================ */
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_FILE = process.env.DATA_FILE || '/data/state.json';
const AUTH_EMAIL = (process.env.AUTH_EMAIL || '').trim().toLowerCase();
const AUTH_PASSWORD_SHA256 = (process.env.AUTH_PASSWORD_SHA256 || '').trim().toLowerCase();
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '30', 10);
const MAX_BODY_BYTES = 15 * 1024 * 1024; // 15 Mo

if (!AUTH_EMAIL || !AUTH_PASSWORD_SHA256 || !SESSION_SECRET) {
  console.error('[facturier] Variables AUTH_EMAIL, AUTH_PASSWORD_SHA256 et SESSION_SECRET requises.');
  process.exit(1);
}

// ---------- helpers ----------

function sha256hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Compare quand même pour limiter les fuites temporelles
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

function makeSessionValue() {
  const exp = Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000;
  const payload = `${AUTH_EMAIL}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function isValidSession(cookieHeader) {
  if (!cookieHeader) return false;
  const m = /(?:^|;\s*)facturier_session=([^;]+)/.exec(cookieHeader);
  if (!m) return false;
  let value;
  try {
    value = decodeURIComponent(m[1]);
  } catch (e) {
    return false;
  }
  // Format : <email>.<expMs>.<hmac> — l'email pouvant contenir des points,
  // on parses depuis la droite (sig = dernier champ, exp = avant-dernier).
  const lastDot = value.lastIndexOf('.');
  const secondLastDot = value.lastIndexOf('.', lastDot - 1);
  if (lastDot < 0 || secondLastDot < 0) return false;
  const email = value.slice(0, secondLastDot);
  const exp = value.slice(secondLastDot + 1, lastDot);
  const sig = value.slice(lastDot + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (!safeEqual(sign(`${email}.${exp}`), sig)) return false;
  return parseInt(exp, 10) > Date.now();
}

// ---------- rate-limit login (mémoire, 10 essais / 15 min / IP) ----------

const loginAttempts = new Map(); // ip -> { count, resetAt }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

function loginAllowed(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  rec.count += 1;
  return rec.count <= LOGIN_MAX;
}

// ---------- état ----------

function readStateFile() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[facturier] Lecture état:', e.message);
    return null;
  }
}

function writeStateFile(obj) {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${DATA_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj), { utf8: true });
  fs.renameSync(tmp, DATA_FILE); // atomique sur le même système de fichiers
}

function stateLooksValid(obj) {
  return (
    obj && typeof obj === 'object' && !Array.isArray(obj) &&
    obj.settings && typeof obj.settings === 'object' &&
    Array.isArray(obj.clients) && Array.isArray(obj.invoices)
  );
}

// ---------- statiques ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const STATIC_ROOT = __dirname + '/public';

// HTML jamais caché (toujours frais après login/redirect), assets cacheables
function isCacheable(rel) {
  const ext = path.extname(rel).toLowerCase();
  return !!ext && ext !== '.html';
}

function serveStatic(req, res, pathname) {
  let rel = pathname.replace(/^\/+/, '') || 'index.html';
  const target = path.normalize(path.join(STATIC_ROOT, rel));
  if (!target.startsWith(STATIC_ROOT + path.sep) && target !== STATIC_ROOT) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      // App monopage : toute route inconnue retombe sur index.html
      if (!path.extname(rel)) {
        sendFile(res, path.join(STATIC_ROOT, 'index.html'), 200, false);
      } else {
        res.writeHead(404).end('Not found');
      }
      return;
    }
    sendFile(res, target, 200, isCacheable(rel));
  });
}

function sendFile(res, filePath, code, cacheable) {
  const ext = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);
  stream.on('open', () => {
    res.writeHead(code, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheable ? 'public, max-age=604800' : 'no-cache',
    });
    stream.pipe(res);
  });
  stream.on('error', () => res.writeHead(404).end('Not found'));
}

// ---------- body JSON ----------

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Payload trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        if (!chunks.length) return resolve(null);
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, extraHeaders || {}));
  res.end(body);
}

// ---------- serveur ----------

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  try {
    // --- healthcheck (public) ---
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, server: true });
    }

    // --- login (public, limité) ---
    if (pathname === '/api/login' && req.method === 'POST') {
      if (!loginAllowed(clientIp(req))) {
        return sendJson(res, 429, { error: 'Trop de tentatives, réessayez dans 15 minutes' });
      }
      const body = await readJsonBody(req);
      const email = String((body && body.email) || '').trim().toLowerCase();
      const password = String((body && body.password) || '');
      if (safeEqual(sha256hex(email), sha256hex(AUTH_EMAIL)) &&
          safeEqual(sha256hex(password), AUTH_PASSWORD_SHA256)) {
        loginAttempts.delete(clientIp(req));
        const cookie = [
          `facturier_session=${encodeURIComponent(makeSessionValue())}`,
          'Path=/', 'HttpOnly', 'SameSite=Lax',
          `Max-Age=${SESSION_TTL_DAYS * 24 * 3600}`,
        ];
        if (COOKIE_SECURE) cookie.push('Secure');
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie.join('; ') });
      }
      return sendJson(res, 401, { error: 'Identifiants incorrects' });
    }

    // --- logout ---
    if (pathname === '/api/logout' && req.method === 'POST') {
      const cookie = 'facturier_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    }

    // --- tout le reste de l'API nécessite une session valide ---
    if (pathname.startsWith('/api/')) {
      if (!isValidSession(req.headers.cookie)) {
        return sendJson(res, 401, { error: 'Non authentifié' });
      }
      if (pathname === '/api/state' && req.method === 'GET') {
        const st = readStateFile();
        return sendJson(res, 200, { state: stateLooksValid(st) ? st : null });
      }
      if (pathname === '/api/state' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (!stateLooksValid(body)) {
          return sendJson(res, 400, { error: 'Structure de données invalide' });
        }
        writeStateFile(body);
        return sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
      }
      return sendJson(res, 404, { error: 'Route inconnue' });
    }

    // --- statiques ---
    if (req.method === 'GET' || req.method === 'HEAD') {
      // Redirection login : non-connecté → /login.html pour toute page app.
      // Les assets (css/js) et la page login restent publics ; l'API est
      // déjà protégée plus haut. Un visiteur non connecté ne reçoit jamais
      // l'app, juste la page de connexion.
      const authed = isValidSession(req.headers.cookie);
      const ext = path.extname(pathname);
      const isLoginPage = pathname === '/login.html';
      const isAsset = !!ext && pathname !== '/index.html';
      if (!authed && !isLoginPage && !isAsset) {
        res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' });
        return res.end();
      }
      return serveStatic(req, res, pathname);
    }
    return sendJson(res, 405, { error: 'Méthode non autorisée' });
  } catch (e) {
    console.error('[facturier]', req.method, pathname, e.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'Erreur serveur' });
  }
});

server.listen(PORT, () => {
  console.log(`[facturier] écoute sur :${PORT} — données: ${DATA_FILE}`);
});
