/* ============================================
   ENTREPRISES (multi-entreprise émettrice)
   --------------------------------------------
   Une liste d'entreprises par instance :
   chacune porte ses coordonnées, son logo, son
   IBAN, son régime TVA, ses préfixes de
   numérotation et ses mentions légales.
   - Vue /entreprises : liste + édition (modale)
   - L'éditeur sélectionne l'entreprise émettrice
     du document ; les PDF reprennent ses infos.
   - Les compteurs de numérotation sont propres à
     chaque entreprise (séquences séparées).
   ============================================ */

// Champs d'entreprise → clés équivalentes dans les "settings" historiques
// (les PDF et l'éditeur continuent de consommer un objet settings fusiónné).
const COMPANY_SETTINGS_KEYS = {
  name: 'companyName',
  address: 'address',
  postalCode: 'postalCode',
  city: 'city',
  siret: 'siret',
  tvaNumber: 'tvaNumber',
  phone: 'phone',
  email: 'email',
  website: 'website',
  logo: 'logo',
  bank: 'bank',
  iban: 'iban',
  bic: 'bic',
  legalMentions: 'legalMentions',
  tvaExempt: 'tvaExempt',
  defaultTva: 'defaultTva',
  invoicePrefix: 'invoicePrefix',
  quotePrefix: 'quotePrefix',
};

function newCompanyDefaults() {
  return {
    id: generateId(),
    name: '',
    legalForm: '',
    address: '',
    postalCode: '',
    city: '',
    siret: '',
    tvaNumber: '',
    phone: '',
    email: '',
    website: '',
    logo: null,
    bank: '',
    iban: '',
    bic: '',
    legalMentions: DEFAULT_SETTINGS.legalMentions,
    tvaExempt: false,
    defaultTva: 20,
    invoicePrefix: 'F',
    quotePrefix: 'D',
    isDefault: false,
    createdAt: new Date().toISOString(),
  };
}

function getCompany(companyId) {
  if (!companyId) return null;
  return (state.companies || []).find((c) => c.id === companyId) || null;
}

function getDefaultCompany() {
  const companies = state.companies || [];
  return companies.find((c) => c.isDefault) || companies[0] || null;
}

/**
 * Objet "settings" effectif pour une entreprise : préférences applicatives
 * (settings) + champs propres à l'entreprise (coordonnées, TVA, préfixes…).
 * companyId null/absent → entreprise par défaut.
 */
function getEffectiveSettings(companyId) {
  const company = getCompany(companyId) || getDefaultCompany();
  const merged = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  if (company) {
    for (const [cKey, sKey] of Object.entries(COMPANY_SETTINGS_KEYS)) {
      if (company[cKey] !== undefined && company[cKey] !== null) {
        merged[sKey] = company[cKey];
      }
    }
    merged.companyId = company.id;
  }
  return merged;
}

// --- Compteurs de numérotation : une séquence par entreprise ---

function companyCounters(companyId) {
  const company = getCompany(companyId) || getDefaultCompany();
  // Sans entreprise (rare) : séquence anonyme persistante '__default'
  const key = company ? company.id : '__default';
  const counters = state.counters || (state.counters = { invoice: 0, quote: 0, byCompany: {} });
  if (!counters.byCompany) counters.byCompany = {};
  if (!counters.byCompany[key]) counters.byCompany[key] = { invoice: 0, quote: 0 };
  return counters.byCompany[key];
}

function bumpCompanyCounter(companyId, key) {
  const c = companyCounters(companyId);
  c[key] = Math.max((c[key] || 0) + 1, 1);
}

/**
 * Migration unique vers le modèle multi-entreprise :
 * - crée la 1re entreprise depuis les anciens paramètres si nécessaire ;
 * - complète les entreprises existantes (signature) avec les nouveaux champs ;
 * - garantit exactement une entreprise par défaut ;
 * - déplace les compteurs plats historiques vers l'entreprise par défaut.
 * Retourne true si l'état a été modifié (à persister par l'appelant).
 */
