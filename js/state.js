/* ============================================
   STATE, PERSISTENCE & HELPERS
   ============================================ */
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
  tvaExempt: false,
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

// --- Helpers ---

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount).replace(/\u202F/g, ' ').replace(/\u00A0/g, ' ');
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

// --- Toast ---

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

// --- Navigation ---

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
