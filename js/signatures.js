/* ============================================
   SIGNATURE DE DOCUMENTS
   --------------------------------------------
   - Liste des documents signés (re-téléchargeables)
   - Assistant (/signer) : upload PDF → nom du
     fichier signé → signataires (profils de la
     page /signataires) → placement visuel :
     commune à toutes les pages (automatique,
     précis ou manuel) ou autonome sur certaines
     pages seulement → signature
   - Profils de signataires (/signataires) : nom
     en écriture manuscrite générée (IA) ou dessin,
     lignes du bloc facultatives en nombre libre
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
    outputName: '',  // nom du fichier signé (téléchargé / archivé)
    pdfBytes: null,   // copie maître pour pdf-lib
    pdfjsDoc: null,
    pageCount: 0,
    pageSizes: [],    // tailles en points PDF (scale 1)
    signers: [],      // ids de profils sélectionnés
    activeSigner: null,
    // Mode de placement :
    // 'auto'    = commune à toutes les pages, position par défaut (copies liées)
    // 'precise' = commune, position choisie sur la 1re page, reproduite partout
    // 'manual'  = commune, positionnement page par page
    // 'free'    = autonome : blocs indépendants, seulement certaines pages
    placementMode: 'auto',
    lastCommonMode: 'auto', // dernier type utilisé en mode commune
    autoPosition: 'bottom', // bottom | top | left | right | bottom-right |
                            // bottom-left | top-right | top-left
    placements: [],   // {id, profileId, page, xPct, yPct, wPct}
    blocks: {},       // PNG de bloc par profileId (avec clé d'invalidation)
    busy: false,
  };
}

function startSignatureWizard() {
  // reprend l'assistant en cours s'il y a un brouillon (PDF chargé,
  // signataires ou nom de fichier saisi) ; sinon on repart de zéro
  const draft = sigWizard && (sigWizard.pdfBytes || sigWizard.signers.length
    || (sigWizard.outputName || '').trim());
  if (!draft) resetSignatureWizard();
  showView('signatureNew'); // le hook showView appelle prepareSignatureWizard()
}

// Remise à zéro complète de l'assistant (état + champs) :
// démarrage d'une nouvelle signature, annulation, ou après signature.
function resetSignatureWizard() {
  sigWizard = newWizardState();
  const $ = (id) => document.getElementById(id);

  $('sig-file-input').value = '';
  $('sig-file-info').hidden = true;
  $('sig-dropzone').style.display = '';
  $('sig-output-name').value = '';
  $('sig-pages').innerHTML = '';
  $('sig-pages-empty').style.display = '';

  const commonRadio = document.querySelector('input[name="sig-scope"][value="common"]');
  if (commonRadio) commonRadio.checked = true;
  const autoRadio = document.querySelector('input[name="sig-place-mode"][value="auto"]');
  if (autoRadio) autoRadio.checked = true;
  $('sig-auto-pos').value = 'bottom';
  updateSigPlaceModeUI();

  renderWizardSigners();
  updateSignButtonState();
}

// Appelé à chaque affichage de la vue : réaffiche l'état courant de
// l'assistant. Naviguer vers une autre page (signataires…) puis revenir
// ne perd plus rien — la remise à zéro n'a lieu que via
// resetSignatureWizard().
async function prepareSignatureWizard() {
  if (!sigWizard) {
    resetSignatureWizard();
    return;
  }
  // précharge le moteur d'écriture manuscrite (2,6 Mo, en cache navigateur)
  HandwritingSynth.load().catch(() => {});
  const $ = (id) => document.getElementById(id);

  // nom du fichier signé
  $('sig-output-name').value = sigWizard.outputName;
  $('sig-file-input').value = '';

  // fichier chargé : réafficher ses infos (et masquer la zone d'upload)
  if (sigWizard.pdfjsDoc) {
    $('sig-file-name').textContent = sigWizard.fileName;
    const sizeMb = sigWizard.pdfBytes ? sigWizard.pdfBytes.length / 1024 / 1024 : 0;
    $('sig-file-meta').textContent =
      `${sizeMb.toFixed(2)} Mo · ${sigWizard.pageCount} page${sigWizard.pageCount > 1 ? 's' : ''}`;
    $('sig-file-info').hidden = false;
    $('sig-dropzone').style.display = 'none';
    // filet de sécurité : re-rendre les pages si le conteneur a été vidé
    if (!$('sig-pages').querySelector('.sig-page')) await renderWizardPdfPages();
  } else {
    $('sig-file-info').hidden = true;
    $('sig-dropzone').style.display = '';
  }

  // mode de placement + position automatique
  updateSigPlaceModeUI();
  $('sig-auto-pos').value = sigWizard.autoPosition;

  // signataires supprimés depuis la page Signataires : on nettoie
  sigWizard.signers = sigWizard.signers.filter((id) =>
    (state.signatureProfiles || []).some((p) => p.id === id));
  sigWizard.placements = sigWizard.placements.filter((p) =>
    (state.signatureProfiles || []).some((x) => x.id === p.profileId));
  if (sigWizard.activeSigner && !sigWizard.signers.includes(sigWizard.activeSigner)) {
    sigWizard.activeSigner = sigWizard.signers[sigWizard.signers.length - 1] || null;
  }

  renderWizardSigners();
  await refreshSigBlocks(); // profils modifiés entre-temps : blocs à regénérer
  renderSigPlacements();
  updateSignButtonState();
}

function signerColorIdx(profileId) {
  const i = sigWizard ? sigWizard.signers.indexOf(profileId) : -1;
  return i < 0 ? 0 : i;
}

// Styles proposés pour chaque ligne du bloc de signature
const SIG_LINE_STYLES = [
  { value: 'script', label: 'Manuscrite (IA)' },
  { value: 'mention', label: 'Mention (italique)' },
  { value: 'print', label: 'Texte' },
];

// Style des textes du bloc (taille, couleur, police) — vit dans le profil
// du signataire (page Signataires), plus dans l'assistant.
function profileTextStyle(profile) {
  const p = profile || {};
  if (!p.textStyle) p.textStyle = {};
  Object.keys(SIG_TEXT_STYLE_DEFAULTS).forEach((k) => {
    if (p.textStyle[k] === undefined) p.textStyle[k] = SIG_TEXT_STYLE_DEFAULTS[k];
  });
  return p.textStyle;
}

// Lignes du bloc définies sur la fiche du signataire (facultatives, en
// nombre libre). Les profils créés avant cette version retrouvent le
// contenu par défaut de l'ancien assistant (mention + date + fonction).
function ensureProfileLines(profile) {
  const p = profile || {};
  if (Array.isArray(p.lines)) return p.lines;
  p.lines = [
    { id: generateId(), text: 'Bon pour accord', style: 'mention' },
    { id: generateId(), text: 'Fait le {date}', style: 'script' },
  ];
  if (p.role) p.lines.push({ id: generateId(), text: p.role, style: 'print' });
  return p.lines;
}

function sigTextFontStack(family) {
  if (family === 'Georgia') return 'Georgia, "Times New Roman", serif';
  if (family === 'Inter') return 'Inter, sans-serif';
  return `"${family}", Inter, sans-serif`;
}

// ---------- écriture manuscrite générée (IA) ----------
// Chaque signataire possède sa « main » : une graine stable (dérivée de
// son id ou choisie à la création), un style de modèle, une lisibilité,
// une épaisseur de trait et un numéro de variante. La même graine + le
// même texte redonnent exactement les mêmes traits.

function profileHand(profile) {
  const p = profile || {};
  return {
    seed: (p.handSeed >>> 0) || HandwritingSynth.hashStr(p.id || 'signataire'),
    style: p.handStyle === undefined || p.handStyle === null ? '-' : String(p.handStyle),
    bias: typeof p.handBias === 'number' ? p.handBias : 0.75,
    width: typeof p.handWidth === 'number' ? p.handWidth : 1.2,
    variant: p.handVariant || 0,
  };
}

// Graine effective pour un texte donné : stable pour un signataire, mais
// chaque texte (et chaque variante) s'écrit avec ses propres variations.
function handSeedFor(profile, text, salt) {
  const h = profileHand(profile);
  return HandwritingSynth.hashStr(h.seed + '/' + h.variant + '/' + (salt || 0) + '/' + (text || ''));
}

let synthFallbackWarned = false;
function warnSynthFallback() {
  if (synthFallbackWarned) return;
  synthFallbackWarned = true;
  showToast('Moteur d\'écriture IA indisponible — polices manuscrites utilisées', 'error');
}

// Nom d'un signataire en écriture manuscrite générée (image canvas).
async function getSynthSignatureImg(profile) {
  const h = profileHand(profile);
  const text = ((profile && profile.name) || 'Signature').trim();
  const key = [profile.id, 'synth', h.seed, h.variant, h.style, h.bias, h.width, text].join('|');
  if (sigImgCache[key]) return sigImgCache[key];
  try {
    const img = await HandwritingSynth.generate(text, {
      style: h.style, bias: h.bias, width: h.width,
      seed: handSeedFor(profile, text, 0), ink: '#111827',
    });
    const entry = { url: img.url, w: img.w, h: img.h };
    sigImgCache[key] = entry;
    return entry;
  } catch (e) {
    console.warn('Écriture IA indisponible:', e);
    warnSynthFallback();
    return null;
  }
}

// Ligne de texte en écriture manuscrite générée (phrase, date, ligne
// supplémentaire) — même « main » que la signature, couleur du bloc.
async function getSynthLineImg(profile, text, ink, salt) {
  const h = profileHand(profile);
  const t = String(text || '').trim();
  if (!t) return null;
  try {
    return await HandwritingSynth.generate(t, {
      style: h.style, bias: h.bias, width: Math.max(0.75, h.width * 0.92),
      seed: handSeedFor(profile, t, salt || 0), ink: ink || '#1e293b',
    });
  } catch (e) {
    console.warn('Écriture IA indisponible (ligne):', e);
    warnSynthFallback();
    return null;
  }
}

// Date longue en toutes lettres : « 23 octobre 2026 »
function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
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
    if (!(sigWizard.outputName || '').trim()) {
      sigWizard.outputName = file.name.replace(/\.pdf$/i, '');
      document.getElementById('sig-output-name').value = sigWizard.outputName;
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

async function getSigSignatureImg(profile, opts) {
  if (!profile) return null;
  const noCache = !!(opts && opts.noCache);
  const key = profile.styleType === 'draw'
    ? profile.id + '|draw|' + (profile.drawData ? profile.drawData.length : 0)
    : profile.id + '|' + (profile.font || '') + '|' + (profile.name || '');
  if (!noCache && sigImgCache[key]) return sigImgCache[key];

  let canvas = null;
  if (profile.styleType === 'draw' && profile.drawData) {
    const img = await loadImage(profile.drawData);
    canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
  } else {
    // écriture manuscrite générée par le moteur IA (calligrapher.ai) ;
    // police manuscrite en secours si le moteur est indisponible
    const synth = await getSynthSignatureImg(profile);
    if (synth) {
      const img = await loadImage(synth.url);
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
  }

  const entry = { url: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
  if (!noCache) sigImgCache[key] = entry;
  return entry;
}

// Bloc de signature construit depuis la fiche du signataire :
//   la signature elle-même (dessin ou nom en écriture manuscrite générée)
//   puis les lignes définies sur le profil, en nombre libre —
//   manuscrite (IA), mention (italique) ou texte, {date} remplacé par
//   la date du jour en toutes lettres.
// Taille (échelle), couleur et police des textes réglables par signataire.
function sigBlockKey(profile) {
  const hand = profileHand(profile);
  const style = profileTextStyle(profile);
  return [profile.id, profile.name, profile.styleType, profile.font,
    profile.drawData ? profile.drawData.length : 0,
    hand.seed, hand.style, hand.bias, hand.width, hand.variant,
    style.scale, style.color, style.font,
    todayISO(), // les lignes peuvent contenir {date}
    JSON.stringify(profile.lines || [])].join('|');
}

async function buildSigBlock(profile, opts) {
  if (!profile) return null;
  const noCache = !!(opts && opts.noCache);
  const lines = ensureProfileLines(profile);
  const dateStr = todayISO();
  const style = profileTextStyle(profile);
  const W = 640, pad = 16;
  const maxTextW = W - 2 * pad;
  const s = style.scale || 1;
  const fam = sigTextFontStack(style.font);
  const color = style.color || '#1e293b';
  const scriptFam = (SIG_FONTS.find((f) => f.family === (profile.font || 'Caveat')) || SIG_FONTS[0]).family;
  const scriptStack = `"${scriptFam}", "Caveat", cursive`;

  const fontSpecs = [];
  const items = []; // {h, draw(ctx, y)}

  // ligne de texte simple (mention, texte), réduite si besoin
  const textItem = (text, weight, base, opts2 = {}) => {
    const stack = opts2.script ? scriptStack : fam;
    const useFam = opts2.script ? `"${scriptFam}"` : fam;
    const lineH = Math.max(22, Math.round((opts2.lineH || 34) * s));
    fontSpecs.push(`${weight} ${Math.round(base * s)}px ${useFam}`);
    return {
      h: lineH,
      draw(ctx, y) {
        let size = Math.max(11, Math.round(base * s));
        ctx.font = `${weight} ${size}px ${stack}`;
        while (size > 11 && ctx.measureText(text).width > maxTextW) {
          size -= 1;
          ctx.font = `${weight} ${size}px ${stack}`;
        }
        ctx.fillText(text, pad, y + Math.round(lineH * 0.72));
      },
    };
  };

  // image (dessin ou écriture générée) insérée dans le bloc
  const wrapImg = async (entry) => ({ el: await loadImage(entry.url), w: entry.w, h: entry.h });
  const imgItem = (img, maxW, maxH) => {
    const scale = Math.min(maxW / img.w, maxH / img.h, 1.6);
    const w = Math.round(img.w * scale);
    const h = Math.round(img.h * scale);
    return { h, draw(ctx, y) { ctx.drawImage(img.el, pad, y, w, h); } };
  };

  // ligne en écriture manuscrite générée ; police manuscrite en secours
  const synthLineItem = async (text, salt, base) => {
    const img = await getSynthLineImg(profile, text, color, salt);
    if (img) return imgItem(await wrapImg(img), maxTextW, Math.round(82 * s));
    return textItem(String(text), '400', base, { script: true });
  };

  // 1. la signature : dessin enregistré ou nom en écriture manuscrite
  //    générée (IA), police manuscrite en secours
  const sig = await getSigSignatureImg(profile, { noCache });
  if (sig) items.push(imgItem(await wrapImg(sig), 440, Math.round(150 * s)));
  else if (profile.name) items.push(textItem(profile.name, '400', 34, { script: true }));

  // 2. les lignes de la fiche (facultatives, en nombre libre) ; chaque
  //    retour à la ligne dans un texte crée une ligne de bloc supplémentaire
  let lineNo = 0;
  for (const line of lines) {
    const raw = String(line.text || '').replace(/\{date\}/gi, formatDateLong(dateStr));
    for (const sub of raw.split('\n')) {
      const text = sub.trim();
      if (!text) continue;
      const salt = 100 + lineNo;
      if (line.style === 'mention') items.push(textItem(text, 'italic 600', 27));
      else if (line.style === 'print') items.push(textItem(text, '400', 26));
      else items.push(await synthLineItem(text, salt, 30));
      lineNo += 1;
    }
  }

  try {
    await Promise.all([...new Set(fontSpecs)].map((f) => document.fonts.load(f)));
  } catch (e) { /* déjà là */ }

  const gap = Math.round(6 * s);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Math.max(pad + items.reduce((a, it) => a + it.h + gap, 0) + pad, 36);
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  let y = pad;
  for (const it of items) {
    it.draw(ctx, y);
    y += it.h + gap;
  }

  return { dataUrl: c.toDataURL('image/png'), w: W, h: c.height };
}