function ensureCompaniesMigrated() {
  let changed = false;
  const companies = state.companies || (state.companies = []);

  if (!companies.length) {
    const s = state.settings || {};
    if (s.companyName) {
      const c = newCompanyDefaults();
      for (const [cKey, sKey] of Object.entries(COMPANY_SETTINGS_KEYS)) {
        if (s[sKey] !== undefined && s[sKey] !== null) c[cKey] = s[sKey];
      }
      c.name = s.companyName;
      c.isDefault = true;
      companies.push(c);
      changed = true;
    }
  }

  companies.forEach((c) => {
    const defaults = newCompanyDefaults();
    let touched = false;
    Object.keys(defaults).forEach((k) => {
      if (c[k] === undefined) {
        c[k] = defaults[k];
        touched = true;
      }
    });
    if (touched) changed = true;
  });

  if (companies.length && !companies.some((c) => c.isDefault)) {
    companies[0].isDefault = true;
    changed = true;
  }
  if (companies.filter((c) => c.isDefault).length > 1) {
    let seen = false;
    companies.forEach((c) => {
      if (c.isDefault && seen) c.isDefault = false;
      if (c.isDefault) seen = true;
    });
    changed = true;
  }

  const counters = state.counters || (state.counters = { invoice: 0, quote: 0 });
  if (!counters.byCompany) counters.byCompany = {};
  const def = getDefaultCompany();
  if (def && (counters.invoice || counters.quote) && !counters.byCompany[def.id]) {
    counters.byCompany[def.id] = { invoice: counters.invoice || 0, quote: counters.quote || 0 };
    changed = true;
  }
  return changed;
}

// --- Sélecteur de l'éditeur ---

function editorCompanyId() {
  const select = document.getElementById('company-select');
  return select ? select.value : '';
}

function editorSettings() {
  return getEffectiveSettings(editorCompanyId());
}

function populateEditorCompanySelect(selectedId) {
  const select = document.getElementById('company-select');
  if (!select) return;
  const companies = state.companies || [];
  const def = getDefaultCompany();
  if (!companies.length) {
    select.innerHTML = '<option value="">Aucune entreprise — créez-en une</option>';
    return;
  }
  select.innerHTML = companies
    .map((c) => {
      const star = c.isDefault ? ' ★' : '';
      return `<option value="${c.id}">${escapeHTML(c.name + star)}</option>`;
    })
    .join('');
  select.value =
    (selectedId && companies.some((c) => c.id === selectedId) && selectedId) ||
    (def ? def.id : '');
}

let lastEditorTvaExempt = false; // régime TVA de l'entreprise précédemment sélectionnée

function handleEditorCompanyChange() {
  if (!editingInvoiceId) {
    document.getElementById('doc-number').value = generateInvoiceNumber(
      document.getElementById('doc-type').value
    );
  }
  // Régime TVA propre à l'entreprise : lignes à 0 si franchise, taux par
  // défaut si l'on quitte une entreprise franchise (sinon taux conservés)
  const s = editorSettings();
  currentLineItems.forEach((item) => {
    if (s.tvaExempt) item.tvaRate = 0;
    else if (item.tvaRate === 0 && lastEditorTvaExempt) item.tvaRate = s.defaultTva || 20;
  });
  lastEditorTvaExempt = !!s.tvaExempt;
  renderLineItems();
  calculateTotals();
}

// --- Vue Entreprises ---

