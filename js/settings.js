/* ============================================
   COMPTE (page /compte)
   --------------------------------------------
   L'ancienne page Paramètres est devenue :
   - Mon compte : email de session, changement de
     mot de passe, déconnexion (mode serveur) ;
   - Comptes : liste des comptes de l'instance ;
   - Données : import/export de sauvegarde JSON.
   Les informations d'entreprise (émetteur des
   factures) vivent désormais dans la page
   Entreprises (multi-entreprise).
   ============================================ */

let accountCurrentUser = null; // email de session (mode serveur)

async function renderAccountPage() {
  const serverBlocks = document.querySelectorAll('.server-only');
  const localNote = document.getElementById('account-local-note');
  if (typeof SERVER_MODE !== 'undefined' && SERVER_MODE) {
    serverBlocks.forEach((el) => (el.style.display = ''));
    if (localNote) localNote.style.display = 'none';
    await loadAccountInfo();
    await loadAccountsList();
  } else {
    serverBlocks.forEach((el) => (el.style.display = 'none'));
    if (localNote) localNote.style.display = '';
  }
}

async function loadAccountInfo() {
  const emailEl = document.getElementById('account-email');
  if (!emailEl) return;
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (r.status === 401) return redirectToLogin();
    const j = await r.json();
    accountCurrentUser = j.email || '?';
  } catch (e) {
    accountCurrentUser = 'inconnu (serveur injoignable)';
  }
  emailEl.textContent = accountCurrentUser;
}

async function loadAccountsList() {
  const listEl = document.getElementById('accounts-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="empty-state">Chargement…</p>';
  let users = [];
  try {
    const r = await fetch('/api/users', { credentials: 'same-origin' });
    if (r.status === 401) return redirectToLogin();
    const j = await r.json();
    users = j.users || [];
  } catch (e) {
    listEl.innerHTML = '<p class="empty-state">Liste des comptes indisponible (serveur injoignable).</p>';
    return;
  }
  if (!users.length) {
    listEl.innerHTML = '<p class="empty-state">Aucun compte.</p>';
    return;
  }
  listEl.innerHTML = users
    .map((u) => {
      const isMe = accountCurrentUser && u.email === accountCurrentUser;
      const verified = u.emailVerifiedAt
        ? '<span class="badge badge-account-ok">Email vérifié</span>'
        : '<span class="badge badge-account-pending">Vérification en attente</span>';
      return `
      <div class="account-item${isMe ? ' account-item-me' : ''}">
        <div class="account-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="account-item-info">
          <div class="account-item-email">${escapeHTML(u.email)}${isMe ? ' <span class="badge badge-default-ent">Vous</span>' : ''}</div>
          <div class="account-item-details">${verified}${u.createdAt ? ' · créé le ' + new Date(u.createdAt).toLocaleDateString('fr-FR') : ''}</div>
        </div>
      </div>`;
    })
    .join('');
}

// --- Import / Export (sauvegarde des données) ---

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `facturier-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Données exportées');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      const imported = JSON.parse(ev.target.result);

      if (!imported.settings || !imported.invoices || !imported.clients) {
        showToast('Fichier invalide : structure incorrecte', 'error');
        return;
      }

      if (!confirm('Cela remplacera toutes vos données actuelles. Continuer ?')) return;

      state.settings = { ...DEFAULT_SETTINGS, ...imported.settings };
      state.clients = imported.clients || [];
      state.invoices = imported.invoices || [];
      state.counters = imported.counters || { invoice: 0, quote: 0 };
      state.companies = imported.companies || [];
      state.signatureProfiles = imported.signatureProfiles || [];
      if (typeof ensureCompaniesMigrated === 'function') ensureCompaniesMigrated();

      saveState();
      populateClientSelect();
      if (typeof renderCompanies === 'function') renderCompanies();
      if (typeof renderProfiles === 'function') renderProfiles();
      populateEditorCompanySelect(getDefaultCompany() ? getDefaultCompany().id : '');
      resetInvoiceForm();
      showToast('Données importées avec succès');
    } catch (err) {
      console.error('Import error:', err);
      showToast('Erreur lors de la lecture du fichier', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}
