/* ============================================
   FACTURIER PRO — Application Logic
   ============================================ */

// ============================================
// STATE
// ============================================
const STORAGE_KEY = 'facturier_data';

const DEFAULT_SETTINGS = {
  companyName: '',
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
  defaultPaymentTerms: 'Virement bancaire',
  defaultPaymentDelay: 30,
  defaultTva: 20,
  invoicePrefix: 'F',
  quotePrefix: 'D',
  legalMentions:
    "En cas de retard de paiement, une pénalité de 3 fois le taux d'intérêt légal sera appliquée, ainsi qu'une indemnité forfaitaire de 40 € pour frais de recouvrement. Pas d'escompte en cas de paiement anticipé.",
};

let state = {
  settings: { ...DEFAULT_SETTINGS },
  clients: [],
  invoices: [],
  counters: { invoice: 0, quote: 0 },
};

let currentLineItems = [];
let editingInvoiceId = null;

// ============================================
// PERSISTENCE
// ============================================
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
      state.clients = saved.clients || [];
      state.invoices = saved.invoices || [];
      state.counters = saved.counters || { invoice: 0, quote: 0 };
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

// ============================================
// HELPERS
// ============================================
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// TOAST
// ============================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 2500);
}

// ============================================
// NAVIGATION
// ============================================
function showView(viewId) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

  const view = document.getElementById('view-' + viewId);
  if (view) view.classList.add('active');

  const btn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
  if (btn) btn.classList.add('active');

  if (viewId === 'history') renderHistory();
  if (viewId === 'clients') renderClients();
}

// ============================================
// SETTINGS
// ============================================
function loadSettingsForm() {
  const s = state.settings;
  const form = document.getElementById('settings-form');
  form.elements.companyName.value = s.companyName;
  form.elements.address.value = s.address;
  form.elements.postalCode.value = s.postalCode;
  form.elements.city.value = s.city;
  form.elements.siret.value = s.siret;
  form.elements.tvaNumber.value = s.tvaNumber;
  form.elements.phone.value = s.phone;
  form.elements.email.value = s.email;
  form.elements.website.value = s.website;
  form.elements.bank.value = s.bank;
  form.elements.iban.value = s.iban;
  form.elements.bic.value = s.bic;
  form.elements.defaultPaymentTerms.value = s.defaultPaymentTerms;
  form.elements.defaultPaymentDelay.value = s.defaultPaymentDelay;
  form.elements.defaultTva.value = s.defaultTva;
  form.elements.invoicePrefix.value = s.invoicePrefix;
  form.elements.quotePrefix.value = s.quotePrefix;
  form.elements.legalMentions.value = s.legalMentions;

  updateLogoPreview();
}

function saveSettings(e) {
  e.preventDefault();
  const form = document.getElementById('settings-form');
  state.settings.companyName = form.elements.companyName.value.trim();
  state.settings.address = form.elements.address.value.trim();
  state.settings.postalCode = form.elements.postalCode.value.trim();
  state.settings.city = form.elements.city.value.trim();
  state.settings.siret = form.elements.siret.value.trim();
  state.settings.tvaNumber = form.elements.tvaNumber.value.trim();
  state.settings.phone = form.elements.phone.value.trim();
  state.settings.email = form.elements.email.value.trim();
  state.settings.website = form.elements.website.value.trim();
  state.settings.bank = form.elements.bank.value.trim();
  state.settings.iban = form.elements.iban.value.trim();
  state.settings.bic = form.elements.bic.value.trim();
  state.settings.defaultPaymentTerms = form.elements.defaultPaymentTerms.value.trim();
  state.settings.defaultPaymentDelay = parseInt(form.elements.defaultPaymentDelay.value) || 30;
  state.settings.defaultTva = parseFloat(form.elements.defaultTva.value) || 20;
  state.settings.invoicePrefix = form.elements.invoicePrefix.value.trim() || 'F';
  state.settings.quotePrefix = form.elements.quotePrefix.value.trim() || 'D';
  state.settings.legalMentions = form.elements.legalMentions.value.trim();
  saveState();
  showToast('Paramètres enregistrés');
}

function handleLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 500 * 1024) {
    showToast('Logo trop volumineux (max 500 Ko)', 'error');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function (ev) {
    state.settings.logo = ev.target.result;
    saveState();
    updateLogoPreview();
    showToast('Logo enregistré');
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  state.settings.logo = null;
  saveState();
  updateLogoPreview();
  document.getElementById('s-logo').value = '';
}

function updateLogoPreview() {
  const preview = document.getElementById('logo-preview');
  const removeBtn = document.getElementById('btn-remove-logo');
  if (state.settings.logo) {
    preview.innerHTML = `<img src="${state.settings.logo}" alt="Logo">`;
    removeBtn.style.display = '';
  } else {
    preview.innerHTML = '';
    removeBtn.style.display = 'none';
  }
}

// ============================================
// CLIENTS
// ============================================
function saveClientFromForm() {
  const name = document.getElementById('client-name').value.trim();
  if (!name) {
    showToast('Saisissez le nom du client', 'error');
    return;
  }

  const clientData = {
    name,
    email: document.getElementById('client-email').value.trim(),
    address: document.getElementById('client-address').value.trim(),
    postalCode: document.getElementById('client-postal').value.trim(),
    city: document.getElementById('client-city').value.trim(),
    siret: document.getElementById('client-siret').value.trim(),
  };

  const existing = state.clients.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    Object.assign(existing, clientData);
    showToast('Client mis à jour');
  } else {
    state.clients.push({ id: generateId(), ...clientData });
    showToast('Client enregistré');
  }

  saveState();
  populateClientSelect();
}

function populateClientSelect() {
  const select = document.getElementById('client-select');
  const current = select.value;
  select.innerHTML = '<option value="">— Sélectionner un client —</option>';
  state.clients
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });
  select.value = current;
}

function loadClientIntoForm(clientId) {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return;
  document.getElementById('client-name').value = client.name;
  document.getElementById('client-email').value = client.email || '';
  document.getElementById('client-address').value = client.address || '';
  document.getElementById('client-postal').value = client.postalCode || '';
  document.getElementById('client-city').value = client.city || '';
  document.getElementById('client-siret').value = client.siret || '';
}

function deleteClient(clientId) {
  if (!confirm('Supprimer ce client ?')) return;
  state.clients = state.clients.filter((c) => c.id !== clientId);
  saveState();
  populateClientSelect();
  renderClients();
  showToast('Client supprimé');
}

function renderClients() {
  const container = document.getElementById('clients-list');
  if (state.clients.length === 0) {
    container.innerHTML = '<p class="empty-state">Aucun client enregistré.</p>';
    return;
  }

  container.innerHTML = state.clients
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (c) => `
      <div class="client-item">
        <div class="client-item-info">
          <div class="client-item-name">${escapeHTML(c.name)}</div>
          <div class="client-item-details">
            ${[c.address, c.postalCode, c.city].filter(Boolean).join(', ') || 'Aucune adresse'}
            ${c.siret ? ' — SIRET: ' + escapeHTML(c.siret) : ''}
          </div>
        </div>
        <div class="client-item-actions">
          <button class="btn btn-ghost" onclick="deleteClient('${c.id}')" title="Supprimer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `
    )
    .join('');
}

// ============================================
// INVOICE NUMBER
// ============================================
function generateInvoiceNumber(type) {
  const year = new Date().getFullYear();
  const prefix =
    type === 'invoice' ? state.settings.invoicePrefix : state.settings.quotePrefix;
  const counterKey = type === 'invoice' ? 'invoice' : 'quote';
  state.counters[counterKey]++;
  saveState();
  const num = String(state.counters[counterKey]).padStart(3, '0');
  return `${prefix}-${year}-${num}`;
}

