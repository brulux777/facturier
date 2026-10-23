/* ============================================
   SYNTHÈSE D'ÉCRITURE MANUSCRITE (IA)
   --------------------------------------------
   Enveloppe du moteur calligrapher.ai (RNN de
   Graves, voir vendor/handwriting/engine.js) :
   - chargement paresseux du moteur + des poids ;
   - aléatoire piloté par une graine : un même
     couple (texte, graine) redonne exactement les
     mêmes traits d'une fois sur l'autre ;
   - translittération des accents (le modèle ne
     connaît que l'ASCII) ;
   - sortie canvas rogné (dataUrl), prête à être
     incrustée dans les blocs de signature ;
   - file d'attente : le moteur ne traite qu'une
     génération à la fois ;
   - si le moteur est indisponible, les appelants
     retombent sur les polices manuscrites.
   ============================================ */

const HandwritingSynth = (() => {
  const ENGINE_URL = '/vendor/handwriting/engine.js';
  const CANVAS_W = 1240;   // largeur de référence du moteur (échelle interne)
  const CANVAS_H = 640;    // marge haute/basse autour de la ligne de base
  const STYLE_COUNT = 10;  // styles 0..9 (« - » = choisi par la graine)

  let loadPromise = null; // init (moteur + poids) — une seule fois
  let els = null;         // éléments DOM pilotés par le moteur
  let queue = Promise.resolve(); // sérialisation des générations
  const cache = new Map();      // clé → promesse {url, w, h}

  // ---------- aléatoire déterministe (mulberry32) ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Le moteur capture Math.random au moment de son évaluation. On lui
  // fournit donc un délégué dont la source peut être réinitialisée avant
  // chaque génération → résultats reproductibles par graine.
  const rngState = { fn: mulberry32(1) };
  const seededRandom = function () { return rngState.fn(); };

  // ---------- texte : accents → ASCII + caractères supportés ----------

  const TRANSLIT = {
    à: 'a', á: 'a', â: 'a', ä: 'a', ã: 'a', å: 'a',
    ç: 'c',
    é: 'e', è: 'e', ê: 'e', ë: 'e',
    í: 'i', ì: 'i', î: 'i', ï: 'i',
    ó: 'o', ò: 'o', ô: 'o', ö: 'o', õ: 'o',
    ú: 'u', ù: 'u', û: 'u', ü: 'u',
    ý: 'y', ÿ: 'y', ñ: 'n',
    œ: 'oe', æ: 'ae', ß: 'ss',
    '€': 'EUR', '°': ' deg ', '’': "'", '‘': "'",
    '«': '"', '»': '"', '“': '"', '”': '"',
    '–': '-', '—': '-', '…': '...',
  };
  // caractères reconnus par le modèle (carte H du moteur + espace)
  const SUPPORTED = new Set(
    ' !"#&\'()*+,-./0123456789:;?[]abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  );

  function sanitizeText(text) {
    let out = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('')
      .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
      .join('');
    out = out.split('').map((ch) => (SUPPORTED.has(ch) ? ch : ' ')).join('');
    return out.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim().slice(0, 220);
  }

  // ---------- chargement du moteur ----------

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const res = await fetch(ENGINE_URL);
      if (!res.ok) throw new Error('moteur introuvable (HTTP ' + res.status + ')');
      const src = await res.text();

      // Échafaudage DOM : le moteur lit/écrit ces éléments directement.
      const host = document.createElement('div');
      host.setAttribute('data-hw-synth', '');
      host.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;';
      host.innerHTML = `
        <svg id="canvas" xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}"></svg>
        <select id="select-style">
          <option value="-">alea</option>
          ${Array.from({ length: STYLE_COUNT }, (_, i) => `<option value="${i}">${i}</option>`).join('')}
        </select>
        <input id="bias-slider" type="range" min="0.15" max="2.5" step="0.02" value="0.75">
        <input id="speed-slider" type="range" min="0.6" max="9.51" step="0.1" value="9.51">
        <input id="width-slider" type="range" min="0.1" max="1.5" step="0.02" value="1.2">
        <input id="text-input" type="text">
        <button id="draw-button" type="button"></button>
        <button id="save-button" type="button"></button>
        <div id="loading-indicator"></div>`;
      document.body.appendChild(host);
      els = {
        host,
        svg: host.querySelector('#canvas'),
        style: host.querySelector('#select-style'),
        bias: host.querySelector('#bias-slider'),
        speed: host.querySelector('#speed-slider'),
        width: host.querySelector('#width-slider'),
        text: host.querySelector('#text-input'),
        draw: host.querySelector('#draw-button'),
        indicator: host.querySelector('#loading-indicator'),
      };

      // évalue le moteur en lui fournissant notre aléatoire piloté
      const prevRandom = Math.random;
      Math.random = seededRandom;
      let err = null;
      try {
        new Function(src)();
      } catch (e) {
        err = e;
      } finally {
        Math.random = prevRandom;
      }
      if (err) throw err;

      // les poids (/vendor/handwriting/d.bin) sont chargés en tâche de fond :
      // prêts quand l'indicateur de chargement est retiré du DOM
      await new Promise((resolve, reject) => {
        const t0 = Date.now();
        const poll = () => {
          if (!els.indicator.isConnected) return resolve();
          if (Date.now() - t0 > 90000) return reject(new Error('chargement des poids trop long'));
          setTimeout(poll, 120);
        };
        poll();
      });
      return true;
    })();
    loadPromise.catch(() => { loadPromise = null; }); // retry possible
    return loadPromise;
  }

  // ---------- rastérisation du SVG produit ----------

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('rendu illisible'));
      img.src = url;
    });
  }

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
    const pad = 6;
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

  async function rasterize(svg, ink) {
    svg.querySelectorAll('path').forEach((p) => {
      p.style.fill = ink;
      p.style.stroke = ink;
    });
    const ser = new XMLSerializer().serializeToString(svg);
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ser));
    const c = document.createElement('canvas');
    c.width = CANVAS_W;
    c.height = CANVAS_H;
    c.getContext('2d').drawImage(img, 0, 0);
    const trimmed = trimCanvas(c);
    if (!trimmed) throw new Error('aucun trait produit');
    return { url: trimmed.toDataURL('image/png'), w: trimmed.width, h: trimmed.height };
  }

  // ---------- génération (texte → traits) ----------

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  async function runGeneration(text, opts) {
    await load();
    els.text.value = text;
    els.style.value = String(opts.style);
    els.bias.value = String(clamp(opts.bias, 0.15, 2.5));
    els.width.value = String(clamp(opts.width, 0.1, 1.5));
    els.speed.value = '9.51';
    rngState.fn = mulberry32((opts.seed >>> 0) || 1);

    const svg = els.svg;
    while (svg.lastChild) svg.removeChild(svg.lastChild);

    // rAF → setTimeout : la boucle d'animation du moteur devient une suite
    // de tâches asynchrones (l'UI reste réactive). La génération est finie
    // quand le moteur ne planifie plus de frame.
    let lastFrameAt = Date.now();
    let frameId = 0;
    const prevRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      lastFrameAt = Date.now();
      frameId += 1;
      const id = frameId;
      setTimeout(() => cb(performance.now()), 0);
      return id;
    };
    let dispatchErr = null;
    try {
      els.draw.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } catch (e) {
      dispatchErr = e;
    }
    if (dispatchErr) {
      window.requestAnimationFrame = prevRaf;
      throw dispatchErr;
    }

    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => {
        const idle = Date.now() - lastFrameAt > 170;
        if (idle) {
          window.requestAnimationFrame = prevRaf;
          if (svg.childNodes.length) return resolve();
          return reject(new Error('aucune écriture générée'));
        }
        if (Date.now() - t0 > 45000) {
          window.requestAnimationFrame = prevRaf;
          return reject(new Error('génération trop lente'));
        }
        setTimeout(poll, 60);
      };
      setTimeout(poll, 150);
    });

    return rasterize(svg, opts.ink || '#111827');
  }

  /**
   * Génère une ligne d'écriture manuscrite.
   * opts : { style: '-'|'0'..'9', bias: 0.15–2.5 (lisibilité),
   *          width: 0.1–1.5 (épaisseur), seed: entier,
   *          ink: couleur } — résultat en cache.
   */
  function generate(text, opts = {}) {
    const clean = sanitizeText(text);
    if (!clean) return Promise.reject(new Error('texte vide'));
    const norm = {
      text: clean,
      style: (opts.style === undefined || opts.style === null || String(opts.style) === '')
        ? '-' : String(opts.style),
      bias: +clamp(opts.bias === undefined ? 0.75 : opts.bias, 0.15, 2.5).toFixed(2),
      width: +clamp(opts.width === undefined ? 1.2 : opts.width, 0.1, 1.5).toFixed(2),
      seed: (opts.seed >>> 0) || 1,
      ink: opts.ink || '#111827',
    };
    const key = JSON.stringify(norm);
    if (cache.has(key)) return cache.get(key);

    const job = queue.then(() => runGeneration(norm.text, norm));
    queue = job.catch(() => {}); // la file continue même si un texte échoue
    const cached = job;
    cache.set(key, cached);
    cached.catch(() => cache.delete(key)); // échec → pas de poison en cache
    return cached;
  }

  return {
    generate,
    load,
    hashStr,
    STYLE_COUNT,
    get available() { return !!loadPromise; },
  };
})();
