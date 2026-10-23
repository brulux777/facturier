/* ============================================================
   Facturier — serveur (Node + PostgreSQL)
   ------------------------------------------------------------
   - Sert les fichiers statiques (index.html, login.html, js/)
   - API de synchronisation de l'état (settings/clients/invoices)
     stocké dans PostgreSQL (conteneur `db` du docker-compose,
     base dédiée au facturier — indépendante des autres apps)
   - Auth multi-comptes : comptes en table `users`, email sur
     domaines autorisés (ALLOWED_EMAIL_DOMAINS), mots de passe
     scrypt (compte unique historique AUTH_* migré au vol),
     session par cookie signé HMAC, tentatives limitées par IP.
     Tous les comptes partagent les mêmes données (pas de
     cloisonnement par utilisateur).
   - Réinitialisation de mot de passe par email (table
     `password_resets`, jeton 1 h à usage unique) via SMTP.
   - Pages app protégées : 302 vers /login.html?next=... si non
     connecté (l'app n'est pas servie avant authentification).
   ------------------------------------------------------------
   Variables d'environnement :
     PORT                       (déf. 3000)
     DATA_FILE                  (déf. /data/state.json — migration initiale)
     SESSION_SECRET             secret HMAC long et aléatoire (requis)
     COOKIE_SECURE              1 = cookie Secure (HTTPS)
     SESSION_TTL_DAYS           durée de session (déf. 30)
     ALLOWED_EMAIL_DOMAINS      domaines de connexion séparés par des
                                virgules (déf. hoplacollect.fr,
                                eldcontrole.fr,controleweb.fr)
     APP_URL                    URL publique (déf. déduite de
                                X-Forwarded-Host/Proto) — liens des mails
     AUTH_EMAIL,                compte unique historique : sert uniquement
     AUTH_PASSWORD_SHA256       de compte initial si `users` est vide
     SMTP_HOST/PORT/USER/PASS   envoi des mails (465 SSL)
     SMTP_FROM                  expéditeur (déf. SMTP_USER)
     PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD  (PostgreSQL)
   ============================================================ */
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_FILE = process.env.DATA_FILE || '/data/state.json';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '30', 10);
const MAX_BODY_BYTES = 15 * 1024 * 1024; // 15 Mo
const RESET_TTL_MS = 60 * 60 * 1000; // jeton de reset valable 1 h

// Compte unique historique (variables d'env) : uniquement pour amorcer
// la table `users` au premier démarrage, jamais vérifié ensuite.
const LEGACY_EMAIL = (process.env.AUTH_EMAIL || '').trim().toLowerCase();
const LEGACY_PASSWORD_SHA256 = (process.env.AUTH_PASSWORD_SHA256 || '').trim().toLowerCase();

const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'hoplacollect.fr,eldcontrole.fr,controleweb.fr')
  .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');