async function refreshSigBlocks() {
  if (!sigWizard) return;
  for (const id of sigWizard.signers) {
    const profile = (state.signatureProfiles || []).find((p) => p.id === id);
    if (!profile) continue;
    const key = sigBlockKey(profile);
    const cached = sigWizard.blocks[id];
    if (cached && cached.key === key) continue;
    const block = await buildSigBlock(profile);
    if (block) sigWizard.blocks[id] = { key, ...block };
  }
}

// --- placement automatique (toutes les pages) ---

// Répartit les signataires sur une page selon la position choisie :
// bas/haut/coins → côte à côte horizontalement (alignés au centre ou au
// coin) ; gauche/droite → empilés verticalement.
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
  const isVertical = pos === 'left' || pos === 'right';

  let wPct = 0.24;
  if (!isVertical) {
    // largeur maxi pour tout faire tenir sur une ligne
    wPct = Math.min(wPct, (1 - 2 * margin - (n - 1) * gap) / n);
  }
  let hPcts = ratios.map((r) => wPct * (size.width / size.height) * r);
  if (isVertical) {
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
    if (isVertical) {
      const total = hPcts.reduce((a, b) => a + b, 0) + (n - 1) * gap;
      const startY = (1 - total) / 2;
      xPct = pos === 'left' ? margin : 1 - margin - wPct;
      yPct = startY + hPcts.slice(0, i).reduce((a, b) => a + b, 0) + i * gap;
    } else {
      const total = n * wPct + (n - 1) * gap;
      const hAlign = pos.endsWith('-left') ? 'start'
        : pos.endsWith('-right') ? 'end' : 'center';
      xPct = (hAlign === 'start' ? margin : hAlign === 'end' ? 1 - margin - total : (1 - total) / 2)
        + i * (wPct + gap);
      yPct = pos.startsWith('top') ? edge : 1 - edge - hPcts[i];
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
  const common = document.getElementById('sig-common-options');
  const autoGroup = document.getElementById('sig-auto-pos-group');
  const hint = document.getElementById('sig-place-hint');
  const mode = sigWizard.placementMode;
  const isCommon = mode !== 'free';

  // options du mode « commune » (type de placement + position auto)
  if (common) common.hidden = !isCommon;
  if (autoGroup) autoGroup.hidden = mode !== 'auto';

  // cohérence des boutons radio avec l'état
  const scopeRadio = document.querySelector(
    `input[name="sig-scope"][value="${isCommon ? 'common' : 'free'}"]`);
  if (scopeRadio) scopeRadio.checked = true;
  if (isCommon) {
    const modeRadio = document.querySelector(
      `input[name="sig-place-mode"][value="${mode}"]`);
    if (modeRadio) modeRadio.checked = true;
  }

  if (!hint) return;
  if (mode === 'auto') {
    hint.textContent = 'Commune · automatique : toutes les pages à la position choisie. Déplacer ou redimensionner un bloc entraîne ses copies ; « × » supprime la copie de la page.';
  } else if (mode === 'precise') {
    hint.textContent = 'Commune · précis : cliquez sur la 1ʳᵉ page pour placer un signataire — la position est reproduite sur toutes les pages, puis ajustable librement page par page.';
  } else if (mode === 'manual') {
    hint.textContent = 'Commune · manuel : sélectionnez un signataire puis cliquez sur chaque page pour y positionner sa signature (ajustable librement).';
  } else {
    hint.textContent = 'Autonome : sélectionnez un signataire puis cliquez où vous voulez — chaque bloc est indépendant (plusieurs signatures différentes possibles, sur certaines pages seulement).';
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
  const profileId = sigWizard.activeSigner;
  const mine = sigWizard.placements.filter((p) => p.profileId === profileId);
  const wPct = mine.length ? mine[0].wPct : 0.24;
  let hPct = 0.1;
  const probe = mine.find((p) => p.page === pageIdx);
  if (probe) hPct = placementHeightPct(probe);
  else {
    const block = sigWizard.blocks[profileId];
    if (size && block) hPct = wPct * (size.width / size.height) * (block.h / block.w);
  }

  // position relative du clic (0,5 = centre si l'élément est masqué/à 0)
  const relX = rect.width > 0 ? (ev.clientX - rect.left) / rect.width : 0.5;
  const relY = rect.height > 0 ? (ev.clientY - rect.top) / rect.height : 0.5;
  let xPct = relX - wPct / 2;
  let yPct = relY - hPct / 2;
  xPct = Math.max(0, Math.min(1 - wPct, xPct));
  yPct = Math.max(0, Math.min(1 - hPct, yPct));
  if (!isFinite(xPct)) xPct = 0.38;
  if (!isFinite(yPct)) yPct = 0.8 - hPct / 2;

  if (sigWizard.placementMode === 'precise') {
    // Position choisie une fois → reproduite sur toutes les pages (création
    // ou repositionnement global). Les ajustements restent ensuite locaux.
    for (let pg = 1; pg <= sigWizard.pageCount; pg++) {
      let p = mine.find((x) => x.page === pg);
      if (!p) {
        p = { id: generateId(), profileId, page: pg, xPct: 0, yPct: 0, wPct };
        sigWizard.placements.push(p);
        mine.push(p);
      }
      const pgH = placementHeightPct(p);
      p.xPct = Math.max(0, Math.min(1 - p.wPct, xPct));
      p.yPct = Math.max(0, Math.min(1 - pgH, yPct));
    }
  } else if (probe) {
    probe.page = pageIdx;
    probe.xPct = xPct;
    probe.yPct = yPct;
    // en mode automatique, les copies des autres pages suivent le même placement
    if (sigWizard.placementMode === 'auto') {
      sigWizard.placements.forEach((p) => {
        if (p.profileId === probe.profileId && p.id !== probe.id) {
          const hPct2 = placementHeightPct(p);
          p.xPct = Math.max(0, Math.min(1 - p.wPct, xPct));
          p.yPct = Math.max(0, Math.min(1 - hPct2, yPct));
        }
      });
    }
  } else {
    sigWizard.placements.push({
      id: generateId(),
      profileId,
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

  const free = sigWizard.placementMode === 'free';
  const missing = sigWizard.signers.filter(
    (id) => !sigWizard.placements.some((p) => p.profileId === id)
  );
  let ready = false;
  let msg = '';
  if (!sigWizard.pdfBytes) {
    msg = 'Téléversez d\'abord le PDF à signer.';
  } else if (free) {
    if (!sigWizard.placements.length) {
      msg = 'Ajoutez au moins une signature sur le document (clic sur l\'aperçu).';
    } else {
      ready = true;
      msg = 'Tout est prêt.';
    }
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
      let block = sigWizard.blocks[p.profileId];
      if (!block) {
        // filet de sécurité : bloc jamais généré (repli depuis le profil)
        const profile = (state.signatureProfiles || []).find((x) => x.id === p.profileId);
        const built = await buildSigBlock(profile);
        if (!built) throw new Error('bloc de signature manquant');
        block = sigWizard.blocks[p.profileId] = { key: '', ...built };
      }
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
    // nom du fichier signé : celui saisi par l'utilisateur, sinon celui du PDF
    const base = (sigWizard.outputName || '').trim()
      || sigWizard.fileName.replace(/\.pdf$/i, '') || 'Document';

    // un signataire peut figurer sur plusieurs pages : on regroupe
    const pagesBySigner = new Map();
    sigWizard.placements.forEach((p) => {
      if (!pagesBySigner.has(p.profileId)) pagesBySigner.set(p.profileId, []);
      pagesBySigner.get(p.profileId).push(p.page);
    });

    const meta = {
      id: generateId(),
      title: base,
      description: '',
      date: todayISO(),
      createdAt: new Date().toISOString(),
      signers: [...pagesBySigner.entries()].map(([profileId, pages]) => {
        const pr = (state.signatureProfiles || []).find((x) => x.id === profileId) || {};
        return {
          name: pr.name || '?',
          role: pr.role || '',
          page: pages[0],
          pages: pages.slice().sort((a, b) => a - b),
        };
      }),
      fileName: `${base}.pdf`,
      originalName: sigWizard.fileName,
      pageCount: sigWizard.pageCount,
    };

    const saved = await saveSignedDoc(meta, out);
    triggerPdfDownload(meta.fileName, out);
    showToast(saved ? 'Document signé et enregistré' : 'Document signé, mais non sauvegardé (espace insuffisant)');
    resetSignatureWizard(); // signature terminée : assistant vidé pour la suivante
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
let spHandSeed = 0;     // graine « main » en cours d'édition
let spVariant = 0;      // variante d'écriture en cours d'édition
let spPreviewToken = 0; // annule les aperçus IA obsolètes
let spPreviewTimer = null;
let spLines = [];       // lignes du bloc en cours d'édition
let spTextStyle = null; // style des textes en cours d'édition
let spBlockTimer = null; // débounce de l'aperçu du bloc complet

function renderProfiles() {
  // moteur d'écriture manuscrite : préchargé dès la page Signataires
  HandwritingSynth.load().catch(() => {});
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
          ${p.styleType === 'draw' ? 'Signature dessinée' : 'Écriture manuscrite générée (IA)'}
          ${ensureProfileLines(p).length ? ' · ' + ensureProfileLines(p).length + ' ligne' + (ensureProfileLines(p).length > 1 ? 's' : '') : ''}
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
    delete sigWizard.blocks[profileId];
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

  // lignes du bloc + style des textes : copies de travail pendant l'édition
  spLines = (profile ? ensureProfileLines(profile) : []).map((l) => ({ ...l }));
  spTextStyle = { ...SIG_TEXT_STYLE_DEFAULTS, ...((profile && profile.textStyle) || {}) };

  // réglages de la « main » (écriture générée) : graine stable par profil,
  // nouvelle graine pour un nouveau signataire
  const hand = profileHand(profile || {});
  spHandSeed = profile ? hand.seed : ((Math.random() * 0x7fffffff) | 0);
  spVariant = hand.variant;
  document.getElementById('sp-hand-style').value = hand.style;
  document.getElementById('sp-hand-bias').value = String(hand.bias);

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
  renderSpLines();
  fillSpTextStyleInputs();
  scheduleSpBlockPreview();
  modal.classList.add('active');
  setTimeout(() => nameEl.focus(), 50);
}

function closeSigProfileModal() {
  document.getElementById('sigprofile-modal').classList.remove('active');
  editingProfileId = null;
  clearTimeout(spBlockTimer);
}

// --- lignes du bloc de signature (fiche signataire, en nombre libre) ---

function renderSpLines() {
  const box = document.getElementById('sp-lines');
  if (!spLines.length) {
    box.innerHTML = '<p class="form-hint" style="margin:0;">Aucune ligne — le bloc ne contiendra que la signature. Ajoutez-en autant que vous voulez (mention, date, fonction…).</p>';
    return;
  }
  box.innerHTML = spLines.map((l, i) => `
    <div class="sig-extra-line sp-line-row">
      <select data-spline-style="${i}" title="Style de la ligne">
        ${SIG_LINE_STYLES.map((st) => `<option value="${st.value}"${l.style === st.value ? ' selected' : ''}>${escapeHTML(st.label)}</option>`).join('')}
      </select>
      <textarea data-spline-text="${i}" rows="1" placeholder="Texte — ex : Bon pour accord, Fait le {date}…">${escapeHTML(l.text || '')}</textarea>
      <button type="button" class="btn btn-ghost" data-spline-del="${i}" title="Supprimer cette ligne">×</button>
    </div>`).join('');

  box.querySelectorAll('select[data-spline-style]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const line = spLines[parseInt(sel.dataset.splineStyle, 10)];
      if (line) line.style = sel.value;
      scheduleSpBlockPreview();
    });
  });
  box.querySelectorAll('textarea[data-spline-text]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const line = spLines[parseInt(inp.dataset.splineText, 10)];
      if (line) line.text = inp.value;
      scheduleSpBlockPreview();
    });
  });
  box.querySelectorAll('button[data-spline-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      spLines.splice(parseInt(btn.dataset.splineDel, 10), 1);
      renderSpLines();
      scheduleSpBlockPreview();
    });
  });
}