// ============================================
// LINE ITEMS
// ============================================
function createEmptyLine() {
  return {
    id: generateId(),
    description: '',
    quantity: 1,
    unitPrice: 0,
    tvaRate: state.settings.defaultTva,
  };
}

function renderLineItems() {
  const container = document.getElementById('line-items-container');
  container.innerHTML = currentLineItems
    .map(
      (item, i) => `
      <div class="line-item" data-index="${i}">
        <input type="text" value="${escapeHTML(item.description)}" placeholder="Description" data-field="description">
        <input type="number" value="${item.quantity}" min="0" step="1" data-field="quantity">
        <input type="number" value="${item.unitPrice}" min="0" step="0.01" data-field="unitPrice">
        <input type="number" value="${item.tvaRate}" min="0" max="100" step="0.1" data-field="tvaRate">
        <div class="li-total-value">${formatCurrency(round2(item.quantity * item.unitPrice))}</div>
        <button type="button" class="btn btn-ghost btn-remove-line" data-index="${i}" title="Supprimer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `
    )
    .join('');

  calculateTotals();
}

function handleLineItemChange(e) {
  const lineEl = e.target.closest('.line-item');
  if (!lineEl) return;
  const index = parseInt(lineEl.dataset.index);
  const field = e.target.dataset.field;
  if (field === undefined) return;

  const item = currentLineItems[index];
  if (!item) return;

  if (field === 'description') {
    item.description = e.target.value;
  } else if (field === 'quantity') {
    item.quantity = parseFloat(e.target.value) || 0;
  } else if (field === 'unitPrice') {
    item.unitPrice = parseFloat(e.target.value) || 0;
  } else if (field === 'tvaRate') {
    item.tvaRate = parseFloat(e.target.value) || 0;
  }

  const totalEl = lineEl.querySelector('.li-total-value');
  if (totalEl) {
    totalEl.textContent = formatCurrency(round2(item.quantity * item.unitPrice));
  }

  calculateTotals();
}

function removeLineItem(index) {
  currentLineItems.splice(index, 1);
  renderLineItems();
}

function addLineItem() {
  currentLineItems.push(createEmptyLine());
  renderLineItems();
  const container = document.getElementById('line-items-container');
  const lastInput = container.querySelector(
    '.line-item:last-child input[data-field="description"]'
  );
  if (lastInput) lastInput.focus();
}

// ============================================
// CALCULATIONS
// ============================================
function calculateTotals() {
  let totalHT = 0;
  const tvaMap = {};

  currentLineItems.forEach((item) => {
    const lineHT = round2(item.quantity * item.unitPrice);
    totalHT += lineHT;

    const rate = item.tvaRate;
    if (!tvaMap[rate]) tvaMap[rate] = 0;
    tvaMap[rate] += lineHT;
  });

  totalHT = round2(totalHT);

  let totalTVA = 0;
  const tvaBreakdown = [];
  Object.keys(tvaMap)
    .sort((a, b) => parseFloat(a) - parseFloat(b))
    .forEach((rate) => {
      const base = round2(tvaMap[rate]);
      const tva = round2(base * (parseFloat(rate) / 100));
      totalTVA += tva;
      tvaBreakdown.push({ rate: parseFloat(rate), base, tva });
    });

  totalTVA = round2(totalTVA);
  const totalTTC = round2(totalHT + totalTVA);

  document.getElementById('total-ht').textContent = formatCurrency(totalHT);
  document.getElementById('total-ttc').textContent = formatCurrency(totalTTC);

  const breakdownEl = document.getElementById('tva-breakdown');
  breakdownEl.innerHTML = tvaBreakdown
    .map(
      (b) => `
      <div class="totals-row">
        <span>TVA ${b.rate}% (sur ${formatCurrency(b.base)})</span>
        <span>${formatCurrency(b.tva)}</span>
      </div>
    `
    )
    .join('');

  return { totalHT, totalTVA, totalTTC, tvaBreakdown };
}

