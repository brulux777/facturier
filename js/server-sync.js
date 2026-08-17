/* ============================================
   SYNCHRONISATION SERVEUR (optionnelle)
   --------------------------------------------
   Si un backend /api répond (déploiement Docker
   self-hébergé), l'état vit sur le serveur après
   login (page dédiée /login.html, redirection par
   le serveur si non connecté). Sinon (ex. GitHub
   Pages), l'app reste 100% locale via localStorage.
   ============================================ */
let SERVER_MODE = false;
let syncTimer = null;

async function detectServerMode() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch('/api/health', { signal: ctrl.signal, credentials: 'same-origin' });
    clearTimeout(t);
    const j = await r.json().catch(() => null);
    SERVER_MODE = !!(r.ok && j && j.server);
  } catch (e) {
    SERVER_MODE = false;
  }
  return SERVER_MODE;
}

// Session expirée : le serveur renvoie 401 → page de connexion
function redirectToLogin() {
  location.replace('/login.html');
}

async function doLogout() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (e) { /* ignore */ }
  location.replace('/login.html');
}

// ---------- État ----------

async function loadServerState() {
  const r = await fetch('/api/state', { credentials: 'same-origin' });
  if (r.status === 401) {
    redirectToLogin();
    throw new Error('redirect-login');
  }
  if (!r.ok) throw new Error('state ' + r.status);
  const j = await r.json();
  return j.state;
}

async function pushStateToServer() {
  if (!SERVER_MODE) return false;
  try {
    const r = await fetch('/api/state', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (r.status === 401) {
      redirectToLogin();
      return false;
    }
    if (r.status === 409) {
      // Garde anti-écrasement : l'état local est désynchronisé (ex : onglet
      // ouvert depuis longtemps, ancienne version). On recharge l'état
      // serveur plutôt que d'écraser les données.
      showToast('Données plus récentes sur le serveur — rechargement...', 'error');
      setTimeout(() => location.reload(), 1200);
      return false;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return true;
  } catch (e) {
    if (e.message === 'redirect-login') return false;
    console.error('Sync serveur:', e);
    showToast('Synchronisation serveur impossible', 'error');
    return false;
  }
}

function scheduleServerSync(delay = 400) {
  if (!SERVER_MODE) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushStateToServer, delay);
}

/**
 * Au démarrage : détecte le mode, charge l'état serveur
 * (login si besoin), ou bascule en local sinon.
 */
async function syncBootstrap() {
  await detectServerMode();
  document.getElementById('btn-logout').style.display = SERVER_MODE ? '' : 'none';

  if (!SERVER_MODE) {
    loadState(); // mode local (GitHub Pages / fichier)
    return;
  }

  let serverState = null;
  try {
    serverState = await loadServerState(); // 401 → redirection /login.html
  } catch (e) {
    if (e.message === 'redirect-login') throw e;
    showToast('Serveur injoignable — mode local', 'error');
    loadState();
    SERVER_MODE = false;
    document.getElementById('btn-logout').style.display = 'none';
    return;
  }

  if (serverState) {
    state.settings = { ...DEFAULT_SETTINGS, ...serverState.settings };
    state.clients = serverState.clients || [];
    state.invoices = serverState.invoices || [];
    state.counters = serverState.counters || { invoice: 0, quote: 0 };
    return;
  }

  // Premier lancement serveur : migration des données locales si présentes
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    const hasData =
      (saved.clients && saved.clients.length) ||
      (saved.invoices && saved.invoices.length) ||
      (saved.settings && saved.settings.companyName);
    if (!hasData) return;
    state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    state.clients = saved.clients || [];
    state.invoices = saved.invoices || [];
    state.counters = saved.counters || { invoice: 0, quote: 0 };
    const ok = await pushStateToServer();
    if (ok) {
      localStorage.removeItem(STORAGE_KEY);
      showToast('Données locales migrées vers le serveur');
    }
  } catch (e) { /* données locales illisibles : on ignore */ }
}
