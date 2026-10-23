/* ============================================
   SIGNATURE DE DOCUMENTS
   --------------------------------------------
   - Liste des documents signés (re-téléchargeables)
   - Assistant : upload PDF → infos → entreprise
     signataire → signataires (profils) → placement
     visuel (clic sur l'aperçu) → signature
   - Profils de signataires (nom en police manuscrite
     ou dessin enregistré) et profils d'entreprises
   - Aperçu : pdf.js (CDN) — signature : pdf-lib (CDN)
   - Stockage : serveur → table signed_docs (API
     dédiée, binaire) ; local → localStorage dédié
   ============================================ */

const SIGNED_DOCS_KEY = 'facturier_signed_docs';
const SIG_MAX_PDF_BYTES = 8 * 1024 * 1024; // PDF source : 8 Mo max
const SIG_MAX_RENDER_PAGES = 50;

const SIG_FONTS = [
  { family: 'Caveat', label: 'Caveat' },
  { family: 'Dancing Script', label: 'Dancing Script' },
  { family: 'Great Vibes', label: 'Great Vibes' },
  { family: 'Parisienne', label: 'Parisienne' },
];

const SIG_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2'];

let signedDocsCache = null; // métadonnées des documents signés
let sigWizard = null;       // état de l'assistant de création
const sigImgCache = {};     // images de signature (dataUrl) par profil

// ---------- helpers ----------

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = url;
  });
}

// Rognage d'un canvas sur ses pixels visibles (signature dessinée / texte)
function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return out;
}

function triggerPdfDownload(fileName, bytes) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'document-signe.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- stockage des documents signés ----------

async function loadSignedDocs(force) {
  if (!force && signedDocsCache) return signedDocsCache;
  if (typeof SERVER_MODE !== 'undefined' && SERVER_MODE) {
    const r = await fetch('/api/signed-docs', { credentials: 'same-origin' });
    if (r.status === 401) {
      redirectToLogin();
      throw new Error('redirect-login');
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    signedDocsCache = j.docs || [];
  } else {
    try {
      signedDocsCache = JSON.parse(localStorage.getItem(SIGNED_DOCS_KEY) || '[]');
    } catch (e) {
      signedDocsCache = [];
    }
  }
  return signedDocsCache;
}

async function saveSignedDoc(meta, pdfBytes) {
  const b64 = bytesToBase64(pdfBytes);
  if (typeof SERVER_MODE !== 'undefined' && SERVER_MODE) {
    const r = await fetch('/api/signed-docs', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: meta.id, data: meta, pdfBase64: b64 }),
    });
    if (r.status === 401) {
      redirectToLogin();
      return false;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.error || 'Enregistrement impossible', 'error');
      return false;
    }
    signedDocsCache = null;
    return true;
  }
  try {
    const arr = JSON.parse(localStorage.getItem(SIGNED_DOCS_KEY) || '[]');
    arr.unshift(Object.assign({}, meta, { pdfBase64: b64 }));
    localStorage.setItem(SIGNED_DOCS_KEY, JSON.stringify(arr));
    signedDocsCache = null;
    return true;
  } catch (e) {
    console.error('Sauvegarde locale impossible:', e);
    return false;
  }
}

async function downloadSignedDoc(docId) {
  try {
    const docs = await loadSignedDocs(false);
    const doc = docs.find((d) => d.id === docId);
    const fileName = (doc && doc.fileName) || 'document-signe.pdf';
    if (typeof SERVER_MODE !== 'undefined' && SERVER_MODE) {
      const r = await fetch('/api/signed-docs/' + docId + '/pdf', { credentials: 'same-origin' });
      if (r.status === 401) return redirectToLogin();
      if (!r.ok) throw new Error('HTTP ' + r.status);
      triggerPdfDownload(fileName, new Uint8Array(await r.arrayBuffer()));
    } else {
      if (!doc || !doc.pdfBase64) throw new Error('PDF absent');
      triggerPdfDownload(fileName, base64ToBytes(doc.pdfBase64));
    }
  } catch (e) {
    console.error(e);
    showToast('Téléchargement impossible', 'error');
  }
}

async function deleteSignedDoc(docId) {
  if (!confirm('Supprimer ce document signé ? Le PDF sera perdu.')) return;
  try {
    if (typeof SERVER_MODE !== 'undefined' && SERVER_MODE) {
      const r = await fetch('/api/signed-docs/' + docId, { method: 'DELETE', credentials: 'same-origin' });
      if (r.status === 401) return redirectToLogin();
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } else {
      const arr = JSON.parse(localStorage.getItem(SIGNED_DOCS_KEY) || '[]')
        .filter((d) => d.id !== docId);
      localStorage.setItem(SIGNED_DOCS_KEY, JSON.stringify(arr));
    }
    signedDocsCache = null;
    renderSignaturesList(true);
    showToast('Document supprimé');
  } catch (e) {
    console.error(e);
    showToast('Suppression impossible', 'error');
  }
}

// ---------- liste des documents signés ----------

