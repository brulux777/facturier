/* ============================================================
   Facturier — serveur (Node + PostgreSQL)
   ------------------------------------------------------------
   - Sert les fichiers statiques (index.html, login.html, js/)
   - API de synchronisation de l'état (settings/clients/invoices)
     stocké dans PostgreSQL (conteneur `db` du docker-compose)
   - Auth : email + mot de passe (hash SHA-256 en variable d'env),
     session par cookie signé HMAC, tentatives limitées par IP.
   - Pages app protégées : 302 vers /login.html?next=... si non
     connecté (l'app n'est pas servie avant authentification).
   ------------------------------------------------------------
   Variables d'environnement :
     PORT                  (déf. 3000)
     DATA_FILE             (déf. /data/state.json — migration initiale)
     AUTH_EMAIL            email de connexion
     AUTH_PASSWORD_SHA256  SHA-256 hex du mot de passe
     SESSION_SECRET        secret HMAC long et aléatoire
     COOKIE_SECURE         1 = cookie Secure (HTTPS)
     SESSION_TTL_DAYS      durée de session (déf. 30)
     PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD  (PostgreSQL)
   ============================================================ */
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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
  // on parse depuis la droite (sig = dernier champ, exp = avant-dernier).
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

// ---------- PostgreSQL ----------

const pool = new Pool({
  host: process.env.PGHOST || 'db',
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'facturier',
  user: process.env.PGUSER || 'facturier',
  password: process.env.PGPASSWORD || '',
  max: 5,
});

async function initDb() {
  // Attente du conteneur db (retry ~60 s)
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (e) {
      if (attempt === 30) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS clients (
      id   TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id   TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
  `);

  await migrateFromJsonFile();
}

/**
 * Migration unique : si la base est vide et qu'un state.json existe
 * (ancienne version du projet), on importe ses données dans Postgres.
 */
async function migrateFromJsonFile() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM settings');
  if (rows[0].n > 0) return;
  let old = null;
  try {
    old = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return; // pas de fichier ancien : base vierge, rien à migrer
  }
  if (!stateLooksValid(old)) return;
  await writeStateToDb(old);
  console.log('[facturier] Migration state.json → PostgreSQL effectuée');
}

function stateLooksValid(obj) {
  return (
    obj && typeof obj === 'object' && !Array.isArray(obj) &&
    obj.settings && typeof obj.settings === 'object' &&
    Array.isArray(obj.clients) && Array.isArray(obj.invoices)
  );
}

async function readStateFromDb() {
  const res = {};
  const s = await pool.query('SELECT data FROM settings WHERE id = 1');
  if (s.rowCount === 0) return null;
  res.settings = (s.rows[0].data && s.rows[0].data.settings) || {};
  res.counters = (s.rows[0].data && s.rows[0].data.counters) || { invoice: 0, quote: 0 };

  const c = await pool.query('SELECT data FROM clients ORDER BY data->>\'name\'');
  res.clients = c.rows.map((r) => r.data);

  const i = await pool.query('SELECT data FROM invoices ORDER BY data->>\'date\' DESC');
  res.invoices = i.rows.map((r) => r.data);
  return res;
}

async function writeStateToDb(st) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO settings (id, data, updated_at) VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = $1::jsonb, updated_at = now()`,
      [JSON.stringify({ settings: st.settings || {}, counters: st.counters || { invoice: 0, quote: 0 } })]
    );
    await client.query('DELETE FROM clients');
    for (let k = 0; k < (st.clients || []).length; k++) {
      const cl = st.clients[k];
      const id = String(cl.id || 'client-' + k);
      await client.query(
        'INSERT INTO clients (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = $2::jsonb',
        [id, JSON.stringify(cl)]
      );
    }
    await client.query('DELETE FROM invoices');
    for (let k = 0; k < (st.invoices || []).length; k++) {
      const inv = st.invoices[k];
      const id = String(inv.id || 'invoice-' + k);
      await client.query(
        'INSERT INTO invoices (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = $2::jsonb',
        [id, JSON.stringify(inv)]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
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
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  try {
    // --- healthcheck (public, dépend de la base) ---
    if (pathname === '/api/health' && req.method === 'GET') {
      try {
        await pool.query('SELECT 1');
        return sendJson(res, 200, { ok: true, server: true, db: true });
      } catch (e) {
        return sendJson(res, 503, { ok: false, server: true, db: false });
      }
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
        return sendJson(res, 200, { ok: true }, {
          'Set-Cookie': cookie.join('; '),
          // Purge le cache navigateur de l'origine (ex : vieilles versions
          // de l'app cachées par une version précédente du serveur)
          'Clear-Site-Data': '"cache"',
        });
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
        const st = await readStateFromDb();
        return sendJson(res, 200, { state: stateLooksValid(st) ? st : null });
      }
      if (pathname === '/api/state' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (!stateLooksValid(body)) {
          return sendJson(res, 400, { error: 'Structure de données invalide' });
        }
        // Garde anti-écrasement : le formulaire exige un nom d'entreprise.
        // Un PUT sans nom alors que la base en a un = client désynchronisé
        // (ex : vieux JS en cache) → refus, pas de perte de données.
        const incomingName = (body.settings.companyName || '').trim();
        if (!incomingName) {
          const cur = await pool.query('SELECT data->\'settings\'->>\'companyName\' AS name FROM settings WHERE id = 1');
          const storedName = cur.rowCount ? (cur.rows[0].name || '').trim() : '';
          if (storedName) {
            return sendJson(res, 409, { error: 'Refus : écrasement de données (client désynchronisé, rechargez la page)' });
          }
        }
        await writeStateToDb(body);
        return sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
      }
      return sendJson(res, 404, { error: 'Route inconnue' });
    }

    // --- statiques ---
    if (req.method === 'GET' || req.method === 'HEAD') {
      // Pages app protégées : non-connecté → /login.html (avec retour).
      // Les assets (css/js) et la page login restent publics ; l'API est
      // déjà protégée plus haut. Un visiteur non connecté ne reçoit jamais
      // l'app, juste la page de connexion.
      const authed = isValidSession(req.headers.cookie);
      const ext = path.extname(pathname);
      const isLoginPage = pathname === '/login.html';
      const isAsset = !!ext && pathname !== '/index.html';
      if (!authed && !isLoginPage && !isAsset) {
        const next = encodeURIComponent(pathname === '/' ? '/' : pathname);
        res.writeHead(302, { Location: `/login.html?next=${next}`, 'Cache-Control': 'no-store' });
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

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[facturier] écoute sur :${PORT} — PostgreSQL ${process.env.PGHOST || 'db'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'facturier'}`);
    });
  })
  .catch((e) => {
    console.error('[facturier] Init PostgreSQL impossible:', e.message);
    process.exit(1);
  });