if (!SESSION_SECRET) {
  console.error('[facturier] Variable SESSION_SECRET requise.');
  process.exit(1);
}
if (ALLOWED_EMAIL_DOMAINS.length === 0) {
  console.error('[facturier] ALLOWED_EMAIL_DOMAINS vide.');
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

function makeSessionValue(email) {
  const exp = Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000;
  const payload = `${email}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

// → email de session si le cookie est valide et non expiré, sinon null
function sessionEmail(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const m = /(?:^|;\s*)facturier_session=([^;]+)/.exec(cookieHeader);
  if (!m) return null;
  let value;
  try {
    value = decodeURIComponent(m[1]);
  } catch (e) {
    return null;
  }
  // Format : <email>.<expMs>.<hmac> — l'email pouvant contenir des points,
  // on parse depuis la droite (sig = dernier champ, exp = avant-dernier).
  const lastDot = value.lastIndexOf('.');
  const secondLastDot = value.lastIndexOf('.', lastDot - 1);
  if (lastDot < 0 || secondLastDot < 0) return null;
  const email = value.slice(0, secondLastDot);
  const exp = value.slice(secondLastDot + 1, lastDot);
  const sig = value.slice(lastDot + 1);
  if (!/^\d+$/.test(exp)) return null;
  if (!safeEqual(sign(`${email}.${exp}`), sig)) return null;
  if (parseInt(exp, 10) <= Date.now()) return null;
  return email;
}

function sessionCookieHeader(email) {
  const cookie = [
    `facturier_session=${encodeURIComponent(makeSessionValue(email))}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${SESSION_TTL_DAYS * 24 * 3600}`,
  ];
  if (COOKIE_SECURE) cookie.push('Secure');
  return cookie.join('; ');
}

// ---------- mots de passe (scrypt ; sha256 simple = ancien compte unique) ----------

const scryptAsync = (password, salt, keylen) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (err, key) => (err ? reject(err) : resolve(key)));
  });

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$'); // scrypt, saltHex, keyHex
    if (parts.length !== 3) return false;
    const key = await scryptAsync(password, Buffer.from(parts[1], 'hex'), 32);
    return safeEqual(key.toString('hex'), parts[2]);
  }
  // Ancien format (compte unique via variable d'env) : sha256 simple
  return safeEqual(sha256hex(password), stored);
}

function emailAllowed(email) {
  const domain = String(email).split('@')[1] || '';
  return /^[^@\s]+@[^@\s]+$/.test(email) && ALLOWED_EMAIL_DOMAINS.includes(domain.toLowerCase());
}

function passwordOk(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200;
}

// ---------- envoi email (SMTP) ----------

let mailTransport = null;

function sendMail(options) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error('[facturier] SMTP non configuré (SMTP_HOST/USER/PASS) — mail non envoyé');
    return Promise.reject(new Error('SMTP non configuré'));
  }
  if (!mailTransport) {
    mailTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = SSL implicite, 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return mailTransport.sendMail(Object.assign({ from: SMTP_FROM }, options));
}

// URL publique de l'instance (liens des emails) : APP_URL en priorité,
// sinon X-Forwarded-Host/Proto fournis par le nginx du VPS.
function publicBaseUrl(req) {
  if (APP_URL) return APP_URL;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
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
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
  `);

  // Amorçage : compte unique historique (AUTH_* dans .env) → table users.
  // Son hash sha256 est vérifié puis migré en scrypt à la première connexion.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0 && LEGACY_EMAIL && LEGACY_PASSWORD_SHA256) {
    await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
      [LEGACY_EMAIL, LEGACY_PASSWORD_SHA256]
    );
    console.log(`[facturier] Compte initial importé : ${LEGACY_EMAIL}`);
  }

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
      const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
      const user = rows[0];
      if (user && await verifyPassword(password, user.password_hash)) {
        loginAttempts.delete(clientIp(req));
        // Ancien hash sha256 (compte initial importé) → migré en scrypt
        if (!user.password_hash.startsWith('scrypt$')) {
          const upgraded = await hashPassword(password);
          await pool.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, upgraded]);
        }
        return sendJson(res, 200, { ok: true }, {
          'Set-Cookie': sessionCookieHeader(email),
          // Purge le cache navigateur de l'origine (ex : vieilles versions
          // de l'app cachées par une version précédente du serveur)
          'Clear-Site-Data': '"cache"',
        });
      }
      return sendJson(res, 401, { error: 'Identifiants incorrects' });
    }

    // --- création de compte (public, domaines autorisés uniquement) ---
    if (pathname === '/api/register' && req.method === 'POST') {
      if (!loginAllowed(clientIp(req))) {
        return sendJson(res, 429, { error: 'Trop de tentatives, réessayez dans 15 minutes' });
      }
      const body = await readJsonBody(req);
      const email = String((body && body.email) || '').trim().toLowerCase();
      const password = String((body && body.password) || '');
      if (!emailAllowed(email)) {
        return sendJson(res, 400, {
          error: `Adresse non autorisée — domaines acceptés : ${ALLOWED_EMAIL_DOMAINS.join(', ')}`,
        });
      }
      if (!passwordOk(password)) {
        return sendJson(res, 400, { error: 'Mot de passe : 8 caractères minimum' });
      }
      const hash = await hashPassword(password);
      const { rowCount } = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
        [email, hash]
      );
      if (rowCount === 0) {
        return sendJson(res, 409, { error: 'Un compte existe déjà pour cet email' });
      }
      loginAttempts.delete(clientIp(req));
      return sendJson(res, 201, { ok: true }, { 'Set-Cookie': sessionCookieHeader(email) });
    }

    // --- mot de passe oublié (public — réponse identique que le compte existe ou non) ---
    if (pathname === '/api/password/forgot' && req.method === 'POST') {
      if (!loginAllowed(clientIp(req))) {
        return sendJson(res, 429, { error: 'Trop de tentatives, réessayez dans 15 minutes' });
      }
      const body = await readJsonBody(req);
      const email = String((body && body.email) || '').trim().toLowerCase();
      const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (rows[0]) {
        // Un seul jeton actif par utilisateur ; les anciens sont purgés
        const token = crypto.randomBytes(32).toString('hex');
        await pool.query('DELETE FROM password_resets WHERE user_id = $1', [rows[0].id]);
        await pool.query(
          'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval \'1 hour\')',
          [sha256hex(token), rows[0].id]
        );
        const link = `${publicBaseUrl(req)}/login.html?reset=${token}`;
        try {
          await sendMail({
            to: email,
            subject: 'Réinitialisation de votre mot de passe — Facturier',
            text:
              'Bonjour,\n\n' +
              'Une réinitialisation de votre mot de passe Facturier a été demandée.\n\n' +
              `Ouvrez ce lien (valable 1 heure) pour choisir un nouveau mot de passe :\n${link}\n\n` +
              "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.\n",
          });
        } catch (e) {
          console.error('[facturier] Envoi email reset impossible:', e.message);
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // --- réinitialisation via jeton (public) ---
    if (pathname === '/api/password/reset' && req.method === 'POST') {
      if (!loginAllowed(clientIp(req))) {
        return sendJson(res, 429, { error: 'Trop de tentatives, réessayez dans 15 minutes' });
      }
      const body = await readJsonBody(req);
      const token = String((body && body.token) || '');
      const password = String((body && body.password) || '');
      if (!/^[0-9a-f]{64}$/.test(token) || !passwordOk(password)) {
        return sendJson(res, 400, { error: 'Lien invalide ou mot de passe trop court (8 caractères minimum)' });
      }
      const { rows } = await pool.query(
        `SELECT user_id FROM password_resets
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
        [sha256hex(token)]
      );
      const reset = rows[0];
      if (!reset) {
        return sendJson(res, 400, { error: 'Lien invalide ou expiré — refaites une demande de réinitialisation' });
      }
      const hash = await hashPassword(password);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [reset.user_id, hash]);
        await client.query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1', [sha256hex(token)]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      return sendJson(res, 200, { ok: true });
    }

    // --- logout ---
    if (pathname === '/api/logout' && req.method === 'POST') {
      const cookie = 'facturier_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    }

    // --- tout le reste de l'API nécessite une session valide ---
    if (pathname.startsWith('/api/')) {
      const email = sessionEmail(req);
      if (!email) {
        return sendJson(res, 401, { error: 'Non authentifié' });
      }
      if (pathname === '/api/me' && req.method === 'GET') {
        return sendJson(res, 200, { email });
      }
      if (pathname === '/api/password/change' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const current = String((body && body.current) || '');
        const next = String((body && body.next) || '');
        if (!passwordOk(next)) {
          return sendJson(res, 400, { error: 'Nouveau mot de passe : 8 caractères minimum' });
        }
        const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
        const user = rows[0];
        if (!user || !await verifyPassword(current, user.password_hash)) {
          return sendJson(res, 401, { error: 'Mot de passe actuel incorrect' });
        }
        const hash = await hashPassword(next);
        await pool.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, hash]);
        return sendJson(res, 200, { ok: true });
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
      const authed = !!sessionEmail(req);
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