async function renderSignaturesList(force) {
  const container = document.getElementById('signed-docs-list');
  if (!container) return;
  container.innerHTML = '<p class="empty-state">Chargement…</p>';

  let docs;
  try {
    docs = await loadSignedDocs(!!force);
  } catch (e) {
    if (e.message === 'redirect-login') return;
    container.innerHTML = '<p class="empty-state">Impossible de charger les documents signés.</p>';
    return;
  }

  const q = (document.getElementById('sig-search').value || '').toLowerCase();
  if (q) {
    docs = docs.filter((d) =>
      (d.title || '').toLowerCase().includes(q) ||
      (d.docType || '').toLowerCase().includes(q) ||
      (d.originalName || '').toLowerCase().includes(q) ||
      ((d.company && d.company.name) || '').toLowerCase().includes(q) ||
      (d.signers || []).some((s) => (s.name || '').toLowerCase().includes(q))
    );
  }

  if (!docs.length) {
    container.innerHTML = '<p class="empty-state">Aucun document signé pour le moment.</p>';
    return;
  }

  container.innerHTML = docs.map((d) => {
    const dateStr = (d.createdAt || '').slice(0, 10) || d.date || '';
    const signers = (d.signers || []).map((s) => escapeHTML(s.name)).join(', ');
    return `
      <div class="signed-doc-item">
        <div class="signed-doc-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
        </div>
        <div class="signed-doc-info">
          <div class="signed-doc-title">
            ${escapeHTML(d.title || 'Document sans titre')}
            <span class="badge badge-sig">${escapeHTML(d.docType || 'Document')}</span>
          </div>
          <div class="signed-doc-meta">
            Signé le ${formatDate(dateStr)}
            ${d.company && d.company.name ? ' · ' + escapeHTML(d.company.name) : ''}
            ${signers ? ' · ' + signers : ''}
          </div>
          ${d.description ? `<div class="signed-doc-desc">${escapeHTML(d.description)}</div>` : ''}
        </div>
        <div class="signed-doc-actions">
          <button class="btn btn-outline btn-sm" onclick="downloadSignedDoc('${d.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Télécharger
          </button>
          <button class="btn btn-ghost" onclick="deleteSignedDoc('${d.id}')" title="Supprimer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

// ---------- assistant de signature ----------

function newWizardState() {
  return {
    fileName: '',
    pdfBytes: null,   // copie maître pour pdf-lib
    pdfjsDoc: null,
    pageCount: 0,
    pageSizes: [],    // tailles en points PDF (scale 1)
    title: '',
    docType: 'Contrat',
    description: '',
    date: todayISO(),
    companyId: '',    // '' = entreprise des paramètres
    signers: [],      // ids de profils sélectionnés
    activeSigner: null,
    placements: [],   // {id, profileId, page, xPct, yPct, wPct}
    blocks: {},       // PNG de bloc par profileId (avec clé d'invalidation)
    busy: false,
  };
}

function startSignatureWizard() {
  showView('signatureNew'); // le hook showView appelle prepareSignatureWizard()
}

function prepareSignatureWizard() {
  sigWizard = newWizardState();
  const $ = (id) => document.getElementById(id);

  $('sig-file-input').value = '';
  $('sig-file-info').hidden = true;
  $('sig-dropzone').style.display = '';
  $('sig-title').value = '';
  $('sig-type').value = 'Contrat';
  $('sig-description').value = '';
  $('sig-date').value = todayISO();
  $('sig-pages').innerHTML = '';
  $('sig-pages-empty').style.display = '';

  populateWizardCompanies();
  renderWizardSigners();
  updateSignButtonState();
}

function populateWizardCompanies() {
  const select = document.getElementById('sig-company-select');
  const s = state.settings;
  const companies = state.companies || [];

  let html = '';
  if (s.companyName) {
    html += `<option value="">${escapeHTML(s.companyName)} (paramètres)</option>`;
  } else {
    html += '<option value="">— Entreprise des paramètres (non renseignée) —</option>';
  }
  companies.forEach((c) => {
    html += `<option value="${c.id}">${escapeHTML(c.name)}</option>`;
  });
  select.innerHTML = html;
  if (sigWizard) sigWizard.companyId = '';
}

function currentSigCompanySnapshot() {
  if (sigWizard && sigWizard.companyId) {
    const c = (state.companies || []).find((x) => x.id === sigWizard.companyId);
    if (c) {
      return {
        name: c.name || '',
        siret: c.siret || '',
        city: c.city || '',
        address: c.address || '',
        postalCode: c.postalCode || '',
      };
    }
  }
  const s = state.settings;
  return {
    name: s.companyName || '',
    siret: s.siret || '',
    city: s.city || '',
    address: s.address || '',
    postalCode: s.postalCode || '',
  };
}

function signerColorIdx(profileId) {
  const i = sigWizard ? sigWizard.signers.indexOf(profileId) : -1;
  return i < 0 ? 0 : i;
}

// --- puces de signataires (sélection + signataire actif) ---

function renderWizardSigners() {
  const box = document.getElementById('sig-signers-chips');
  const profiles = state.signatureProfiles || [];
  if (!profiles.length) {
    box.innerHTML = `<span class="sig-chips-empty">
      Aucun signataire enregistré —
      <button type="button" class="btn-link" id="btn-chips-add-signer">créer un profil de signature</button>
    </span>`;
    const addBtn = document.getElementById('btn-chips-add-signer');
    if (addBtn) addBtn.addEventListener('click', () => showView('profiles'));
    return;
  }
  box.innerHTML = profiles.map((p) => {
    const selected = sigWizard.signers.includes(p.id);
    const active = sigWizard.activeSigner === p.id;
    const color = SIG_COLORS[signerColorIdx(p.id) % SIG_COLORS.length];
    return `
      <button type="button"
              class="signer-chip${selected ? ' selected' : ''}${active ? ' active' : ''}"
              data-profile="${p.id}"
              style="--sig-c: ${color}"
              title="${active ? 'Cliquer pour retirer ce signataire' : selected ? 'Cliquer pour rendre actif, puis cliquer sur le document' : 'Cliquer pour ajouter ce signataire'}">
        <span class="signer-chip-name">${escapeHTML(p.name)}</span>
        ${p.role ? `<span class="signer-chip-role">${escapeHTML(p.role)}</span>` : ''}
      </button>`;
  }).join('');

  box.querySelectorAll('.signer-chip').forEach((chip) => {
    chip.addEventListener('click', () => toggleWizardSigner(chip.dataset.profile));
  });
}

function toggleWizardSigner(profileId) {
  const idx = sigWizard.signers.indexOf(profileId);
  if (idx === -1) {
    sigWizard.signers.push(profileId);
    sigWizard.activeSigner = profileId;
  } else if (sigWizard.activeSigner === profileId) {
    // 2e clic sur la puce active : retrait du signataire (+ ses placements)
    sigWizard.signers.splice(idx, 1);
    sigWizard.placements = sigWizard.placements.filter((p) => p.profileId !== profileId);
    sigWizard.activeSigner = sigWizard.signers.length ? sigWizard.signers[sigWizard.signers.length - 1] : null;
  } else {
    sigWizard.activeSigner = profileId;
  }
  renderWizardSigners();
  refreshSigBlocks();
  renderSigPlacements();
  updateSignButtonState();
}

// --- upload & rendu du PDF (pdf.js) ---

async function loadSigPdfFile(file) {
  if (!file) return;
  if (typeof pdfjsLib === 'undefined') {
    showToast('Module PDF indisponible (CDN injoignable) — vérifiez la connexion', 'error');
    return;
  }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showToast('Seuls les fichiers PDF sont acceptés', 'error');
    return;
  }
  if (file.size > SIG_MAX_PDF_BYTES) {
    showToast('PDF trop volumineux (8 Mo maximum)', 'error');
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    sigWizard.pdfBytes = new Uint8Array(buf.slice(0));
    // pdf.js détache le buffer transmis : on lui donne une copie
    sigWizard.pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(sigWizard.pdfBytes) }).promise;
    sigWizard.pageCount = sigWizard.pdfjsDoc.numPages;
    sigWizard.fileName = file.name;
    if (!sigWizard.title) {
      sigWizard.title = file.name.replace(/\.pdf$/i, '');
      document.getElementById('sig-title').value = sigWizard.title;
    }

    const info = document.getElementById('sig-file-info');
    document.getElementById('sig-file-name').textContent = file.name;
    document.getElementById('sig-file-meta').textContent =
      `${(file.size / 1024 / 1024).toFixed(2)} Mo · ${sigWizard.pageCount} page${sigWizard.pageCount > 1 ? 's' : ''}`;
    info.hidden = false;
    document.getElementById('sig-dropzone').style.display = 'none';

    await renderWizardPdfPages();
    refreshSigBlocks();
    updateSignButtonState();
    showToast('PDF chargé');
  } catch (e) {
    console.error('Chargement PDF:', e);
    sigWizard.pdfBytes = null;
    sigWizard.pdfjsDoc = null;
    showToast('PDF illisible (protégé ou corrompu)', 'error');
  }
}

async function renderWizardPdfPages() {
  const container = document.getElementById('sig-pages');
  const empty = document.getElementById('sig-pages-empty');
  container.innerHTML = '';
  if (!sigWizard.pdfjsDoc) {
    empty.style.display = '';
    empty.textContent = 'Téléversez d\'abord un PDF.';
    return;
  }
  empty.style.display = 'none';

  const maxPages = Math.min(sigWizard.pageCount, SIG_MAX_RENDER_PAGES);
  for (let n = 1; n <= maxPages; n++) {
    const page = await sigWizard.pdfjsDoc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    sigWizard.pageSizes[n - 1] = { width: vp1.width, height: vp1.height };

    const scale = Math.min(820 / vp1.width, 1.5);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

    const wrap = document.createElement('div');
    wrap.className = 'sig-page';
    wrap.dataset.page = n;
    const label = document.createElement('div');
    label.className = 'sig-page-label';
    label.textContent = 'Page ' + n;
    const overlay = document.createElement('div');
    overlay.className = 'sig-overlay';
    overlay.addEventListener('click', (ev) => placeActiveSigner(n, ev));
    wrap.appendChild(canvas);
    wrap.appendChild(label);
    wrap.appendChild(overlay);
    container.appendChild(wrap);
  }

  if (sigWizard.pageCount > maxPages) {
    const note = document.createElement('p');
    note.className = 'form-hint';
    note.textContent = `Seules les ${maxPages} premières pages sont affichées pour le placement des signatures.`;
    container.appendChild(note);
  }
}

// --- images de signature & blocs (canvas → PNG) ---

async function getSigSignatureImg(profile) {
  if (!profile) return null;
  const key = profile.styleType === 'draw'
    ? profile.id + '|draw'
    : profile.id + '|' + (profile.font || '') + '|' + (profile.name || '');
  if (sigImgCache[key]) return sigImgCache[key];

  let canvas = null;
  if (profile.styleType === 'draw' && profile.drawData) {
    const img = await loadImage(profile.drawData);
    canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
  } else {
    const font = SIG_FONTS.find((f) => f.family === profile.font) || SIG_FONTS[0];
    try {
      await document.fonts.load(`400 120px "${font.family}"`);
    } catch (e) { /* police déjà disponible */ }
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 500;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111827';
    ctx.textBaseline = 'alphabetic';
    const text = profile.name || 'Signature';
    let size = 260;
    ctx.font = `400 ${size}px "${font.family}"`;
    while (ctx.measureText(text).width > 1520 && size > 40) {
      size -= 10;
      ctx.font = `400 ${size}px "${font.family}"`;
    }
    ctx.fillText(text, 24, 330);
    canvas = trimCanvas(c) || c;
  }

  const entry = { url: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
  sigImgCache[key] = entry;
  return entry;
}

// Bloc complet : signature + nom + fonction + entreprise + date
async function buildSigBlockFor(profileId) {
  const profile = (state.signatureProfiles || []).find((p) => p.id === profileId);
  if (!profile) return null;
  const company = currentSigCompanySnapshot();
  const dateStr = sigWizard.date || todayISO();
  const key = [profileId, company.name, company.city, dateStr].join('|');
  const cached = sigWizard.blocks[profileId];
  if (cached && cached.key === key) return cached;

  const sig = await getSigSignatureImg(profile);
  if (!sig) return null;

  const W = 640, pad = 14, lineH = 30;
  const maxSigW = 420, maxSigH = 150;
  const scale = Math.min(maxSigW / sig.w, maxSigH / sig.h, 1.6);
  const sigW = Math.round(sig.w * scale);
  const sigH = Math.round(sig.h * scale);

  let placeLine = '';
  if (company.city) placeLine = `Fait à ${company.city}, le ${formatDate(dateStr)}`;
  else placeLine = `Le ${formatDate(dateStr)}`;

  const lines = [
    { text: profile.name || '', font: '700 24px Inter', color: '#1e293b' },
    { text: profile.role || '', font: '400 19px Inter', color: '#334155' },
    { text: company.name || '', font: 'italic 400 19px Inter', color: '#334155' },
    { text: placeLine, font: '400 17px Inter', color: '#64748b' },
  ].filter((l) => l.text && l.text.trim());

  try { await document.fonts.load('700 24px Inter'); } catch (e) { /* déjà là */ }

  const c = document.createElement('canvas');
  c.width = W;
  c.height = pad + sigH + 14 + lines.length * lineH + pad;
  const ctx = c.getContext('2d');
  ctx.drawImage(await loadImage(sig.url), pad, pad, sigW, sigH);
  let y = pad + sigH + 14 + 21;
  lines.forEach((l) => {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(l.text, pad, y);
    y += lineH;
  });

  const block = { key, dataUrl: c.toDataURL('image/png'), w: W, h: c.height };
  sigWizard.blocks[profileId] = block;
  return block;
}

async function refreshSigBlocks() {
  if (!sigWizard) return;
  for (const id of sigWizard.signers) {
    await buildSigBlockFor(id);
  }
}

// --- placement visuel ---

function placementHeightPct(p) {
  const size = sigWizard.pageSizes[p.page - 1];
  const block = sigWizard.blocks[p.profileId];
  if (!size || !block) return p.wPct * 0.45;
  return p.wPct * (size.width / size.height) * (block.h / block.w);
}

function placeActiveSigner(pageIdx, ev) {
  if (!sigWizard.activeSigner) {
    showToast('Sélectionnez d\'abord un signataire (puces ci-dessus)', 'error');
    return;
  }
  const rect = ev.currentTarget.getBoundingClientRect();
  const size = sigWizard.pageSizes[pageIdx - 1];
  const wPct = 0.24;
  let hPct = 0.1;
  const probe = sigWizard.placements.find((p) => p.profileId === sigWizard.activeSigner);
  if (probe) hPct = placementHeightPct(probe);
  else {
    const block = sigWizard.blocks[sigWizard.activeSigner];
    if (size && block) hPct = wPct * (size.width / size.height) * (block.h / block.w);
  }

  let xPct = (ev.clientX - rect.left) / rect.width - wPct / 2;
  let yPct = (ev.clientY - rect.top) / rect.height - hPct / 2;
  xPct = Math.max(0, Math.min(1 - wPct, xPct));
  yPct = Math.max(0, Math.min(1 - hPct, yPct));

  if (probe) {
    probe.page = pageIdx;
    probe.xPct = xPct;
    probe.yPct = yPct;
  } else {
    sigWizard.placements.push({
      id: generateId(),
      profileId: sigWizard.activeSigner,
      page: pageIdx,
      xPct,
      yPct,
      wPct,
    });
  }
  renderSigPlacements();
  updateSignButtonState();
}

function renderSigPlacements() {
  document.querySelectorAll('#sig-pages .sig-page').forEach((pageEl) => {
    const pageIdx = parseInt(pageEl.dataset.page, 10);
    const overlay = pageEl.querySelector('.sig-overlay');
    overlay.querySelectorAll('.sig-box').forEach((b) => b.remove());

    sigWizard.placements.filter((p) => p.page === pageIdx).forEach((p) => {
      const block = sigWizard.blocks[p.profileId];
      const color = SIG_COLORS[signerColorIdx(p.profileId) % SIG_COLORS.length];

      const box = document.createElement('div');
      box.className = 'sig-box' + (p.profileId === sigWizard.activeSigner ? ' active' : '');
      box.style.setProperty('--sig-c', color);
      box.style.left = (p.xPct * 100) + '%';
      box.style.top = (p.yPct * 100) + '%';
      box.style.width = (p.wPct * 100) + '%';
      box.style.height = (placementHeightPct(p) * 100) + '%';

      if (block) {
        const img = document.createElement('img');
        img.src = block.dataUrl;
        img.alt = 'signature';
        img.draggable = false;
        box.appendChild(img);
      }

      const tools = document.createElement('div');
      tools.className = 'sig-box-tools';
      [
        { label: '−', title: 'Réduire', fn: () => { p.wPct = Math.max(0.08, p.wPct - 0.02); afterPlacementChange(); } },
        { label: '+', title: 'Agrandir', fn: () => { p.wPct = Math.min(0.9, p.wPct + 0.02); afterPlacementChange(); } },
        { label: '×', title: 'Retirer', fn: () => removePlacement(p.id) },
      ].forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        btn.title = b.title;
        btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        btn.addEventListener('click', (ev) => { ev.stopPropagation(); b.fn(); });
        tools.appendChild(btn);
      });
      box.appendChild(tools);

      // Cliquer une boîte rend son signataire actif
      box.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (sigWizard.activeSigner !== p.profileId) {
          sigWizard.activeSigner = p.profileId;
          renderWizardSigners();
          renderSigPlacements();
        }
      });

      enableSigBoxDrag(box, overlay, p);
      overlay.appendChild(box);
    });
  });
}

function afterPlacementChange() {
  renderSigPlacements();
  updateSignButtonState();
}

function removePlacement(placementId) {
  sigWizard.placements = sigWizard.placements.filter((p) => p.id !== placementId);
  renderSigPlacements();
  updateSignButtonState();
}

function enableSigBoxDrag(box, overlay, placement) {
  box.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    box.setPointerCapture(ev.pointerId);
    const rect = overlay.getBoundingClientRect();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const origX = placement.xPct;
    const origY = placement.yPct;

    const onMove = (e) => {
      const wPct = placement.wPct;
      const hPct = placementHeightPct(placement);
      let x = origX + (e.clientX - startX) / rect.width;
      let y = origY + (e.clientY - startY) / rect.height;
      x = Math.max(0, Math.min(1 - wPct, x));
      y = Math.max(0, Math.min(1 - hPct, y));
      placement.xPct = x;
      placement.yPct = y;
      box.style.left = (x * 100) + '%';
      box.style.top = (y * 100) + '%';
    };
    const onUp = () => {
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerup', onUp);
      box.removeEventListener('pointercancel', onUp);
    };
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp);
    box.addEventListener('pointercancel', onUp);
  });
}

function updateSignButtonState() {
  const btn = document.getElementById('btn-sign-doc');
  const hint = document.getElementById('sig-sign-hint');
  if (!btn || !sigWizard) return;

  const missing = sigWizard.signers.filter(
    (id) => !sigWizard.placements.some((p) => p.profileId === id)
  );
  let ready = false;
  let msg = '';
  if (!sigWizard.pdfBytes) {
    msg = 'Téléversez d\'abord le PDF à signer.';
  } else if (!sigWizard.signers.length) {
    msg = 'Sélectionnez au moins un signataire.';
  } else if (missing.length) {
    const names = missing.map((id) => {
      const p = (state.signatureProfiles || []).find((x) => x.id === id);
      return p ? p.name : '?';
    });
    msg = `Placez la signature de : ${names.join(', ')} — cliquez sur le document.`;
  } else {
    ready = true;
    msg = 'Tout est prêt.';
  }
  btn.disabled = !ready || sigWizard.busy;
  btn.innerHTML = sigWizard.busy
    ? 'Signature en cours…'
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg> Signer le document`;
  if (hint) hint.textContent = msg;
}

// --- signature (pdf-lib) ---

async function doSignDocument() {
  if (!sigWizard || sigWizard.busy) return;
  if (!sigWizard.pdfBytes) return;

  sigWizard.busy = true;
  updateSignButtonState();
  try {
    if (typeof PDFLib === 'undefined') {
      throw new Error('module de signature indisponible (CDN injoignable)');
    }
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(sigWizard.pdfBytes, { ignoreEncryption: true });

    const embedded = {};
    for (const p of sigWizard.placements) {
      const block = sigWizard.blocks[p.profileId];
      if (!block) throw new Error('bloc de signature manquant');
      if (!embedded[p.profileId]) {
        embedded[p.profileId] = await pdfDoc.embedPng(base64ToBytes(block.dataUrl.split(',')[1]));
      }
    }

    sigWizard.placements.forEach((p) => {
      const page = pdfDoc.getPage(p.page - 1);
      const { width: PW, height: PH } = page.getSize();
      const img = embedded[p.profileId];
      const w = p.wPct * PW;
      const h = w * (img.height / img.width);
      const x = p.xPct * PW;
      const y = PH - p.yPct * PH - h;
      page.drawImage(img, { x, y, width: w, height: h });
    });

    const out = await pdfDoc.save();
    const company = currentSigCompanySnapshot();
    const base = sigWizard.title.trim() || sigWizard.fileName.replace(/\.pdf$/i, '') || 'Document';
    const meta = {
      id: generateId(),
      title: base,
      docType: sigWizard.docType,
      description: sigWizard.description.trim(),
      date: sigWizard.date,
      createdAt: new Date().toISOString(),
      company: { name: company.name, siret: company.siret, city: company.city },
      signers: sigWizard.placements.map((p) => {
        const pr = (state.signatureProfiles || []).find((x) => x.id === p.profileId) || {};
        return { name: pr.name || '?', role: pr.role || '', page: p.page };
      }),
      fileName: `${base} - signé.pdf`,
      originalName: sigWizard.fileName,
      pageCount: sigWizard.pageCount,
    };

    const saved = await saveSignedDoc(meta, out);
    triggerPdfDownload(meta.fileName, out);
    showToast(saved ? 'Document signé et enregistré' : 'Document signé, mais non sauvegardé (espace insuffisant)');
    showView('signatures');
  } catch (e) {
    console.error('Signature:', e);
    showToast('Signature impossible : ' + (e.message || 'erreur'), 'error');
  } finally {
    sigWizard.busy = false;
    updateSignButtonState();
  }
}

// ---------- profils de signataires ----------

let editingProfileId = null;
let spSelectedFont = SIG_FONTS[0].family;
let spDrawing = false;
let spDrewSomething = false;

function renderProfiles() {
  renderSignersList();
  renderCompaniesList();
}

function renderSignersList() {
  const container = document.getElementById('signers-list');
  if (!container) return;
  const profiles = state.signatureProfiles || [];
  if (!profiles.length) {
    container.innerHTML = '<p class="empty-state">Aucun signataire. Créez un profil pour signer vos documents.</p>';
    return;
  }
  container.innerHTML = profiles.map((p) => `
    <div class="profile-item">
      <div class="profile-sig-preview" data-sp-preview="${p.id}"></div>
      <div class="profile-item-info">
        <div class="profile-item-name">${escapeHTML(p.name)}</div>
        <div class="profile-item-details">
          ${p.role ? escapeHTML(p.role) + ' · ' : ''}
          ${p.styleType === 'draw' ? 'Signature dessinée' : 'Écriture « ' + escapeHTML(p.font || 'Caveat') + ' »'}
        </div>
      </div>
      <div class="profile-item-actions">
        <button class="btn btn-ghost" onclick="openSigProfileModal('${p.id}')" title="Modifier">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <button class="btn btn-ghost" onclick="deleteSigProfile('${p.id}')" title="Supprimer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>`).join('');
  hydrateSigPreviews(container);
}

async function hydrateSigPreviews(container) {
  const nodes = container.querySelectorAll('[data-sp-preview]');
  for (const node of nodes) {
    const profile = (state.signatureProfiles || []).find((p) => p.id === node.dataset.spPreview);
    if (!profile) continue;
    try {
      const sig = await getSigSignatureImg(profile);
      if (sig) node.innerHTML = `<img src="${sig.url}" alt="signature">`;
    } catch (e) { /* aperçu non bloquant */ }
  }
}

function deleteSigProfile(profileId) {
  if (!confirm('Supprimer ce signataire ?')) return;
  state.signatureProfiles = (state.signatureProfiles || []).filter((p) => p.id !== profileId);
  saveState();
  renderSignersList();
  if (sigWizard) {
    sigWizard.signers = sigWizard.signers.filter((id) => id !== profileId);
    sigWizard.placements = sigWizard.placements.filter((p) => p.profileId !== profileId);
    if (sigWizard.activeSigner === profileId) {
      sigWizard.activeSigner = sigWizard.signers[0] || null;
    }
    renderWizardSigners();
    renderSigPlacements();
    updateSignButtonState();
  }
  showToast('Signataire supprimé');
}

function openSigProfileModal(profileId) {
  editingProfileId = profileId || null;
  const modal = document.getElementById('sigprofile-modal');
  const title = document.getElementById('sp-title');
  const nameEl = document.getElementById('sp-name');
  const roleEl = document.getElementById('sp-role');
  const canvas = document.getElementById('sp-draw-canvas');

  const profile = profileId ? (state.signatureProfiles || []).find((p) => p.id === profileId) : null;
  title.textContent = profile ? 'Modifier le signataire' : 'Nouveau signataire';
  nameEl.value = profile ? profile.name : '';
  roleEl.value = profile ? (profile.role || '') : '';
  spSelectedFont = (profile && profile.font) || SIG_FONTS[0].family;

  const styleType = (profile && profile.styleType) || 'font';
  document.querySelector('input[name="sp-style"][value="font"]').checked = styleType === 'font';
  document.querySelector('input[name="sp-style"][value="draw"]').checked = styleType === 'draw';

  resetSpDrawCanvas();
  if (profile && profile.styleType === 'draw' && profile.drawData) {
    loadImage(profile.drawData).then((img) => {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      spDrewSomething = true;
    }).catch(() => { /* dessin illisible : canvas vierge */ });
  }

  renderSpFontChoices();
  updateSpPanes();
  updateSpPreview();
  modal.classList.add('active');
  setTimeout(() => nameEl.focus(), 50);
}

function closeSigProfileModal() {
  document.getElementById('sigprofile-modal').classList.remove('active');
  editingProfileId = null;
}

function renderSpFontChoices() {
  const box = document.getElementById('sp-font-choices');
  box.innerHTML = SIG_FONTS.map((f) => `
    <button type="button" class="sp-font-option${f.family === spSelectedFont ? ' active' : ''}"
            data-font="${f.family}" style="font-family: '${f.family}', cursive;">
      ${escapeHTML(f.label)}
    </button>`).join('');
  box.querySelectorAll('.sp-font-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      spSelectedFont = btn.dataset.font;
      renderSpFontChoices();
      updateSpPreview();
    });
  });
}

