/* ============================================
   SETTINGS
   ============================================ */
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

let settingsDebounceTimer = null;

function autoSaveSettings() {
  clearTimeout(settingsDebounceTimer);
  settingsDebounceTimer = setTimeout(() => {
    syncSettingsFromForm();
  }, 500);
}

function saveSettings(e) {
  e.preventDefault();
  clearTimeout(settingsDebounceTimer);
  syncSettingsFromForm();
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

function syncSettingsFromForm() {
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
}

function exportData() {
  syncSettingsFromForm();
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
