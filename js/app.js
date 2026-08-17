/* ============================================
   INITIALIZATION
   ============================================ */
function init() {
  loadState();
  loadSettingsForm();
  populateClientSelect();

  // Navigation
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  // Settings form — enregistrement explicite via le bouton "Enregistrer"
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('s-logo').addEventListener('change', handleLogoUpload);
  document.getElementById('btn-remove-logo').addEventListener('click', removeLogo);
  document.getElementById('s-tva-exempt').addEventListener('change', updateTvaExemptUI);

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

  // Discount
  document.getElementById('doc-discount').addEventListener('input', calculateTotals);

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

  // Mode de saisie (simple / avancé) + dropzone Markdown
  initAdvancedMode();

  // Actions
  document.getElementById('btn-save-draft').addEventListener('click', () => saveInvoice('draft'));
  document.getElementById('btn-preview').addEventListener('click', showPreview);
  document.getElementById('btn-download').addEventListener('click', () => {
    if (saveInvoice('sent')) downloadPDF();
  });

  // Modal
  document.getElementById('modal-close').addEventListener('click', closePreview);
  document.getElementById('modal-download').addEventListener('click', () => {
    closePreview();
    if (saveInvoice('sent')) downloadPDF();
  });
  document.querySelector('.modal-overlay').addEventListener('click', closePreview);

  // History search & filter
  document.getElementById('history-search').addEventListener('input', renderHistory);
  document.getElementById('history-filter').addEventListener('change', renderHistory);

  // First-run banner (mode local uniquement — jamais en mode serveur)
  if (!SERVER_MODE && !state.settings.companyName) {
    document.getElementById('first-run-banner').style.display = '';
    document.getElementById('btn-go-settings').addEventListener('click', () => {
      document.getElementById('first-run-banner').style.display = 'none';
      showView('settings');
    });
    document.getElementById('btn-dismiss-banner').addEventListener('click', () => {
      document.getElementById('first-run-banner').style.display = 'none';
    });
  }

  // Logout (mode serveur uniquement)
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  // Routing : URL initiale (/parametres, /clients, /historique) + bouton retour
  const initialView = PATH_VIEWS[location.pathname] || 'editor';
  if (initialView !== 'editor') showView(initialView, false);
  window.addEventListener('popstate', () => {
    showView(PATH_VIEWS[location.pathname] || 'editor', false);
  });

  // Init editor
  resetInvoiceForm();
}

document.addEventListener('DOMContentLoaded', async () => {
  await syncBootstrap();
  init();
});
