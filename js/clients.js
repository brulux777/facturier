/* ============================================
   CLIENTS
   ============================================ */
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
