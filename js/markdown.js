/* ============================================
   MARKDOWN (mode avancé)
   ------------------------------------------------------------
   Parseur minimaliste, sans dépendance :
   titres (#), listes (imbriquées, puces et numéros), gras/italique,
   code inline et en bloc (```), tableaux, liens http(s),
   lignes horizontales (---).
   Deux sorties : HTML sécurisé (aperçu) et objets pdfmake (PDF).
   Tout texte est échappé avant toute insertion de balise.
   ============================================ */

// --- Échappement ---

function mdEscapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Inline : découpage en tokens { text, bold, italics, code, link } ---

const MD_INLINE_RE =
  /`([^`]+)`|\*\*([^*]+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*([^*\n]+?)\*|_([^_\n]+?)_/g;

function mdInlineTokens(src) {
  const tokens = [];
  const s = String(src || '');
  const re = new RegExp(MD_INLINE_RE.source, 'g');
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) tokens.push({ text: s.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ text: m[1], code: true });
    else if (m[2] !== undefined) tokens.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) tokens.push({ text: m[3], link: m[4] });
    else if (m[5] !== undefined) tokens.push({ text: m[5], italics: true });
    else tokens.push({ text: m[6], italics: true });
    last = re.lastIndex;
  }
  if (last < s.length) tokens.push({ text: s.slice(last) });
  return tokens;
}

// --- Blocs ---

function mdIsListLine(s) {
  return /^(\s*)(?:[-*+]|\d+[.)])\s+/.test(s);
}

function mdIsTableRow(s) {
  return /^\s*\|.*\|\s*$/.test(s);
}

function mdParseBlocks(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // Bloc de code ``` ou ~~~
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const marker = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        buf.push(lines[i]);
        i++;
      }
      i++; // ligne de fermeture (ou fin de fichier)
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }

    // Titre
    const h = /^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, tokens: mdInlineTokens(h[2].trim()) });
      i++;
      continue;
    }

    // Ligne horizontale
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Tableau : ligne |...| suivie d'un séparateur | --- | --- |
    if (mdIsTableRow(line) && i + 1 < lines.length) {
      const sep = lines[i + 1];
      if (sep.includes('-') && sep.includes('|') && /^[\s|:-]+$/.test(sep)) {
        const splitRow = (s) =>
          s
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => mdInlineTokens(c.trim()));
        const rows = [splitRow(line)];
        i += 2;
        while (i < lines.length && mdIsTableRow(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        blocks.push({ type: 'table', rows });
        continue;
      }
    }

    // Liste (avec imbrication par indentation de 2 espaces).
    // Un changement de type de puce (non-ordonnée ↔ ordonnée) démarre
    // une nouvelle liste, comme en Markdown standard.
    if (mdIsListLine(line)) {
      const items = [];
      let blockOrdered = null;
      while (i < lines.length && mdIsListLine(lines[i])) {
        const m = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(lines[i]);
        const ordered = !!m[3];
        if (blockOrdered === null) blockOrdered = ordered;
        if (ordered !== blockOrdered) break;
        const indent = m[1].replace(/\t/g, '  ').length;
        items.push({
          depth: Math.min(Math.floor(indent / 2), 3),
          ordered,
          tokens: mdInlineTokens(m[4].trim()),
        });
        i++;
      }
      blocks.push({ type: 'list', ordered: blockOrdered, items });
      continue;
    }

    // Paragraphe : lignes consécutives jusqu'à bloc suivant
    const buf = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~)/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !mdIsTableRow(lines[i]) &&
      !mdIsListLine(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', tokens: mdInlineTokens(buf.join(' ')) });
  }

  return blocks;
}

// ============================================
// Sortie HTML (aperçu) — styles inline, cohérents avec la facture
// ============================================

const MD_MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

function mdInlineHTML(tokens) {
  return tokens
    .map((t) => {
      const esc = mdEscapeHTML(t.text);
      if (t.code) {
        return `<code style="background:#f1f5f9;border-radius:4px;padding:1px 5px;font-family:${MD_MONO};font-size:0.92em;color:#334155;">${esc}</code>`;
      }
      if (t.link) {
        return `<a href="${mdEscapeHTML(t.link)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">${esc}</a>`;
      }
      let out = esc;
      if (t.bold) out = `<strong>${out}</strong>`;
      if (t.italics) out = `<em>${out}</em>`;
      return out;
    })
    .join('');
}

function mdListHTML(block) {
  const build = (items) => {
    const base = items[0].depth;
    const out = [];
    let i = 0;
    while (i < items.length) {
      if (items[i].depth > base) {
        let j = i;
        while (j < items.length && items[j].depth > base) j++;
        const nested = items.slice(i, j);
        const tag = nested[0].ordered ? 'ol' : 'ul';
        out.push(
          `<${tag} style="font-size:13px;color:#475569;margin:2px 0 2px 16px;padding-left:18px;line-height:1.5;">${build(nested)}</${tag}>`
        );
        i = j;
      } else {
        out.push(`<li style="margin:2px 0;">${mdInlineHTML(items[i].tokens)}</li>`);
        i++;
      }
    }
    return out.join('');
  };
  const tag = block.ordered ? 'ol' : 'ul';
  return `<${tag} style="font-size:13px;color:#475569;margin:0 0 8px;padding-left:22px;line-height:1.55;">${build(block.items)}</${tag}>`;
}