function addSpLine() {
  spLines.push({ id: generateId(), text: '', style: 'script' });
  renderSpLines();
  const fields = document.querySelectorAll('#sp-lines textarea[data-spline-text]');
  const last = fields[fields.length - 1];
  if (last) last.focus();
  scheduleSpBlockPreview();
}

function fillSpTextStyleInputs() {
  const font = document.getElementById('sp-text-font');
  if (font && !font.options.length) {
    font.innerHTML = SIG_TEXT_FONTS.map((f) =>
      `<option value="${f.family}">${escapeHTML(f.label)}</option>`).join('');
  }
  document.getElementById('sp-text-scale').value = spTextStyle.scale;
  document.getElementById('sp-text-scale-out').textContent =
    Math.round(spTextStyle.scale * 100) + ' %';
  document.getElementById('sp-text-color').value = spTextStyle.color;
  if (font) font.value = spTextStyle.font;
}

// Profil fictaire reflétant l'état courant de la modale (aperçu du bloc)
function spPseudoProfile() {
  const styleType = document.querySelector('input[name="sp-style"]:checked').value;
  return {
    id: editingProfileId || 'apercu',
    name: document.getElementById('sp-name').value.trim() || 'Prénom Nom',
    styleType,
    font: spSelectedFont,
    drawData: styleType === 'draw' && spDrewSomething
      ? document.getElementById('sp-draw-canvas').toDataURL('image/png')
      : null,
    handSeed: spHandSeed,
    handStyle: document.getElementById('sp-hand-style').value,
    handBias: parseFloat(document.getElementById('sp-hand-bias').value) || 0.75,
    handVariant: spVariant,
    textStyle: { ...spTextStyle },
    lines: spLines.map((l) => ({ ...l })),
  };
}

