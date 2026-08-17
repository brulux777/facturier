/* ============================================
   INVOICE EDITOR
   ============================================ */
let currentLineItems = [];
let editingInvoiceId = null;

// --- Invoice Number ---

function generateInvoiceNumber(type) {
  const year = new Date().getFullYear();
  const prefix =
    type === 'invoice' ? state.settings.invoicePrefix : state.settings.quotePrefix;
  const counterKey = type === 'invoice' ? 'invoice' : 'quote';
  // Pas de saveState() ici : le compteur n'est persisté qu'à l'enregistrement
  // réel du document (saveInvoice), pas au simple chargement du formulaire.
  const num = String(state.counters[counterKey] + 1).padStart(3, '0');
  return `${prefix}-${year}-${num}`;
}

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

// --- Line Items ---

function createEmptyLine() {
  return {
    id: generateId(),
    title: '',
    description: '',
    quantity: 1,
    unitPrice: 0,
    tvaRate: state.settings.tvaExempt ? 0 : state.settings.defaultTva,
  };
}

function renderLineItems() {
  const container = document.getElementById('line-items-container');
  container.innerHTML = currentLineItems
    .map(
      (item, i) => `
      <div class="line-item" data-index="${i}">
        <div class="li-desc-cell">
          <input type="text" value="${escapeHTML(item.title || '')}" placeholder="Titre (ex : Développement site web)" data-field="title" class="li-title-input">
          <textarea rows="2" placeholder="Description (détail de la prestation)" data-field="description">${escapeHTML(item.description)}</textarea>
        </div>
        <input type="number" value="${item.quantity}" min="0" step="1" data-field="quantity">
        <input type="number" value="${item.unitPrice}" min="0" step="0.01" data-field="unitPrice">
        <input type="number" value="${item.tvaRate}" min="0" max="100" step="0.1" data-field="tvaRate" ${state.settings.tvaExempt ? 'disabled' : ''}>
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

  if (field === 'title') {
    item.title = e.target.value;
  } else if (field === 'description') {
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
    '.line-item:last-child input[data-field="title"]'
  );
  if (lastInput) lastInput.focus();
}

// --- Onglets Prestations / Cahier des charges ---
// Les deux panneaux font partie du même document : la bascule ne
// masque rien de façon destructive, tout est conservé et enregistré.

function switchPrestationsTab(tab) {
  const isItems = tab !== 'cdc'; // 'items' par défaut
  document
    .querySelectorAll('#prestations-tabs .tab-btn')
    .forEach((b) => b.classList.toggle('active', (b.dataset.tab === 'cdc') !== isItems));
  document.getElementById('pane-items').hidden = !isItems;
  document.getElementById('pane-cdc').hidden = isItems;
}

function getCahierDesCharges() {
  return document.getElementById('cdc-markdown').value;
}

function resetCahierDesCharges() {
  document.getElementById('cdc-markdown').value = '';
}

function loadMarkdownFile(file) {
  if (file.size > 2 * 1024 * 1024) {
    showToast('Fichier trop volumineux (2 Mo max)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('cdc-markdown').value = String(reader.result || '');
    showToast(`« ${file.name} » chargé`);
  };
  reader.onerror = () => showToast('Impossible de lire le fichier', 'error');
  reader.readAsText(file);
}

function initPrestationsTabs() {
  document.querySelectorAll('#prestations-tabs .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchPrestationsTab(btn.dataset.tab));
  });

  const dropzone = document.getElementById('md-dropzone');
  const fileInput = document.getElementById('md-file-input');
  const chooseBtn = document.getElementById('btn-choose-md');

  const openFileDialog = () => fileInput.click();
  dropzone.addEventListener('click', (e) => {
    if (chooseBtn.contains(e.target)) return; // géré par le bouton lui-même
    openFileDialog();
  });
  chooseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openFileDialog();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) loadMarkdownFile(fileInput.files[0]);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadMarkdownFile(file);
  });
}

// --- Paiement en 3 fois ---

function computeInstallments3x(totalTTC, startDateStr) {
  const total = round2(totalTTC);
  const base = round2(total / 3);
  const last = round2(total - base * 2); // reprise des centimes d'arrondi
  const start = startDateStr || todayISO();
  return [
    { label: '1re \u00e9ch\u00e9ance', date: start, amount: base },
    { label: '2e \u00e9ch\u00e9ance', date: addMonths(start, 1), amount: base },
    { label: '3e \u00e9ch\u00e9ance', date: addMonths(start, 2), amount: last },
  ];
}

// Appelée uniquement depuis updateTotalsDOM (qui fournit les totaux) :
// jamais de calculateTotals() ici (r\u00e9cursion infinie).
function updateInstallmentsUI(t) {
  const box = document.getElementById('installments-preview');
  if (!box) return;
  const enabled = document.getElementById('doc-payment-3x').checked;
  box.hidden = !enabled;
  if (!enabled) return;
  const startDate =
    document.getElementById('doc-due-date').value ||
    document.getElementById('doc-date').value ||
    todayISO();
  box.innerHTML = computeInstallments3x(t.totalTTC, startDate)
    .map(
      (e) => `
      <div class="totals-row">
        <span>${e.label} (${formatDate(e.date)})</span>
        <span>${formatCurrency(e.amount)}</span>
      </div>
    `
    )
    .join('');
}

// --- Calculations ---

function calculateTotals() {
  let totalHTBrut = 0;
  const tvaMap = {};

  currentLineItems.forEach((item) => {
    const lineHT = round2(item.quantity * item.unitPrice);
    totalHTBrut += lineHT;

    const rate = item.tvaRate;
    if (!tvaMap[rate]) tvaMap[rate] = 0;
    tvaMap[rate] += lineHT;
  });

  totalHTBrut = round2(totalHTBrut);

  const discountPercent = parseFloat(document.getElementById('doc-discount').value) || 0;
  const discountAmount = round2(totalHTBrut * discountPercent / 100);
  const totalHT = round2(totalHTBrut - discountAmount);
  const discountFactor = totalHTBrut > 0 ? totalHT / totalHTBrut : 1;

  let totalTVA = 0;
  const tvaBreakdown = [];
  Object.keys(tvaMap)
    .sort((a, b) => parseFloat(a) - parseFloat(b))
    .forEach((rate) => {
      const base = round2(tvaMap[rate] * discountFactor);
      const tva = round2(base * (parseFloat(rate) / 100));
      totalTVA += tva;
      tvaBreakdown.push({ rate: parseFloat(rate), base, tva });
    });

  totalTVA = round2(totalTVA);
  const totalTTC = round2(totalHT + totalTVA);

  const totals = { totalHTBrut, discountPercent, discountAmount, totalHT, totalTVA, totalTTC, tvaBreakdown };
  updateTotalsDOM(totals);
  return totals;
}

function updateTotalsDOM(t) {
  const hasDiscount = t.discountPercent > 0;

  // Mentions HT/TTC toujours pr\u00e9sentes, m\u00eame si TVA non applicable
  // (total HT = total TTC dans ce cas, mention 293 B du CGI en pied).
  document.getElementById('total-ht-brut-label').textContent = hasDiscount ? 'Total HT brut' : 'Total HT';
  document.getElementById('total-ht-brut').textContent = formatCurrency(t.totalHTBrut);
  document.getElementById('discount-row').style.display = hasDiscount ? '' : 'none';
  document.getElementById('total-ht-net-row').style.display = hasDiscount ? '' : 'none';

  if (hasDiscount) {
    document.getElementById('discount-label').textContent = `Remise (${t.discountPercent}%)`;
    document.getElementById('discount-amount').textContent = `- ${formatCurrency(t.discountAmount)}`;
    document.getElementById('total-ht-net-label').textContent = 'Total HT net';
  }

  document.getElementById('total-final-label').textContent = 'Total TTC';
  document.getElementById('total-ht').textContent = formatCurrency(t.totalHT);
  document.getElementById('total-ttc').textContent = formatCurrency(t.totalTTC);

  const breakdownEl = document.getElementById('tva-breakdown');
  breakdownEl.innerHTML = state.settings.tvaExempt
    ? ''
    : t.tvaBreakdown
        .map(
          (b) => `
      <div class="totals-row">
        <span>TVA ${b.rate}% (sur ${formatCurrency(b.base)})</span>
        <span>${formatCurrency(b.tva)}</span>
      </div>
    `
        )
        .join('');

  updateInstallmentsUI(t);
}

// --- Form ---

function resetInvoiceForm() {
  editingInvoiceId = null;

  document.getElementById('doc-type').value = 'invoice';
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

  document.getElementById('doc-title').value = '';
  document.getElementById('doc-notes').value = '';
  document.getElementById('doc-discount').value = '0';
  document.getElementById('doc-payment-3x').checked = !!state.settings.defaultPayment3x;
  document.getElementById('cdc-mode').value = state.settings.defaultCdcMode || 'inline';

  currentLineItems = [createEmptyLine()];
  resetCahierDesCharges();
  switchPrestationsTab('items');
  renderLineItems();

  document.querySelector('.view-header h2').textContent = 'Nouveau document';
}

function loadInvoiceIntoForm(invoiceId) {
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;

  editingInvoiceId = inv.id;

  document.getElementById('doc-type').value = inv.type;
  document.getElementById('doc-number').value = inv.number;
  document.getElementById('doc-title').value = inv.title || '';
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
  document.getElementById('doc-discount').value = inv.discountPercent || 0;
  document.getElementById('doc-payment-3x').checked = !!inv.payment3x;
  document.getElementById('cdc-mode').value = inv.cdcMode || 'inline';

  currentLineItems = (inv.items || []).map((item) => ({ ...item, id: item.id || generateId() }));
  document.getElementById('cdc-markdown').value = inv.cahierDesCharges || '';
  switchPrestationsTab('items');
  renderLineItems();

  document.querySelector('.view-header h2').textContent =
    `Modifier ${inv.type === 'invoice' ? 'facture' : 'devis'} ${inv.number}`;
  showView('editor');
}

function collectInvoiceData() {
  const type = document.getElementById('doc-type').value;
  const number = document.getElementById('doc-number').value;
  const title = document.getElementById('doc-title').value.trim();
  const date = document.getElementById('doc-date').value;
  const dueDate = document.getElementById('doc-due-date').value;
  const notes = document.getElementById('doc-notes').value.trim();
  const clientId = document.getElementById('client-select').value || null;

  const discountPercent = parseFloat(document.getElementById('doc-discount').value) || 0;
  const payment3x = document.getElementById('doc-payment-3x').checked;
  const cdcMode = document.getElementById('cdc-mode').value;

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
    title,
    date,
    dueDate,
    discountPercent,
    payment3x,
    cdcMode,
    client,
    clientId,
    items: currentLineItems.map((item) => ({ ...item })),
    cahierDesCharges: getCahierDesCharges(),
    notes,
    totals,
    settings: { ...state.settings },
  };
}

function validateInvoice(data) {
  // Aucun champ obligatoire : on bloque seulement un document totalement vide
  // (aucun client, aucun titre, aucune ligne, aucun cahier des charges) pour
  // éviter les enregistrements accidentels d'un formulaire jamais rempli.
  const hasAnything =
    (data.client && (data.client.name || data.client.email || data.client.address)) ||
    (data.title && data.title.trim()) ||
    (data.cahierDesCharges && data.cahierDesCharges.trim()) ||
    data.items.some((i) => (i.title && i.title.trim()) || i.description.trim());
  if (!hasAnything) {
    showToast('Document vide — rien à enregistrer', 'error');
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
    // Nouveau document : on incrémente le compteur correspondant ici
    // (et seulement ici — pas au simple chargement du formulaire)
    const counterKey = data.type === 'quote' ? 'quote' : 'invoice';
    state.counters[counterKey] = Math.max(state.counters[counterKey] + 1, 1);
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

// --- Doc type & date handlers ---

function handleDocTypeChange() {
  const type = document.getElementById('doc-type').value;
  if (!editingInvoiceId) {
    document.getElementById('doc-number').value = generateInvoiceNumber(type);
  }
}

function handleDateChange() {
  const date = document.getElementById('doc-date').value;
  if (date && !editingInvoiceId) {
    document.getElementById('doc-due-date').value = addDays(
      date,
      state.settings.defaultPaymentDelay
    );
  }
  calculateTotals(); // rafra\u00eechit l'\u00e9ch\u00e9ancier 3x (dates)
}