function renderCompanies() {
  const container = document.getElementById('companies-cards');
  if (!container) return;
  const companies = state.companies || [];

  if (!companies.length) {
    container.innerHTML = `
      <p class="empty-state">Aucune entreprise. Créez vos entités (ex : Contrôle Web, ELD Contrôle SAS)
      pour émettre des documents au nom de chacune.</p>`;
    return;
  }

  container.innerHTML = companies
    .map((c) => {
      const logoHTML = c.logo
        ? `<div class="company-card-logo"><img src="${c.logo}" alt="Logo ${escapeHTML(c.name)}"></div>`
        : `<div class="company-card-logo company-card-logo-empty">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
           </div>`;
      const ids = [
        c.legalForm,
        c.siret ? 'SIRET ' + c.siret : '',
        c.tvaExempt ? 'TVA non applicable' : (c.tvaNumber ? 'TVA ' + c.tvaNumber : ''),
      ].filter(Boolean).join(' · ');
      const addr = [c.address, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const counters = (state.counters && state.counters.byCompany && state.counters.byCompany[c.id]) || { invoice: 0, quote: 0 };
      return `
      <div class="company-card">
        ${logoHTML}
        <div class="company-card-info">
          <div class="company-card-name">
            ${escapeHTML(c.name || '(sans nom)')}
            ${c.isDefault ? '<span class="badge badge-default-ent">Par défaut</span>' : ''}
          </div>
          <div class="company-card-details">${escapeHTML(ids || '—')}</div>
          <div class="company-card-details">${escapeHTML(addr || '—')}</div>
          <div class="company-card-counters">Séquences : ${c.invoicePrefix || 'F'} factures · ${c.quotePrefix || 'D'} devis — prochains n° ${String(counters.invoice + 1).padStart(3, '0')} / ${String(counters.quote + 1).padStart(3, '0')}</div>
        </div>
        <div class="company-card-actions">
          ${c.isDefault ? '' : `<button class="btn btn-ghost" onclick="setDefaultCompany('${c.id}')" title="Définir comme entreprise par défaut">★</button>`}
          <button class="btn btn-ghost" onclick="openCompanyModal('${c.id}')" title="Modifier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="btn btn-ghost" onclick="deleteCompany('${c.id}')" title="Supprimer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>`;
    })
    .join('');
}

function setDefaultCompany(companyId) {
  const target = getCompany(companyId);
  if (!target) return;
  (state.companies || []).forEach((c) => {
    c.isDefault = c.id === companyId;
  });
  saveState();
  renderCompanies();
  showToast(`${target.name} est maintenant l'entreprise par défaut`);
}

// --- Modale d'édition ---

let editingCompanyId = null;

function openCompanyModal(companyId) {
  editingCompanyId = companyId || null;
  const modal = document.getElementById('company-modal');
  const c = companyId ? getCompany(companyId) : null;
  document.getElementById('cy-title').textContent = c ? "Modifier l'entreprise" : 'Nouvelle entreprise';
  document.getElementById('cy-name').value = c ? c.name : '';
  document.getElementById('cy-legalform').value = c ? (c.legalForm || '') : '';
  document.getElementById('cy-siret').value = c ? (c.siret || '') : '';
  document.getElementById('cy-tva-number').value = c ? (c.tvaNumber || '') : '';
  document.getElementById('cy-tva-exempt').checked = c ? !!c.tvaExempt : false;
  updateCompanyTvaUI();
  document.getElementById('cy-address').value = c ? (c.address || '') : '';
  document.getElementById('cy-postal').value = c ? (c.postalCode || '') : '';
  document.getElementById('cy-city').value = c ? (c.city || '') : '';
  document.getElementById('cy-phone').value = c ? (c.phone || '') : '';
  document.getElementById('cy-email').value = c ? (c.email || '') : '';
  document.getElementById('cy-website').value = c ? (c.website || '') : '';
  document.getElementById('cy-bank').value = c ? (c.bank || '') : '';
  document.getElementById('cy-iban').value = c ? (c.iban || '') : '';
  document.getElementById('cy-bic').value = c ? (c.bic || '') : '';
  document.getElementById('cy-invoice-prefix').value = c ? (c.invoicePrefix || 'F') : 'F';
  document.getElementById('cy-quote-prefix').value = c ? (c.quotePrefix || 'D') : 'D';
  document.getElementById('cy-default-tva').value = c ? (c.defaultTva != null ? c.defaultTva : 20) : 20;
  document.getElementById('cy-legal').value = c ? (c.legalMentions || '') : DEFAULT_SETTINGS.legalMentions;
  companyModalLogo = c ? c.logo : null;
  updateCompanyLogoPreview();
  modal.classList.add('active');
  setTimeout(() => document.getElementById('cy-name').focus(), 50);
}

function closeCompanyModal() {
  document.getElementById('company-modal').classList.remove('active');
  editingCompanyId = null;
}

function updateCompanyTvaUI() {
  const exempt = document.getElementById('cy-tva-exempt').checked;
  document.getElementById('cy-tva-number-group').style.display = exempt ? 'none' : '';
  const tvaInput = document.getElementById('cy-default-tva');
  tvaInput.disabled = exempt;
  if (exempt) tvaInput.value = '0';
}

let companyModalLogo = null;

function handleCompanyLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 500 * 1024) {
    showToast('Logo trop volumineux (max 500 Ko)', 'error');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function (ev) {
    companyModalLogo = ev.target.result;
    updateCompanyLogoPreview();
  };
  reader.readAsDataURL(file);
}

function removeCompanyLogo() {
  companyModalLogo = null;
  updateCompanyLogoPreview();
  document.getElementById('cy-logo').value = '';
}

function updateCompanyLogoPreview() {
  const preview = document.getElementById('cy-logo-preview');
  const removeBtn = document.getElementById('btn-remove-cy-logo');
  if (companyModalLogo) {
    preview.innerHTML = `<img src="${companyModalLogo}" alt="Logo">`;
    removeBtn.style.display = '';
  } else {
    preview.innerHTML = '';
    removeBtn.style.display = 'none';
  }
}