// ============================================
// INVOICE FORM
// ============================================
function resetInvoiceForm() {
  editingInvoiceId = null;
  const form = document.getElementById('invoice-form');

  const docType = document.getElementById('doc-type');
  docType.value = 'invoice';

  document.getElementById('doc-number').value = generateInvoiceNumber('invoice');
  document.getElementById('doc-date').value = todayISO();
  document.getElementById('doc-due-date').value = addDays(
    todayISO(),
    state.settings.defaultPaymentDelay
  );

  document.getElementById('client-select').value = '';
  document.getElementById('client-name').value = '';
  document.getElementById('client-email').value = '';
  document.getElementById('client-address').value = '';
  document.getElementById('client-postal').value = '';
  document.getElementById('client-city').value = '';
  document.getElementById('client-siret').value = '';

  document.getElementById('doc-notes').value = '';

  currentLineItems = [createEmptyLine()];
  renderLineItems();

  document.querySelector('.view-header h2').textContent = 'Nouveau document';
}

function loadInvoiceIntoForm(invoiceId) {
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;

  editingInvoiceId = inv.id;

  document.getElementById('doc-type').value = inv.type;
  document.getElementById('doc-number').value = inv.number;
  document.getElementById('doc-date').value = inv.date;
  document.getElementById('doc-due-date').value = inv.dueDate || '';

  document.getElementById('client-name').value = inv.client.name || '';
  document.getElementById('client-email').value = inv.client.email || '';
  document.getElementById('client-address').value = inv.client.address || '';
  document.getElementById('client-postal').value = inv.client.postalCode || '';
  document.getElementById('client-city').value = inv.client.city || '';
  document.getElementById('client-siret').value = inv.client.siret || '';

  if (inv.clientId) {
    document.getElementById('client-select').value = inv.clientId;
  }

  document.getElementById('doc-notes').value = inv.notes || '';

  currentLineItems = inv.items.map((item) => ({ ...item, id: item.id || generateId() }));
  renderLineItems();

  document.querySelector('.view-header h2').textContent =
    `Modifier ${inv.type === 'invoice' ? 'facture' : 'devis'} ${inv.number}`;
  showView('editor');
}

function collectInvoiceData() {
  const type = document.getElementById('doc-type').value;
  const number = document.getElementById('doc-number').value;
  const date = document.getElementById('doc-date').value;
  const dueDate = document.getElementById('doc-due-date').value;
  const notes = document.getElementById('doc-notes').value.trim();
  const clientId = document.getElementById('client-select').value || null;

  const client = {
    name: document.getElementById('client-name').value.trim(),
    email: document.getElementById('client-email').value.trim(),
    address: document.getElementById('client-address').value.trim(),
    postalCode: document.getElementById('client-postal').value.trim(),
    city: document.getElementById('client-city').value.trim(),
    siret: document.getElementById('client-siret').value.trim(),
  };

  const totals = calculateTotals();

  return {
    type,
    number,
    date,
    dueDate,
    client,
    clientId,
    items: currentLineItems.map((item) => ({ ...item })),
    notes,
    totals,
    settings: { ...state.settings },
  };
}

function validateInvoice(data) {
  if (!data.client.name) {
    showToast('Saisissez le nom du client', 'error');
    return false;
  }
  if (!data.date) {
    showToast('Saisissez la date', 'error');
    return false;
  }
  const hasItems = data.items.some((i) => i.description.trim() && i.unitPrice > 0);
  if (!hasItems) {
    showToast('Ajoutez au moins une ligne avec description et prix', 'error');
    return false;
  }
  return true;
}

