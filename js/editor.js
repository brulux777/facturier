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
  state.counters[counterKey]++;
  saveState();
  const num = String(state.counters[counterKey]).padStart(3, '0');
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
        <textarea rows="2" placeholder="Description" data-field="description">${escapeHTML(item.description)}</textarea>
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

// --- Calculations ---

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
}
