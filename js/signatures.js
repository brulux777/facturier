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

// Polices proposées pour les textes du bloc de signature
// (mention, nom, fonction, entreprise, date)
const SIG_TEXT_FONTS = [
  { family: 'Inter', label: 'Inter (défaut)' },
  { family: 'Georgia', label: 'Georgia (serif)' },
  { family: 'Caveat', label: 'Caveat' },
  { family: 'Dancing Script', label: 'Dancing Script' },
  { family: 'Great Vibes', label: 'Great Vibes' },
  { family: 'Parisienne', label: 'Parisienne' },
];

// Réglages par défaut des textes du bloc (par signataire, dans l'assistant)
const SIG_TEXT_STYLE_DEFAULTS = { scale: 1, color: '#1e293b', font: 'Inter' };

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
      (d.signers || []).some((s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.company || '').toLowerCase().includes(q) ||
        (s.mention || '').toLowerCase().includes(q)
      )
    );
  }

  if (!docs.length) {
    container.innerHTML = '<p class="empty-state">Aucun document signé pour le moment.</p>';
    return;
  }

  container.innerHTML = docs.map((d) => {
    const dateStr = (d.createdAt || '').slice(0, 10) || d.date || '';
    const signers = (d.signers || []).map((s) => {
      const parts = [escapeHTML(s.name || '')];
      if (s.mention) parts.push('« ' + escapeHTML(s.mention) + ' »');
      if (s.company && s.company !== ((d.company && d.company.name) || '')) {
        parts.push(escapeHTML(s.company));
      }
      return parts.join(' · ');
    }).join(', ');
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
    signerMeta: {},   // profileId -> { companyId: ''|id|'__none__', mention: '' }
    activeSigner: null,
    placementMode: 'auto',  // 'auto' = toutes les pages | 'manual' = clic
    autoPosition: 'bottom', // bottom | top | left | right
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

  const autoRadio = document.querySelector('input[name="sig-place-mode"][value="auto"]');
  if (autoRadio) autoRadio.checked = true;
  $('sig-auto-pos').value = 'bottom';
  updateSigPlaceModeUI();

  populateWizardCompanies();
  renderWizardSigners();
  updateSignButtonState();
}

function populateWizardCompanies() {
  const select = document.getElementById('sig-company-select');
  const companies = state.companies || [];
  const def = getDefaultCompany();

  if (!companies.length) {
    select.innerHTML = '<option value="">— Aucune entreprise (page Entreprises) —</option>';
  } else {
    // Entreprise par défaut en tête, les autres ensuite
    const ordered = [...companies].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
    select.innerHTML = ordered
      .map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`)
      .join('');
  }
  if (sigWizard) sigWizard.companyId = def ? def.id : '';
  select.value = def ? def.id : '';
  renderSignersConfig(); // le libellé « Entreprise du document » dépend du choix
}

function currentSigCompanySnapshot() {
  const c = getCompany(sigWizard && sigWizard.companyId) || getDefaultCompany();
  return {
    name: (c && c.name) || '',
    siret: (c && c.siret) || '',
    city: (c && c.city) || '',
    address: (c && c.address) || '',
    postalCode: (c && c.postalCode) || '',
  };
}

function signerColorIdx(profileId) {
  const i = sigWizard ? sigWizard.signers.indexOf(profileId) : -1;
  return i < 0 ? 0 : i;
}

// Entreprise associée à un signataire : la sienne, sinon celle du document
function signerCompanySnapshot(profileId) {
  const meta = (sigWizard && sigWizard.signerMeta[profileId]) || {};
  if (meta.companyId === '__none__') {
    return { name: '', siret: '', city: '', address: '', postalCode: '' };
  }
  if (meta.companyId) {
    const c = getCompany(meta.companyId);
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
  return currentSigCompanySnapshot();
}

function signerMention(profileId) {
  const meta = (sigWizard && sigWizard.signerMeta[profileId]) || {};
  return (meta.mention || '').trim();
}

// Style des textes du bloc (taille, couleur, police).
// Renvoie l'objet vivant de signerMeta pour que les réglages persistent.
function signerTextStyle(profileId) {
  if (!sigWizard) return { ...SIG_TEXT_STYLE_DEFAULTS };
  const meta = sigWizard.signerMeta[profileId]
    || (sigWizard.signerMeta[profileId] = {});
  if (!meta.textStyle) meta.textStyle = { ...SIG_TEXT_STYLE_DEFAULTS };
  Object.keys(SIG_TEXT_STYLE_DEFAULTS).forEach((k) => {
    if (meta.textStyle[k] === undefined) meta.textStyle[k] = SIG_TEXT_STYLE_DEFAULTS[k];
  });
  return meta.textStyle;
}

function sigTextFontStack(family) {
  if (family === 'Georgia') return 'Georgia, "Times New Roman", serif';
  if (family === 'Inter') return 'Inter, sans-serif';
  return `"${family}", Inter, sans-serif`;
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

  renderSignersConfig();
}

// --- config par signataire : entreprise signataire + mention ---

function renderSignersConfig() {
  const box = document.getElementById('sig-signers-config');
  if (!box || !sigWizard) return;
  if (!sigWizard.signers.length) {
    box.innerHTML = '';
    return;
  }

  const docCompany = currentSigCompanySnapshot();
  const companies = state.companies || [];
  box.innerHTML = sigWizard.signers.map((id) => {
    const p = (state.signatureProfiles || []).find((x) => x.id === id);
    if (!p) return '';
    if (!sigWizard.signerMeta[id]) {
      sigWizard.signerMeta[id] = { companyId: '', mention: 'Bon pour accord' };
    }
    const meta = sigWizard.signerMeta[id];
    const color = SIG_COLORS[signerColorIdx(id) % SIG_COLORS.length];
    const style = signerTextStyle(id);
    const options = [
      `<option value="">Entreprise du document${docCompany.name ? ' — ' + escapeHTML(docCompany.name) : ''}</option>`,
      ...companies
        .filter((c) => c.id !== (getCompany(sigWizard.companyId) || getDefaultCompany() || {}).id)
        .map((c) => `<option value="${c.id}"${meta.companyId === c.id ? ' selected' : ''}>${escapeHTML(c.name)}</option>`),
      `<option value="__none__"${meta.companyId === '__none__' ? ' selected' : ''}>— Aucune entreprise —</option>`,
    ].join('');
    return `
      <div class="sig-signer-config" style="--sig-c: ${color}">
        <div class="sig-signer-config-name">${escapeHTML(p.name)}${p.role ? ` <small>· ${escapeHTML(p.role)}</small>` : ''}</div>
        <div class="sig-signer-config-fields">
          <label>Entreprise signataire
            <select data-sc-company="${id}">${options}</select>
          </label>
          <label>Mention
            <input type="text" data-sc-mention="${id}" list="sig-mentions"
                   value="${escapeHTML(meta.mention || '').replace(/"/g, '&quot;')}" placeholder="Ex : Bon pour accord">
          </label>
        </div>
        <div class="sig-signer-config-subtitle">Texte du bloc — taille, couleur, police</div>
        <div class="sig-signer-config-fields sig-style-fields">
          <label>Taille du texte
            <span class="sig-style-size">
              <input type="range" min="0.7" max="1.8" step="0.05" data-sc-size="${id}" value="${style.scale}">
              <output data-sc-size-out="${id}">${Math.round(style.scale * 100)} %</output>
            </span>
          </label>
          <label>Couleur
            <input type="color" data-sc-color="${id}" value="${style.color}">
          </label>
          <label>Police
            <select data-sc-font="${id}">
              ${SIG_TEXT_FONTS.map((f) => `<option value="${f.family}"${style.font === f.family ? ' selected' : ''}>${escapeHTML(f.label)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>`;
  }).join('');

  box.querySelectorAll('select[data-sc-company]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const meta = sigWizard.signerMeta[sel.dataset.scCompany];
      if (!meta) return;
      meta.companyId = sel.value;
      await refreshSigBlocks();
      renderSigPlacements();
    });
  });
  box.querySelectorAll('input[data-sc-mention]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const meta = sigWizard.signerMeta[inp.dataset.scMention];
      if (!meta) return;
      meta.mention = inp.value;
      scheduleSigBlocksRefresh();
    });
  });
  box.querySelectorAll('input[data-sc-size]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const st = signerTextStyle(inp.dataset.scSize);
      st.scale = parseFloat(inp.value) || 1;
      const out = box.querySelector(`output[data-sc-size-out="${inp.dataset.scSize}"]`);
      if (out) out.textContent = Math.round(st.scale * 100) + ' %';
      scheduleSigBlocksRefresh();
    });
  });
  box.querySelectorAll('input[data-sc-color]').forEach((inp) => {
    inp.addEventListener('input', () => {
      signerTextStyle(inp.dataset.scColor).color = inp.value;
      scheduleSigBlocksRefresh();
    });
  });
  box.querySelectorAll('select[data-sc-font]').forEach((sel) => {
    sel.addEventListener('change', () => {
      signerTextStyle(sel.dataset.scFont).font = sel.value;
      scheduleSigBlocksRefresh();
    });
  });
}