function saveInvoice(status = 'draft') {
  const data = collectInvoiceData();
  if (!validateInvoice(data)) return null;

  if (editingInvoiceId) {
    const idx = state.invoices.findIndex((i) => i.id === editingInvoiceId);
    if (idx >= 0) {
      state.invoices[idx] = {
        ...state.invoices[idx],
        ...data,
        status: status || state.invoices[idx].status,
        dateModified: new Date().toISOString(),
      };
    }
  } else {
    const invoice = {
      id: generateId(),
      ...data,
      status,
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
    };
    state.invoices.push(invoice);
    editingInvoiceId = invoice.id;
  }

  saveState();
  showToast('Document enregistré');
  return editingInvoiceId;
}

// ============================================
// PDF GENERATION
// ============================================
function buildInvoiceHTML(data) {
  const s = data.settings || state.settings;
  const c = data.client;
  const typeLabel = data.type === 'invoice' ? 'FACTURE' : 'DEVIS';

  let logoHTML = '';
  if (s.logo) {
    logoHTML = `<img src="${s.logo}" style="max-height:60px;max-width:180px;object-fit:contain;" alt="Logo">`;
  }

  const companyLines = [
    s.address,
    [s.postalCode, s.city].filter(Boolean).join(' '),
  ].filter(Boolean);
  const companyContact = [s.phone, s.email].filter(Boolean).join(' — ');
  const companyIds = [
    s.siret ? `SIRET: ${s.siret}` : '',
    s.tvaNumber ? `TVA: ${s.tvaNumber}` : '',
  ]
    .filter(Boolean)
    .join(' — ');

  const clientLines = [
    c.address,
    [c.postalCode, c.city].filter(Boolean).join(' '),
  ].filter(Boolean);

  const itemRows = data.items
    .filter((i) => i.description.trim())
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${escapeHTML(item.description)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${item.quantity}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;">${formatCurrency(item.unitPrice)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${item.tvaRate}%</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;font-weight:500;">${formatCurrency(round2(item.quantity * item.unitPrice))}</td>
      </tr>
    `
    )
    .join('');

  const tvaRows = data.totals.tvaBreakdown
    .map(
      (b) => `
      <tr>
        <td style="padding:5px 10px;font-size:13px;color:#64748b;">TVA ${b.rate}% (sur ${formatCurrency(b.base)})</td>
        <td style="padding:5px 10px;text-align:right;font-size:13px;">${formatCurrency(b.tva)}</td>
      </tr>
    `
    )
    .join('');

  const paymentInfo =
    s.defaultPaymentTerms || s.iban
      ? `
      <div style="margin-top:24px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
        <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.03em;">Modalités de paiement</div>
        ${s.defaultPaymentTerms ? `<div style="font-size:12px;color:#475569;">Mode : ${escapeHTML(s.defaultPaymentTerms)}</div>` : ''}
        ${data.dueDate ? `<div style="font-size:12px;color:#475569;">Échéance : ${formatDate(data.dueDate)}</div>` : ''}
        ${s.bank ? `<div style="font-size:12px;color:#475569;margin-top:6px;">Banque : ${escapeHTML(s.bank)}</div>` : ''}
        ${s.iban ? `<div style="font-size:12px;color:#475569;">IBAN : ${escapeHTML(s.iban)}</div>` : ''}
        ${s.bic ? `<div style="font-size:12px;color:#475569;">BIC : ${escapeHTML(s.bic)}</div>` : ''}
      </div>
    `
      : '';

  const notesHTML = data.notes
    ? `
      <div style="margin-top:16px;">
        <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;">Notes</div>
        <div style="font-size:12px;color:#475569;white-space:pre-wrap;">${escapeHTML(data.notes)}</div>
      </div>
    `
    : '';

  const legalHTML = s.legalMentions
    ? `
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;">
        <div style="font-size:10px;color:#94a3b8;line-height:1.5;">${escapeHTML(s.legalMentions)}</div>
      </div>
    `
    : '';

  return `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1e293b;padding:40px;max-width:780px;margin:0 auto;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;">
        <div>
          ${logoHTML}
          <div style="font-size:16px;font-weight:700;color:#1e293b;margin-top:${s.logo ? '8' : '0'}px;">${escapeHTML(s.companyName)}</div>
          ${companyLines.map((l) => `<div style="font-size:12px;color:#64748b;">${escapeHTML(l)}</div>`).join('')}
          ${companyContact ? `<div style="font-size:12px;color:#64748b;margin-top:4px;">${escapeHTML(companyContact)}</div>` : ''}
          ${companyIds ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${escapeHTML(companyIds)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:700;color:#2563eb;letter-spacing:0.02em;">${typeLabel}</div>
          <div style="font-size:14px;font-weight:600;color:#1e293b;margin-top:4px;">N° ${escapeHTML(data.number)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Date : ${formatDate(data.date)}</div>
          ${data.dueDate ? `<div style="font-size:12px;color:#64748b;">Échéance : ${formatDate(data.dueDate)}</div>` : ''}
        </div>
      </div>

      <!-- Client -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;margin-bottom:28px;max-width:320px;margin-left:auto;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Destinataire</div>
        <div style="font-size:14px;font-weight:600;color:#1e293b;">${escapeHTML(c.name)}</div>
        ${clientLines.map((l) => `<div style="font-size:12px;color:#475569;">${escapeHTML(l)}</div>`).join('')}
        ${c.siret ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">SIRET: ${escapeHTML(c.siret)}</div>` : ''}
      </div>

      <!-- Items Table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:10px;text-align:left;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;">Description</th>
            <th style="padding:10px;text-align:center;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:60px;">Qté</th>
            <th style="padding:10px;text-align:right;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:100px;">PU HT</th>
            <th style="padding:10px;text-align:center;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:60px;">TVA</th>
            <th style="padding:10px;text-align:right;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:110px;">Total HT</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <!-- Totals -->
      <div style="display:flex;justify-content:flex-end;">
        <table style="border-collapse:collapse;min-width:260px;">
          <tr>
            <td style="padding:5px 10px;font-size:13px;color:#64748b;">Total HT</td>
            <td style="padding:5px 10px;text-align:right;font-size:13px;font-weight:600;">${formatCurrency(data.totals.totalHT)}</td>
          </tr>
          ${tvaRows}
          <tr style="border-top:2px solid #2563eb;">
            <td style="padding:10px;font-size:15px;font-weight:700;color:#1e293b;">Total TTC</td>
            <td style="padding:10px;text-align:right;font-size:15px;font-weight:700;color:#2563eb;">${formatCurrency(data.totals.totalTTC)}</td>
          </tr>
        </table>
      </div>

      ${notesHTML}
      ${paymentInfo}
      ${legalHTML}
    </div>
  `;
}

function showPreview() {
  const data = collectInvoiceData();
  if (!validateInvoice(data)) return;

  const html = buildInvoiceHTML(data);
  document.getElementById('invoice-preview').innerHTML = html;
  document.getElementById('preview-modal').classList.add('active');
}

function closePreview() {
  document.getElementById('preview-modal').classList.remove('active');
}

function downloadPDF() {
  const data = collectInvoiceData();
  if (!validateInvoice(data)) return;

  const html = buildInvoiceHTML(data);
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  const filename = `${data.number}.pdf`;

  html2pdf()
    .set({
      margin: [10, 10, 15, 10],
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    })
    .from(container)
    .save()
    .then(() => {
      document.body.removeChild(container);
      showToast('PDF téléchargé');
    })
    .catch((err) => {
      console.error('PDF error:', err);
      document.body.removeChild(container);
      showToast('Erreur lors de la génération du PDF', 'error');
    });
}

// ============================================
// HISTORY
// ============================================
function renderHistory() {
  const container = document.getElementById('history-list');
  const search = (document.getElementById('history-search').value || '').toLowerCase();
  const filter = document.getElementById('history-filter').value;

  let invoices = [...state.invoices].sort(
    (a, b) => new Date(b.dateCreated) - new Date(a.dateCreated)
  );

  if (filter !== 'all') {
    invoices = invoices.filter((i) => i.type === filter);
  }

  if (search) {
    invoices = invoices.filter(
      (i) =>
        i.number.toLowerCase().includes(search) ||
        i.client.name.toLowerCase().includes(search)
    );
  }

  if (invoices.length === 0) {
    container.innerHTML = '<p class="empty-state">Aucun document trouvé.</p>';
    return;
  }

  container.innerHTML = invoices
    .map((inv) => {
      const typeBadge =
        inv.type === 'invoice'
          ? '<span class="badge badge-invoice">Facture</span>'
          : '<span class="badge badge-quote">Devis</span>';

      const statusBadge = {
        draft: '<span class="badge badge-draft">Brouillon</span>',
        sent: '<span class="badge badge-sent">Envoyée</span>',
        paid: '<span class="badge badge-paid">Payée</span>',
      }[inv.status] || '';

      return `
        <div class="history-item">
          <div class="history-item-info">
            <div class="history-item-top">
              <span class="history-item-number">${escapeHTML(inv.number)}</span>
              ${typeBadge}
              ${statusBadge}
              <span class="history-item-date">${formatDate(inv.date)}</span>
            </div>
            <div class="history-item-client">${escapeHTML(inv.client.name)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="history-item-amount">${formatCurrency(inv.totals.totalTTC)}</div>
            <div class="history-item-actions">
              <button class="btn btn-sm btn-outline" onclick="loadInvoiceIntoForm('${inv.id}')" title="Modifier">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </button>
              <button class="btn btn-sm btn-outline" onclick="duplicateInvoice('${inv.id}')" title="Dupliquer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <select class="btn btn-sm btn-outline" onchange="updateInvoiceStatus('${inv.id}', this.value)" style="font-size:0.75rem;padding:4px 6px;">
                <option value="draft" ${inv.status === 'draft' ? 'selected' : ''}>Brouillon</option>
                <option value="sent" ${inv.status === 'sent' ? 'selected' : ''}>Envoyée</option>
                <option value="paid" ${inv.status === 'paid' ? 'selected' : ''}>Payée</option>
              </select>
              <button class="btn btn-ghost" onclick="deleteInvoice('${inv.id}')" title="Supprimer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function duplicateInvoice(invoiceId) {
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;

  editingInvoiceId = null;
  const type = inv.type;
  const newNumber = generateInvoiceNumber(type);

  document.getElementById('doc-type').value = type;
  document.getElementById('doc-number').value = newNumber;
  document.getElementById('doc-date').value = todayISO();
  document.getElementById('doc-due-date').value = addDays(
    todayISO(),
    state.settings.defaultPaymentDelay
  );

  document.getElementById('client-name').value = inv.client.name || '';
  document.getElementById('client-email').value = inv.client.email || '';
  document.getElementById('client-address').value = inv.client.address || '';
  document.getElementById('client-postal').value = inv.client.postalCode || '';
  document.getElementById('client-city').value = inv.client.city || '';
  document.getElementById('client-siret').value = inv.client.siret || '';

  if (inv.clientId) document.getElementById('client-select').value = inv.clientId;

  document.getElementById('doc-notes').value = inv.notes || '';

  currentLineItems = inv.items.map((item) => ({ ...item, id: generateId() }));
  renderLineItems();

  document.querySelector('.view-header h2').textContent = 'Nouveau document (copie)';
  showView('editor');
  showToast('Document dupliqué — pensez à enregistrer');
}

function updateInvoiceStatus(invoiceId, status) {
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;
  inv.status = status;
  inv.dateModified = new Date().toISOString();
  saveState();
  renderHistory();
  showToast('Statut mis à jour');
}

function deleteInvoice(invoiceId) {
  if (!confirm('Supprimer ce document ?')) return;
  state.invoices = state.invoices.filter((i) => i.id !== invoiceId);
  saveState();
  renderHistory();
  showToast('Document supprimé');
}

// ============================================
// DOC TYPE CHANGE
// ============================================
function handleDocTypeChange() {
  const type = document.getElementById('doc-type').value;
  if (!editingInvoiceId) {
    document.getElementById('doc-number').value = generateInvoiceNumber(type);
  }
}

// ============================================
// DATE CHANGE
// ============================================
function handleDateChange() {
  const date = document.getElementById('doc-date').value;
  if (date && !editingInvoiceId) {
    document.getElementById('doc-due-date').value = addDays(
      date,
      state.settings.defaultPaymentDelay
    );
  }
}

// ============================================
// IMPORT / EXPORT
// ============================================
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

      saveState();
      loadSettingsForm();
      populateClientSelect();
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

// ============================================
// EDIT NUMBER
// ============================================
function toggleEditNumber() {
  const input = document.getElementById('doc-number');
  const btn = document.getElementById('btn-edit-number');
  const isReadonly = input.hasAttribute('readonly');

  if (isReadonly) {
    input.removeAttribute('readonly');
    input.focus();
    input.select();
    btn.classList.add('editing');
    btn.title = 'Valider le numéro';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
  } else {
    input.setAttribute('readonly', '');
    btn.classList.remove('editing');
    btn.title = 'Modifier le numéro';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
  }
}

// ============================================
// INITIALIZATION
// ============================================
function init() {
  loadState();
  loadSettingsForm();
  populateClientSelect();

  // Navigation
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  // Settings form
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('s-logo').addEventListener('change', handleLogoUpload);
  document.getElementById('btn-remove-logo').addEventListener('click', removeLogo);

  // Import / Export
  document.getElementById('btn-export-data').addEventListener('click', exportData);
  document.getElementById('btn-import-data').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', importData);

  // Client
  document.getElementById('client-select').addEventListener('change', (e) => {
    if (e.target.value) loadClientIntoForm(e.target.value);
  });
  document.getElementById('btn-save-client').addEventListener('click', saveClientFromForm);

  // Doc type & date
  document.getElementById('doc-type').addEventListener('change', handleDocTypeChange);
  document.getElementById('doc-date').addEventListener('change', handleDateChange);

  // Edit invoice number
  document.getElementById('btn-edit-number').addEventListener('click', toggleEditNumber);

  // Line items
  document.getElementById('btn-add-line').addEventListener('click', addLineItem);
  document.getElementById('line-items-container').addEventListener('input', handleLineItemChange);
  document.getElementById('line-items-container').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.btn-remove-line');
    if (removeBtn) {
      removeLineItem(parseInt(removeBtn.dataset.index));
    }
  });

  // Actions
  document.getElementById('btn-save-draft').addEventListener('click', () => saveInvoice('draft'));
  document.getElementById('btn-preview').addEventListener('click', showPreview);
  document.getElementById('btn-download').addEventListener('click', () => {
    saveInvoice('draft');
    downloadPDF();
  });

  // Modal
  document.getElementById('modal-close').addEventListener('click', closePreview);
  document.getElementById('modal-download').addEventListener('click', () => {
    closePreview();
    saveInvoice('draft');
    downloadPDF();
  });
  document.querySelector('.modal-overlay').addEventListener('click', closePreview);

  // History search & filter
  document.getElementById('history-search').addEventListener('input', renderHistory);
  document.getElementById('history-filter').addEventListener('change', renderHistory);

  // First-run banner
  if (!state.settings.companyName) {
    document.getElementById('first-run-banner').style.display = '';
    document.getElementById('btn-go-settings').addEventListener('click', () => {
      document.getElementById('first-run-banner').style.display = 'none';
      showView('settings');
    });
    document.getElementById('btn-dismiss-banner').addEventListener('click', () => {
      document.getElementById('first-run-banner').style.display = 'none';
    });
  }

  // Init editor
  resetInvoiceForm();
}

document.addEventListener('DOMContentLoaded', init);