function submitCompany(e) {
  e.preventDefault();
  const name = document.getElementById('cy-name').value.trim();
  if (!name) return;
  const exempt = document.getElementById('cy-tva-exempt').checked;
  const data = {
    name,
    legalForm: document.getElementById('cy-legalform').value.trim(),
    siret: document.getElementById('cy-siret').value.trim(),
    tvaNumber: exempt ? '' : document.getElementById('cy-tva-number').value.trim(),
    tvaExempt: exempt,
    address: document.getElementById('cy-address').value.trim(),
    postalCode: document.getElementById('cy-postal').value.trim(),
    city: document.getElementById('cy-city').value.trim(),
    phone: document.getElementById('cy-phone').value.trim(),
    email: document.getElementById('cy-email').value.trim(),
    website: document.getElementById('cy-website').value.trim(),
    logo: companyModalLogo,
    bank: document.getElementById('cy-bank').value.trim(),
    iban: document.getElementById('cy-iban').value.trim(),
    bic: document.getElementById('cy-bic').value.trim(),
    invoicePrefix: document.getElementById('cy-invoice-prefix').value.trim() || 'F',
    quotePrefix: document.getElementById('cy-quote-prefix').value.trim() || 'D',
    defaultTva: exempt ? 0 : (parseFloat(document.getElementById('cy-default-tva').value) || 20),
    legalMentions: document.getElementById('cy-legal').value.trim(),
  };
  const existing = editingCompanyId ? getCompany(editingCompanyId) : null;
  if (existing) {
    Object.assign(existing, data);
    showToast('Entreprise mise à jour');
  } else {
    const c = Object.assign(newCompanyDefaults(), data);
    if (!(state.companies || []).some((x) => x.isDefault)) c.isDefault = true;
    (state.companies || (state.companies = [])).push(c);
    showToast('Entreprise enregistrée');
  }
  saveState();
  closeCompanyModal();
  renderCompanies();
  refreshEditorAfterCompanyChange();
}

// Après création/modification/suppression d'une entreprise : réaligne
// l'éditeur (numéro, régime TVA) sur l'entreprise sélectionnée — sans
// toucher au formulaire si un document est en cours d'édition.
function refreshEditorAfterCompanyChange() {
  populateEditorCompanySelect(editorCompanyId() || (getDefaultCompany() && getDefaultCompany().id));
  if (typeof editingInvoiceId !== 'undefined' && !editingInvoiceId &&
      typeof handleEditorCompanyChange === 'function') {
    handleEditorCompanyChange();
  }
}

function deleteCompany(companyId) {
  const companies = state.companies || [];
  if (companies.length <= 1) {
    showToast('Impossible de supprimer la dernière entreprise', 'error');
    return;
  }
  const company = getCompany(companyId);
  if (!company) return;
  const usedCount = state.invoices.filter((i) => i.companyId === companyId).length;
  const msg = usedCount
    ? `Supprimer « ${company.name} » ? ${usedCount} document(s) l'ont comme émetteur : ils conservent leurs informations figées, mais l'entreprise ne pourra plus être sélectionnée.`
    : `Supprimer « ${company.name} » ?`;
  if (!confirm(msg)) return;
  state.companies = companies.filter((c) => c.id !== companyId);
  if (!state.companies.some((c) => c.isDefault) && state.companies[0]) {
    state.companies[0].isDefault = true;
  }
  if (typeof sigWizard !== 'undefined' && sigWizard && sigWizard.companyId === companyId) {
    sigWizard.companyId = '';
  }
  saveState();
  renderCompanies();
  refreshEditorAfterCompanyChange();
  showToast('Entreprise supprimée');
}

// --- Initialisation (bindings) ---

let companiesInitialized = false;

function initCompanies() {
  if (companiesInitialized) return;
  companiesInitialized = true;

  const $ = (id) => document.getElementById(id);

  // Vue Entreprises
  $('btn-new-company').addEventListener('click', () => openCompanyModal(null));

  // Modale d'édition
  $('cy-close').addEventListener('click', closeCompanyModal);
  document.querySelector('#company-modal .modal-overlay').addEventListener('click', closeCompanyModal);
  $('cy-form').addEventListener('submit', submitCompany);
  $('cy-logo').addEventListener('change', handleCompanyLogoUpload);
  $('btn-remove-cy-logo').addEventListener('click', removeCompanyLogo);
  $('cy-tva-exempt').addEventListener('change', updateCompanyTvaUI);

  // Sélecteur de l'éditeur
  $('company-select').addEventListener('change', handleEditorCompanyChange);
}
