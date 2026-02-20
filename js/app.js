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

  // Settings form — auto-save on every change
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('settings-form').addEventListener('input', autoSaveSettings);
  document.getElementById('settings-form').addEventListener('change', autoSaveSettings);
  document.getElementById('s-logo').addEventListener('change', handleLogoUpload);
  document.getElementById('btn-remove-logo').addEventListener('click', removeLogo);
  document.getElementById('s-tva-exempt').addEventListener('change', () => {
    updateTvaExemptUI();
    autoSaveSettings();
  });

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