// la génération d'écriture prend ~1 s : on débounce l'aperçu du bloc
function scheduleSpBlockPreview() {
  clearTimeout(spBlockTimer);
  spBlockTimer = setTimeout(updateSpBlockPreview, 400);
}

async function updateSpBlockPreview() {
  const box = document.getElementById('sp-block-preview');
  if (!box || !spTextStyle) return;
  box.innerHTML = '<span class="sp-preview-loading">Génération de l\'aperçu…</span>';
  try {
    const block = await buildSigBlock(spPseudoProfile(), { noCache: true });
    if (!block) return;
    box.innerHTML = '';
    const img = document.createElement('img');
    img.src = block.dataUrl;
    img.alt = 'aperçu du bloc de signature';
    box.appendChild(img);
  } catch (e) {
    console.warn('Aperçu du bloc:', e);
    box.innerHTML = '<span class="sp-preview-loading">Aperçu indisponible</span>';
  }
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
      scheduleSpBlockPreview();
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
  const font = SIG_FONTS.find((f) => f.family === spSelectedFont) || SIG_FONTS[0];

  // aperçu simple si le moteur IA est indisponible
  const fallback = () => {
    preview.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = name;
    span.style.fontFamily = `'${font.family}', cursive`;
    preview.appendChild(span);
  };

  // écriture manuscrite générée à partir du nom (moteur calligrapher.ai)
  const token = ++spPreviewToken;
  preview.innerHTML = '<span class="sp-preview-loading">Génération de l\'écriture manuscrite…</span>';
  const pseudo = {
    id: editingProfileId || 'apercu',
    name,
    handSeed: spHandSeed,
    handStyle: document.getElementById('sp-hand-style').value,
    handBias: parseFloat(document.getElementById('sp-hand-bias').value) || 0.75,
    handVariant: spVariant,
  };
  HandwritingSynth.generate(name, {
    style: pseudo.handStyle,
    bias: pseudo.handBias,
    width: 1.2,
    seed: handSeedFor(pseudo, name, 0),
    ink: '#111827',
  }).then((img) => {
    if (token !== spPreviewToken) return; // aperçu remplacé entre-temps
    preview.innerHTML = '';
    const el = document.createElement('img');
    el.src = img.url;
    el.alt = 'aperçu de la signature manuscrite';
    preview.appendChild(el);
  }).catch(() => {
    if (token !== spPreviewToken) return;
    fallback();
  });
}