function updateSpPanes() {
  const styleType = document.querySelector('input[name="sp-style"]:checked').value;
  document.getElementById('sp-font-pane').hidden = styleType !== 'font';
  document.getElementById('sp-draw-pane').hidden = styleType !== 'draw';
}

function updateSpPreview() {
  const preview = document.getElementById('sp-name-preview');
  const name = document.getElementById('sp-name').value.trim() || 'Prénom Nom';
  preview.textContent = name;
  preview.style.fontFamily = `'${spSelectedFont}', cursive`;
}

function resetSpDrawCanvas() {
  const canvas = document.getElementById('sp-draw-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  spDrewSomething = false;
}

function spCanvasInit() {
  const canvas = document.getElementById('sp-draw-canvas');
  canvas.width = 1000;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';

  const pos = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (canvas.width / rect.width),
      y: (ev.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    spDrawing = true;
    spDrewSomething = true;
    const p = pos(ev);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!spDrawing) return;
    const p = pos(ev);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const stop = () => { spDrawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
}

function submitSigProfile(e) {
  e.preventDefault();
  const name = document.getElementById('sp-name').value.trim();
  const role = document.getElementById('sp-role').value.trim();
  const styleType = document.querySelector('input[name="sp-style"]:checked').value;

  let drawData = null;
  if (styleType === 'draw') {
    const canvas = document.getElementById('sp-draw-canvas');
    const trimmed = spDrewSomething ? trimCanvas(canvas) : null;
    if (!trimmed) {
      showToast('Dessinez votre signature dans la zone prévue', 'error');
      return;
    }
    drawData = trimmed.toDataURL('image/png');
  }

  const existing = editingProfileId
    ? (state.signatureProfiles || []).find((p) => p.id === editingProfileId)
    : null;

  if (existing) {
    existing.name = name;
    existing.role = role;
    existing.styleType = styleType;
    existing.font = styleType === 'font' ? spSelectedFont : null;
    existing.drawData = drawData;
    showToast('Signataire mis à jour');
  } else {
    state.signatureProfiles.push({
      id: generateId(),
      name,
      role,
      styleType,
      font: styleType === 'font' ? spSelectedFont : null,
      drawData,
    });
    showToast('Signataire enregistré');
  }

  saveState();
  // invalide les images de signature en cache pour ce profil modifié
  if (existing) {
    Object.keys(sigImgCache)
      .filter((k) => k.startsWith(existing.id + '|'))
      .forEach((k) => { delete sigImgCache[k]; });
  }
  closeSigProfileModal();
  renderSignersList();
  if (sigWizard) {
    // rafraîchit les puces (et invalide les caches d'images du profil modifié)
    renderWizardSigners();
    refreshSigBlocks().then(() => {
      renderSigPlacements();
      updateSignButtonState();
    });
  }
}

// ---------- entreprises ----------

let editingCompanyId = null;

function renderCompaniesList() {
  const container = document.getElementById('companies-list');
  if (!container) return;
  const companies = state.companies || [];

  const importBtn = document.getElementById('btn-import-settings-company');
  if (importBtn) {
    const already = state.settings.companyName &&
      companies.some((c) => c.name.toLowerCase() === state.settings.companyName.toLowerCase());
    importBtn.style.display = (!state.settings.companyName || already) ? 'none' : '';
  }

  if (!companies.length) {
    container.innerHTML = '<p class="empty-state">Aucune entreprise. Utilisez celle des paramètres ou ajoutez vos sociétés ici.</p>';
    return;
  }
  container.innerHTML = companies.map((c) => `
    <div class="profile-item">
      <div class="company-item-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
      </div>
      <div class="profile-item-info">
        <div class="profile-item-name">${escapeHTML(c.name)}</div>
        <div class="profile-item-details">
          ${[c.address, [c.postalCode, c.city].filter(Boolean).join(' '), c.siret ? 'SIRET ' + c.siret : '']
            .filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
      <div class="profile-item-actions">
        <button class="btn btn-ghost" onclick="openCompanyModal('${c.id}')" title="Modifier">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <button class="btn btn-ghost" onclick="deleteCompany('${c.id}')" title="Supprimer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>`).join('');
}

function openCompanyModal(companyId) {
  editingCompanyId = companyId || null;
  const modal = document.getElementById('company-modal');
  const c = companyId ? (state.companies || []).find((x) => x.id === companyId) : null;
  document.getElementById('cy-title').textContent = c ? "Modifier l'entreprise" : 'Nouvelle entreprise';
  document.getElementById('cy-name').value = c ? c.name : '';
  document.getElementById('cy-siret').value = c ? (c.siret || '') : '';
  document.getElementById('cy-address').value = c ? (c.address || '') : '';
  document.getElementById('cy-postal').value = c ? (c.postalCode || '') : '';
  document.getElementById('cy-city').value = c ? (c.city || '') : '';
  modal.classList.add('active');
  setTimeout(() => document.getElementById('cy-name').focus(), 50);
}

function closeCompanyModal() {
  document.getElementById('company-modal').classList.remove('active');
  editingCompanyId = null;
}

function submitCompany(e) {
  e.preventDefault();
  const name = document.getElementById('cy-name').value.trim();
  if (!name) return;
  const data = {
    name,
    siret: document.getElementById('cy-siret').value.trim(),
    address: document.getElementById('cy-address').value.trim(),
    postalCode: document.getElementById('cy-postal').value.trim(),
    city: document.getElementById('cy-city').value.trim(),
  };
  const existing = editingCompanyId
    ? (state.companies || []).find((c) => c.id === editingCompanyId)
    : null;
  if (existing) {
    Object.assign(existing, data);
    showToast('Entreprise mise à jour');
  } else {
    state.companies.push(Object.assign({ id: generateId() }, data));
    showToast('Entreprise enregistrée');
  }
  saveState();
  closeCompanyModal();
  renderCompaniesList();
}

function deleteCompany(companyId) {
  if (!confirm('Supprimer cette entreprise ?')) return;
  state.companies = (state.companies || []).filter((c) => c.id !== companyId);
  if (sigWizard && sigWizard.companyId === companyId) sigWizard.companyId = '';
  saveState();
  renderCompaniesList();
  showToast('Entreprise supprimée');
}

function importSettingsCompany() {
  const s = state.settings;
  if (!s.companyName) return;
  if ((state.companies || []).some((c) => c.name.toLowerCase() === s.companyName.toLowerCase())) {
    showToast('Cette entreprise existe déjà', 'error');
    return;
  }
  state.companies.push({
    id: generateId(),
    name: s.companyName,
    siret: s.siret || '',
    address: s.address || '',
    postalCode: s.postalCode || '',
    city: s.city || '',
  });
  saveState();
  renderCompaniesList();
  showToast('Entreprise importée depuis les paramètres');
}

// ---------- initialisation ----------

let sigInitialized = false;

function initSignatures() {
  if (sigInitialized) return;
  sigInitialized = true;

  sigWizard = newWizardState();

  // pdf.js : worker dédié (même version que la lib)
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const $ = (id) => document.getElementById(id);

  // Liste
  $('btn-new-signed-doc').addEventListener('click', startSignatureWizard);
  $('sig-search').addEventListener('input', () => renderSignaturesList(false));

  // Assistant : upload
  const dropzone = $('sig-dropzone');
  const fileInput = $('sig-file-input');
  $('btn-choose-sig-pdf').addEventListener('click', () => fileInput.click());
  $('btn-change-sig-pdf').addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#btn-choose-sig-pdf')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', (e) => loadSigPdfFile(e.target.files[0]));
  ['dragover', 'dragenter'].forEach((evt) => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    loadSigPdfFile(file);
  });

  // Assistant : infos document
  $('sig-title').addEventListener('input', (e) => { sigWizard.title = e.target.value; });
  $('sig-type').addEventListener('change', (e) => { sigWizard.docType = e.target.value; });
  $('sig-description').addEventListener('input', (e) => { sigWizard.description = e.target.value; });
  $('sig-date').addEventListener('change', async (e) => {
    sigWizard.date = e.target.value || todayISO();
    await refreshSigBlocks();
    renderSigPlacements();
  });
  $('sig-company-select').addEventListener('change', async (e) => {
    sigWizard.companyId = e.target.value;
    await refreshSigBlocks();
    renderSigPlacements();
  });
  $('btn-manage-companies').addEventListener('click', () => showView('profiles'));
  $('btn-manage-signers').addEventListener('click', () => showView('profiles'));

  // Assistant : signature
  $('btn-sign-doc').addEventListener('click', doSignDocument);
  $('btn-sig-cancel').addEventListener('click', () => showView('signatures'));

  // Profils : signataires
  $('btn-new-signer').addEventListener('click', () => openSigProfileModal(null));
  $('sp-close').addEventListener('click', closeSigProfileModal);
  document.querySelector('#sigprofile-modal .modal-overlay').addEventListener('click', closeSigProfileModal);
  $('sp-form').addEventListener('submit', submitSigProfile);
  $('sp-name').addEventListener('input', updateSpPreview);
  document.querySelectorAll('input[name="sp-style"]').forEach((radio) => {
    radio.addEventListener('change', updateSpPanes);
  });
  $('btn-sp-clear').addEventListener('click', resetSpDrawCanvas);
  spCanvasInit();

  // Profils : entreprises
  $('btn-new-company').addEventListener('click', () => openCompanyModal(null));
  $('btn-import-settings-company').addEventListener('click', importSettingsCompany);
  $('cy-close').addEventListener('click', closeCompanyModal);
  document.querySelector('#company-modal .modal-overlay').addEventListener('click', closeCompanyModal);
  $('cy-form').addEventListener('submit', submitCompany);
}