function mdTableHTML(block) {
  const head = block.rows[0];
  const body = block.rows.slice(1);
  const th = head
    .map(
      (c) =>
        `<th style="padding:8px 10px;background:#f1f5f9;border-bottom:2px solid #cbd5e1;font-size:11px;font-weight:600;color:#475569;text-align:left;text-transform:uppercase;letter-spacing:0.03em;">${mdInlineHTML(c)}</th>`
    )
    .join('');
  const trs = body
    .map(
      (r) =>
        `<tr>${r
          .map(
            (c) =>
              `<td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;">${mdInlineHTML(c)}</td>`
          )
          .join('')}</tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin:6px 0 12px;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

function mdBlockHTML(b) {
  switch (b.type) {
    case 'heading': {
      const sizes = [19, 16, 14, 13, 12.5, 12];
      const lvl = b.level;
      return `<h${lvl} style="font-size:${sizes[lvl - 1]}px;font-weight:700;color:#1e293b;margin:${lvl <= 2 ? '14px' : '10px'} 0 6px;line-height:1.3;">${mdInlineHTML(b.tokens)}</h${lvl}>`;
    }
    case 'paragraph':
      return `<p style="font-size:13px;color:#475569;margin:0 0 8px;line-height:1.55;">${mdInlineHTML(b.tokens)}</p>`;
    case 'code':
      return `<pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;margin:6px 0 10px;font-family:${MD_MONO};font-size:11.5px;color:#334155;white-space:pre-wrap;">${mdEscapeHTML(b.text)}</pre>`;
    case 'hr':
      return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0;">`;
    case 'list':
      return mdListHTML(b);
    case 'table':
      return mdTableHTML(b);
    default:
      return '';
  }
}

function renderMarkdownHTML(md) {
  if (!md || !String(md).trim()) return '';
  return `<div class="md-content">${mdParseBlocks(md).map(mdBlockHTML).join('\n')}</div>`;
}

// ============================================
// Sortie pdfmake (PDF) — Roboto uniquement (polices vfs)
// ============================================

function mdInlinePdf(tokens, base) {
  const arr = tokens.map((t) => {
    const o = { text: t.text };
    if (t.bold || base.bold) o.bold = true;
    if (t.italics) o.italics = true;
    o.fontSize = base.fontSize;
    if (t.code) o.color = '#475569';
    else if (t.link) {
      o.link = t.link;
      o.color = '#2563eb';
    } else o.color = base.color;
    return o;
  });
  if (arr.length === 1 && Object.keys(arr[0]).length === 1) return arr[0].text;
  return arr;
}

function mdListPdf(block) {
  const build = (items, base) => {
    const out = [];
    let i = 0;
    while (i < items.length) {
      if (items[i].depth > base) {
        let j = i;
        while (j < items.length && items[j].depth > base) j++;
        const nested = items.slice(i, j);
        out.push(nested[0].ordered ? { ol: build(nested, nested[0].depth) } : { ul: build(nested, nested[0].depth) });
        i = j;
      } else {
        out.push(mdInlinePdf(items[i].tokens, { fontSize: 9, color: '#475569', bold: false }));
        i++;
      }
    }
    return out;
  };
  const node = { margin: [0, 0, 0, 8] };
  node[block.ordered ? 'ol' : 'ul'] = build(block.items, block.items[0].depth);
  return node;
}

function mdTablePdf(block) {
  const body = block.rows.map((r, ri) =>
    r.map((c) => mdInlinePdf(c, { fontSize: 9, color: '#475569', bold: ri === 0 }))
  );
  return {
    table: { headerRows: 1, body },
    layout: {
      hLineWidth: (i, node) => (i === 1 || i === node.table.body.length ? 1 : 0.5),
      vLineWidth: () => 0,
      hLineColor: (i) => (i <= 1 ? '#cbd5e1' : '#e2e8f0'),
      fillColor: (i) => (i === 0 ? '#f1f5f9' : null),
      paddingTop: () => 5,
      paddingBottom: () => 5,
      paddingLeft: () => 8,
      paddingRight: () => 8,
    },
    margin: [0, 4, 0, 10],
  };
}

function mdBlockPdf(b) {
  switch (b.type) {
    case 'heading': {
      const sizes = [15, 13, 11.5, 11, 10.5, 10.5];
      const lvl = b.level;
      return {
        text: mdInlinePdf(b.tokens, { fontSize: sizes[lvl - 1], color: '#1e293b', bold: true }),
        margin: [0, lvl <= 2 ? 10 : 8, 0, 3],
        lineHeight: 1.2,
      };
    }
    case 'paragraph':
      return {
        text: mdInlinePdf(b.tokens, { fontSize: 9, color: '#475569', bold: false }),
        margin: [0, 0, 0, 6],
        lineHeight: 1.3,
      };
    case 'code':
      return {
        table: {
          widths: ['*'],
          body: [[{ text: b.text, fontSize: 8, color: '#475569', lineHeight: 1.4 }]],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingTop: () => 8,
          paddingBottom: () => 8,
          paddingLeft: () => 10,
          paddingRight: () => 10,
          fillColor: () => '#f8fafc',
        },
        margin: [0, 4, 0, 10],
      };
    case 'hr':
      return {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e2e8f0' }],
        margin: [0, 8, 0, 8],
      };
    case 'list':
      return mdListPdf(b);
    case 'table':
      return mdTablePdf(b);
    default:
      return null;
  }
}

function markdownToPdfContent(md) {
  if (!md || !String(md).trim()) return [];
  return mdParseBlocks(md).map(mdBlockPdf).filter(Boolean);
}