let sigBlocksRefreshTimer = null;
function scheduleSigBlocksRefresh() {
  clearTimeout(sigBlocksRefreshTimer);
  sigBlocksRefreshTimer = setTimeout(async () => {
    await refreshSigBlocks();
    renderSigPlacements();
  }, 250);
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
  if (sigWizard.placementMode === 'auto') {
    applyAutoPlacements(); // reconstruit blocs + placements, puis re rend
  } else {
    refreshSigBlocks().then(() => {
      renderSigPlacements();
      updateSignButtonState();
    });
  }
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
    if (sigWizard.placementMode === 'auto') {
      await applyAutoPlacements();
    } else {
      await refreshSigBlocks();
      renderSigPlacements();
    }
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

// Bloc complet : mention + signature + nom + fonction + entreprise + date.
// Taille (échelle), couleur et police des textes réglables par signataire.
async function buildSigBlockFor(profileId) {
  const profile = (state.signatureProfiles || []).find((p) => p.id === profileId);
  if (!profile) return null;
  const company = signerCompanySnapshot(profileId);
  const mention = signerMention(profileId);
  const dateStr = sigWizard.date || todayISO();
  const style = signerTextStyle(profileId);
  const key = [profileId, company.name, company.city, dateStr, mention,
    style.scale, style.color, style.font].join('|');
  const cached = sigWizard.blocks[profileId];
  if (cached && cached.key === key) return cached;

  const sig = await getSigSignatureImg(profile);
  if (!sig) return null;

  const W = 640, pad = 16;
  const maxTextW = W - 2 * pad;
  const s = style.scale || 1;
  const fam = sigTextFontStack(style.font);
  const color = style.color || '#1e293b';

  const maxSigW = 420, maxSigH = 150;
  const scale = Math.min(maxSigW / sig.w, maxSigH / sig.h, 1.6);
  const sigW = Math.round(sig.w * scale);
  const sigH = Math.round(sig.h * scale);

  let placeLine = '';
  if (company.city) placeLine = `Fait à ${company.city}, le ${formatDate(dateStr)}`;
  else placeLine = `Le ${formatDate(dateStr)}`;

  const lines = [
    { text: profile.name || '', weight: '700', base: 33 },
    { text: profile.role || '', weight: '400', base: 26 },
    { text: company.name || '', weight: 'italic 400', base: 26 },
    { text: placeLine, weight: '400', base: 22 },
  ].filter((l) => l.text && l.text.trim());

  const mentionH = mention ? Math.max(28, Math.round(34 * s)) : 0;
  const lineH = Math.max(24, Math.round(38 * s));

  try {
    await Promise.all(lines.map((l) =>
      document.fonts.load(`${l.weight} ${Math.round(l.base * s)}px ${fam}`)));
    if (mention) await document.fonts.load(`italic 600 ${Math.round(27 * s)}px ${fam}`);
  } catch (e) { /* déjà là */ }

  const c = document.createElement('canvas');
  c.width = W;
  c.height = pad + mentionH + sigH + 14 + lines.length * lineH + pad;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;

  // écrit une ligne en réduisant sa taille si nécessaire pour tenir dans le bloc
  const drawLine = (text, weight, base, x, y) => {
    let size = Math.max(11, Math.round(base * s));
    ctx.font = `${weight} ${size}px ${fam}`;
    while (size > 11 && ctx.measureText(text).width > maxTextW) {
      size -= 1;
      ctx.font = `${weight} ${size}px ${fam}`;
    }
    ctx.fillText(text, x, y);
  };

  if (mention) drawLine(mention, 'italic 600', 27, pad, pad + Math.round(25 * s));
  ctx.drawImage(await loadImage(sig.url), pad, pad + mentionH, sigW, sigH);
  let y = pad + mentionH + sigH + 14 + Math.round(28 * s);
  lines.forEach((l) => {
    drawLine(l.text, l.weight, l.base, pad, y);
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

// --- placement automatique (toutes les pages) ---

// Répartit les signataires sur une page selon la position choisie :
// bas/haut → côte à côte horizontalement ; gauche/droite → empilés verticalement.
function autoPlacementsForPage(pageIdx) {
  const n = sigWizard.signers.length;
  if (!n) return [];
  const size = sigWizard.pageSizes[pageIdx - 1] || { width: 595.28, height: 841.89 };
  const ratios = sigWizard.signers.map((id) => {
    const b = sigWizard.blocks[id];
    return b ? b.h / b.w : 0.5;
  });
  const margin = 0.05; // marge au bord (5 % du côté)
  const gap = 0.03;    // écart entre deux blocs
  const pos = sigWizard.autoPosition;

  let wPct = 0.24;
  if (pos === 'bottom' || pos === 'top') {
    // largeur maxi pour tout faire tenir sur une ligne
    wPct = Math.min(wPct, (1 - 2 * margin - (n - 1) * gap) / n);
  }
  let hPcts = ratios.map((r) => wPct * (size.width / size.height) * r);
  if (pos === 'left' || pos === 'right') {
    const total = hPcts.reduce((a, b) => a + b, 0) + (n - 1) * gap;
    const maxH = 0.9; // zone utile verticale
    if (total > maxH) {
      const s = maxH / total;
      hPcts = hPcts.map((h) => h * s);
      wPct *= s; // le bloc garde ses proportions
    }
  }

  const edge = 0.045; // décroché du bord sélectionné
  const out = [];
  sigWizard.signers.forEach((profileId, i) => {
    let xPct, yPct;
    if (pos === 'bottom' || pos === 'top') {
      const total = n * wPct + (n - 1) * gap;
      xPct = (1 - total) / 2 + i * (wPct + gap);
      yPct = pos === 'bottom' ? 1 - edge - hPcts[i] : edge;
    } else {
      const total = hPcts.reduce((a, b) => a + b, 0) + (n - 1) * gap;
      const startY = (1 - total) / 2;
      xPct = pos === 'left' ? margin : 1 - margin - wPct;
      yPct = startY + hPcts.slice(0, i).reduce((a, b) => a + b, 0) + i * gap;
    }
    out.push({ id: generateId(), profileId, page: pageIdx, xPct, yPct, wPct });
  });
  return out;
}

async function applyAutoPlacements() {
  if (!sigWizard || sigWizard.placementMode !== 'auto') return;
  await refreshSigBlocks();
  if (!sigWizard.pdfjsDoc) {
    sigWizard.placements = [];
  } else {
    const all = [];
    for (let pg = 1; pg <= sigWizard.pageCount; pg++) {
      all.push(...autoPlacementsForPage(pg));
    }
    sigWizard.placements = all;
  }
  renderSigPlacements();
  updateSignButtonState();
}

function updateSigPlaceModeUI() {
  if (!sigWizard) return;
  const group = document.getElementById('sig-auto-pos-group');
  const hint = document.getElementById('sig-place-hint');
  const isAuto = sigWizard.placementMode === 'auto';
  if (group) group.hidden = !isAuto;
  if (hint) {
    hint.textContent = isAuto
      ? 'En mode automatique, chaque signataire est placé sur toutes les pages. Déplacer ou redimensionner un bloc entraîne ses copies sur toutes les autres pages ; « × » supprime uniquement la copie de cette page.'
      : 'En mode manuel, sélectionnez un signataire (puces ci-dessus) puis cliquez sur le document pour placer ou déplacer sa signature. Cliquez sur d\'autres pages pour l\'y ajouter aussi.';
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
  const probe = sigWizard.placements.find(
    (p) => p.profileId === sigWizard.activeSigner && p.page === pageIdx
  );
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
    // en mode automatique, les copies des autres pages suivent le même placement
    if (sigWizard.placementMode === 'auto') {
      sigWizard.placements.forEach((p) => {
        if (p.profileId === probe.profileId && p.id !== probe.id) {
          const hPct = placementHeightPct(p);
          p.xPct = Math.max(0, Math.min(1 - p.wPct, xPct));
          p.yPct = Math.max(0, Math.min(1 - hPct, yPct));
        }
      });
    }
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
      box.dataset.pid = p.id;
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
      const linked = sigWizard.placementMode === 'auto';
      [
        { label: '−', title: linked ? 'Réduire (sur toutes les pages)' : 'Réduire', fn: () => resizePlacement(p, -0.02) },
        { label: '+', title: linked ? 'Agrandir (sur toutes les pages)' : 'Agrandir', fn: () => resizePlacement(p, 0.02) },
        { label: '×', title: 'Retirer de cette page', fn: () => removePlacement(p.id) },
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

// Redimensionne un bloc ; en mode automatique, la nouvelle largeur s'applique
// aussi aux copies du signataire sur toutes les autres pages.
function resizePlacement(placement, delta) {
  const w = Math.max(0.08, Math.min(0.9, placement.wPct + delta));
  placement.wPct = w;
  if (sigWizard.placementMode === 'auto') {
    sigWizard.placements.forEach((p) => {
      if (p.profileId === placement.profileId && p.id !== placement.id) p.wPct = w;
    });
  }
  afterPlacementChange();
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

    // En mode automatique, les copies du signataire sur les autres pages
    // suivent le déplacement (même translation, en % de page).
    const followers = sigWizard.placementMode === 'auto'
      ? sigWizard.placements
        .filter((p) => p.profileId === placement.profileId && p.page !== placement.page)
        .map((p) => ({
          p,
          origX: p.xPct,
          origY: p.yPct,
          box: document.querySelector(`#sig-pages .sig-box[data-pid="${p.id}"]`),
        }))
      : [];

    const moveBox = (p, x, y, el) => {
      const hPct = placementHeightPct(p);
      x = Math.max(0, Math.min(1 - p.wPct, x));
      y = Math.max(0, Math.min(1 - hPct, y));
      p.xPct = x;
      p.yPct = y;
      if (el) {
        el.style.left = (x * 100) + '%';
        el.style.top = (y * 100) + '%';
      }
    };

    const onMove = (e) => {
      const dx = (e.clientX - startX) / rect.width;
      const dy = (e.clientY - startY) / rect.height;
      moveBox(placement, origX + dx, origY + dy, box);
      followers.forEach((f) => moveBox(f.p, f.origX + dx, f.origY + dy, f.box));
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

    // un signataire peut figurer sur plusieurs pages : on regroupe
    const pagesBySigner = new Map();
    sigWizard.placements.forEach((p) => {
      if (!pagesBySigner.has(p.profileId)) pagesBySigner.set(p.profileId, []);
      pagesBySigner.get(p.profileId).push(p.page);
    });

    const meta = {
      id: generateId(),
      title: base,
      docType: sigWizard.docType,
      description: sigWizard.description.trim(),
      date: sigWizard.date,
      createdAt: new Date().toISOString(),
      company: { name: company.name, siret: company.siret, city: company.city },
      signers: [...pagesBySigner.entries()].map(([profileId, pages]) => {
        const pr = (state.signatureProfiles || []).find((x) => x.id === profileId) || {};
        const co = signerCompanySnapshot(profileId);
        return {
          name: pr.name || '?',
          role: pr.role || '',
          company: co.name || '',
          mention: signerMention(profileId),
          page: pages[0],
          pages: pages.slice().sort((a, b) => a - b),
        };
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
    delete sigWizard.signerMeta[profileId];
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
    if (sigWizard.placementMode === 'auto') {
      applyAutoPlacements();
    } else {
      refreshSigBlocks().then(() => {
        renderSigPlacements();
        updateSignButtonState();
      });
    }
  }
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
    renderSignersConfig(); // libellés « Entreprise du document » + listes
    await refreshSigBlocks();
    renderSigPlacements();
  });
  $('btn-manage-companies').addEventListener('click', () => showView('companies'));
  $('btn-manage-signers').addEventListener('click', () => showView('profiles'));

  // Assistant : placement automatique / manuel
  document.querySelectorAll('input[name="sig-place-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      sigWizard.placementMode = radio.value;
      updateSigPlaceModeUI();
      if (sigWizard.placementMode === 'auto') {
        applyAutoPlacements();
      } else {
        renderSigPlacements();
        updateSignButtonState();
      }
    });
  });
  $('sig-auto-pos').addEventListener('change', (e) => {
    sigWizard.autoPosition = e.target.value;
    applyAutoPlacements();
  });

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

  // Les entreprises (modale, CRUD) sont gérées par js/companies.js
  // (page Entreprises partagée avec l'éditeur et la signature).
}
