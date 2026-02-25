/* ============================================
   HISTORY
   ============================================ */
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
        (i.title || '').toLowerCase().includes(search) ||
        i.client.name.toLowerCase().includes(search)
    );
  }

  if (invoices.length === 0) {
    container.innerHTML = '<p class="empty-state">Aucun document trouv\u00e9.</p>';
    return;
  }

  const rows = invoices
    .map((inv) => {
      const typeBadge =
        inv.type === 'invoice'
          ? '<span class="badge badge-invoice">Facture</span>'
          : '<span class="badge badge-quote">Devis</span>';

      const statusOptions = [
        { value: 'draft', label: 'Brouillon' },
        { value: 'sent', label: 'Envoy\u00e9e' },
        { value: 'paid', label: 'Pay\u00e9e' },
      ];
      const statusSelect = `<select class="status-select status-${inv.status}" onchange="updateInvoiceStatus('${inv.id}', this.value)">
        ${statusOptions.map(o => `<option value="${o.value}"${o.value === inv.status ? ' selected' : ''}>${o.label}</option>`).join('')}
      </select>`;

      return `
        <tr>
          <td>${escapeHTML(inv.number)}</td>
          <td>${typeBadge}</td>
          <td>${formatDate(inv.date)}</td>
          <td>${inv.title ? `<div class="history-title">${escapeHTML(inv.title)}</div>` : ''}${escapeHTML(inv.client.name)}</td>
          <td class="cell-amount">${formatCurrency(inv.totals.totalTTC)}</td>
          <td>${statusSelect}</td>
          <td class="cell-actions">
            <button class="btn btn-ghost" onclick="loadInvoiceIntoForm('${inv.id}')" title="Modifier">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="btn btn-ghost" onclick="duplicateInvoice('${inv.id}')" title="Dupliquer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="btn btn-ghost" onclick="deleteInvoice('${inv.id}')" title="Supprimer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>N\u00b0</th>
          <th>Type</th>
          <th>Date</th>
          <th>Titre / Client</th>
          <th>Montant TTC</th>
          <th>Statut</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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

  document.getElementById('doc-title').value = inv.title || '';
  document.getElementById('doc-notes').value = inv.notes || '';

  currentLineItems = inv.items.map((item) => ({ ...item, id: generateId() }));
  renderLineItems();

  document.querySelector('.view-header h2').textContent = 'Nouveau document (copie)';
  showView('editor');
  showToast('Document dupliqu\u00e9 \u2014 pensez \u00e0 enregistrer');
}

function updateInvoiceStatus(invoiceId, status) {
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;
  inv.status = status;
  inv.dateModified = new Date().toISOString();
  saveState();
  renderHistory();
  showToast('Statut mis \u00e0 jour');
}

function deleteInvoice(invoiceId) {
  if (!confirm('Supprimer ce document ?')) return;
  state.invoices = state.invoices.filter((i) => i.id !== invoiceId);
  saveState();
  renderHistory();
  showToast('Document supprim\u00e9');
}