// la génération d'écriture prend ~1 s : on débounce la saisie
function scheduleSpPreview() {
  clearTimeout(spPreviewTimer);
  spPreviewTimer = setTimeout(updateSpPreview, 350);
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
  const stop = () => {
    spDrawing = false;
    scheduleSpBlockPreview(); // le dessin a changé : aperçu du bloc à rafraîchir
  };
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

  // réglages de la « main » (écriture générée par IA)
  const handStyle = document.getElementById('sp-hand-style').value;
  const handBias = parseFloat(document.getElementById('sp-hand-bias').value) || 0.75;

  if (existing) {
    existing.name = name;
    existing.role = role;
    existing.styleType = styleType;
    existing.font = styleType === 'font' ? spSelectedFont : null;
    existing.drawData = drawData;
    existing.handSeed = spHandSeed;
    existing.handStyle = handStyle;
    existing.handBias = handBias;
    existing.handVariant = spVariant;
    existing.lines = spLines.map((l) => ({ ...l }));
    existing.textStyle = { ...spTextStyle };
    showToast('Signataire mis à jour');
  } else {
    state.signatureProfiles.push({
      id: generateId(),
      name,
      role,
      styleType,
      font: styleType === 'font' ? spSelectedFont : null,
      drawData,
      handSeed: spHandSeed,
      handStyle,
      handBias,
      handVariant: spVariant,
      lines: spLines.map((l) => ({ ...l })),
      textStyle: { ...spTextStyle },
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

  // Assistant : nom du fichier signé
  $('sig-output-name').addEventListener('input', (e) => { sigWizard.outputName = e.target.value; });
  $('btn-manage-signers').addEventListener('click', () => showView('profiles'));

  // Assistant : mode de placement — commune (toutes les pages, 3 types)
  // ou autonome (certaines pages seulement, blocs indépendants)
  document.querySelectorAll('input[name="sig-scope"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      sigWizard.placementMode = radio.value === 'free'
        ? 'free'
        : (sigWizard.lastCommonMode || 'auto');
      updateSigPlaceModeUI();
      if (sigWizard.placementMode === 'auto') {
        applyAutoPlacements();
      } else {
        renderSigPlacements();
        updateSignButtonState();
      }
    });
  });
  document.querySelectorAll('input[name="sig-place-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      sigWizard.placementMode = radio.value;
      sigWizard.lastCommonMode = radio.value;
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
  $('btn-sig-cancel').addEventListener('click', () => {
    resetSignatureWizard(); // abandon : la reprise n'a plus de sens
    showView('signatures');
  });
  $('btn-sig-restart').addEventListener('click', () => {
    if (sigWizard.pdfBytes
      && !confirm('Recommencer ? Le PDF chargé et tous les réglages de cette signature seront effacés.')) {
      return;
    }
    resetSignatureWizard();
  });

  // Profils : signataires
  $('btn-new-signer').addEventListener('click', () => openSigProfileModal(null));
  $('sp-close').addEventListener('click', closeSigProfileModal);
  document.querySelector('#sigprofile-modal .modal-overlay').addEventListener('click', closeSigProfileModal);
  $('sp-form').addEventListener('submit', submitSigProfile);
  $('sp-name').addEventListener('input', () => { scheduleSpPreview(); scheduleSpBlockPreview(); });
  document.querySelectorAll('input[name="sp-style"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      updateSpPanes();
      updateSpPreview();
      scheduleSpBlockPreview();
    });
  });
  $('btn-sp-clear').addEventListener('click', () => {
    resetSpDrawCanvas();
    scheduleSpBlockPreview();
  });
  // écriture générée : style, lisibilité, nouvelle variante
  $('sp-hand-style').addEventListener('change', () => { updateSpPreview(); scheduleSpBlockPreview(); });
  $('sp-hand-bias').addEventListener('input', () => { scheduleSpPreview(); scheduleSpBlockPreview(); });
  $('btn-sp-variant').addEventListener('click', () => {
    spVariant += 1;
    updateSpPreview();
    scheduleSpBlockPreview();
  });
  // lignes du bloc (facultatives, en nombre libre)
  $('btn-sp-add-line').addEventListener('click', addSpLine);
  // style des textes du bloc
  $('sp-text-scale').addEventListener('input', (e) => {
    spTextStyle.scale = parseFloat(e.target.value) || 1;
    $('sp-text-scale-out').textContent = Math.round(spTextStyle.scale * 100) + ' %';
    scheduleSpBlockPreview();
  });
  $('sp-text-color').addEventListener('input', (e) => {
    spTextStyle.color = e.target.value;
    scheduleSpBlockPreview();
  });
  $('sp-text-font').addEventListener('change', (e) => {
    spTextStyle.font = e.target.value;
    scheduleSpBlockPreview();
  });
  spCanvasInit();

  // Les entreprises (modale, CRUD) sont gérées par js/companies.js
  // (page Entreprises partagée avec l'éditeur et la signature).
}
