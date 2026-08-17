/* ============================================
   PDF & PREVIEW
   ============================================ */

// --- HTML Preview (modal) ---

function buildInvoiceHTML(data) {
  const s = data.settings || state.settings;
  const c = data.client;
  const typeLabel = data.type === 'invoice' ? 'FACTURE' : 'DEVIS';

  let logoHTML = '';
  if (s.logo) {
    logoHTML = `<img src="${s.logo}" style="max-height:50px;" alt="Logo">`;
  }

  const companyLines = [
    s.address,
    [s.postalCode, s.city].filter(Boolean).join(' '),
  ].filter(Boolean);
  const companyContact = [s.phone, s.email].filter(Boolean).join(' \u2014 ');
  const companyIds = [
    s.siret ? `SIRET: ${s.siret}` : '',
    s.tvaNumber ? `TVA: ${s.tvaNumber}` : '',
  ]
    .filter(Boolean)
    .join(' \u2014 ');

  const clientLines = [
    c.address,
    [c.postalCode, c.city].filter(Boolean).join(' '),
  ].filter(Boolean);

  const tvaExempt = !!s.tvaExempt;

  // Cellule Titre (gras) + Description (en dessous, plus discrète)
  const itemCellHTML = (item) => {
    const titleHTML = item.title && item.title.trim()
      ? `<div style="font-weight:600;">${escapeHTML(item.title)}</div>`
      : '';
    const descHTML = item.description && item.description.trim()
      ? `<div style="font-size:11px;color:#64748b;margin-top:${titleHTML ? '2' : '0'}px;white-space:pre-wrap;">${escapeHTML(item.description)}</div>`
      : '';
    return titleHTML + descHTML;
  };

  const itemRows = data.items
    .filter((i) => (i.title && i.title.trim()) || i.description.trim())
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${itemCellHTML(item)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${item.quantity}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;">${formatCurrency(item.unitPrice)}</td>
        ${tvaExempt ? '' : `<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${item.tvaRate}%</td>`}
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;font-weight:500;">${formatCurrency(round2(item.quantity * item.unitPrice))}</td>
      </tr>
    `
    )
    .join('');

  // Échéancier (paiement en 3 fois) — sur le reste dû : net à payer
  // si un acompte est déduit (facture), sinon le total TTC.
  const acompte = data.totals.acompte || 0;
  const isInvoice = data.type === 'invoice';
  const installmentsBase =
    data.totals.netAPayer != null
      ? data.totals.netAPayer
      : round2(data.totals.totalTTC - acompte);
  const installments = data.payment3x
    ? computeInstallments3x(installmentsBase, data.dueDate || data.date)
    : null;

  // Lignes acompte du tableau des totaux :
  // facture → déduction rouge + net à payer ; devis → mention grise.
  const acompteRowHTML =
    acompte > 0
      ? isInvoice
        ? `
          <tr>
            <td style="padding:5px 10px;font-size:13px;color:#dc2626;">Acompte versé${data.totals.acompteDate ? ` le ${formatDate(data.totals.acompteDate)}` : ''}</td>
            <td style="padding:5px 10px;text-align:right;font-size:13px;color:#dc2626;font-weight:600;">- ${formatCurrency(acompte)}</td>
          </tr>`
        : `
          <tr>
            <td style="padding:5px 10px;font-size:13px;color:#64748b;">Acompte à la commande${formatPercentValue(data.totals.acomptePercent) ? ` (${formatPercentValue(data.totals.acomptePercent)})` : ''}</td>
            <td style="padding:5px 10px;text-align:right;font-size:13px;">${formatCurrency(acompte)}</td>
          </tr>`
      : '';
  const netAPayerRowHTML =
    isInvoice && acompte > 0 && data.totals.netAPayer != null
      ? `
          <tr style="border-top:2px solid #2563eb;">
            <td style="padding:10px;font-size:15px;font-weight:700;color:#1e293b;">Net à payer</td>
            <td style="padding:10px;text-align:right;font-size:15px;font-weight:700;color:#2563eb;">${formatCurrency(data.totals.netAPayer)}</td>
          </tr>`
      : '';
  // Cahier des charges (Markdown) — placement selon data.cdcMode :
  //   'inline'    : intégré à la facture, après les totaux
  //   'annex'     : hors facture, en annexe du même PDF (page séparée)
  //   'separate'  : hors facture, dans un second PDF téléchargé à part
  const cdcFilled = !!(data.cahierDesCharges && data.cahierDesCharges.trim());
  const cdcMode = data.cdcMode || 'inline';
  const cdcTitleHTML = `
    <div style="font-size:16px;font-weight:700;color:#1e293b;">Cahier des charges</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px;">Annexe ${typeLabel === 'FACTURE' ? 'de la facture' : 'du devis'} n\u00b0 ${escapeHTML(data.number)} \u2014 ${formatDate(data.date)}</div>
  `;
  let cdcHTML = '';
  if (cdcFilled && cdcMode === 'inline') {
    cdcHTML = `
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;">
        <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:8px;">Cahier des charges</div>
        ${renderMarkdownHTML(data.cahierDesCharges)}
      </div>
    `;
  }
  const cdcAnnexHTML =
    cdcFilled && cdcMode === 'annex'
      ? `
      <div style="margin-top:36px;padding-top:14px;border-top:2px dashed #cbd5e1;text-align:center;font-size:10px;color:#94a3b8;letter-spacing:0.05em;">ANNEXE \u2014 PAGE S\u00c9PAR\u00c9E DANS LE PDF</div>
      <div style="margin-top:18px;">
        ${cdcTitleHTML}
        <div style="margin-top:12px;">${renderMarkdownHTML(data.cahierDesCharges)}</div>
      </div>
    `
      : '';
  const cdcSeparateNote =
    cdcFilled && cdcMode === 'separate'
      ? `
      <div style="margin-top:16px;font-size:11px;color:#64748b;">Cahier des charges : non inclus dans ce document \u2014 g\u00e9n\u00e9r\u00e9 dans un PDF s\u00e9par\u00e9 (${escapeHTML(data.number)}-cahier-des-charges.pdf).</div>
    `
      : '';

  const tvaRows = tvaExempt ? '' : data.totals.tvaBreakdown
    .map(
      (b) => `
      <tr>
        <td style="padding:5px 10px;font-size:13px;color:#64748b;">TVA ${b.rate}% (sur ${formatCurrency(b.base)})</td>
        <td style="padding:5px 10px;text-align:right;font-size:13px;">${formatCurrency(b.tva)}</td>
      </tr>
    `
    )
    .join('');

  const paymentInfo =
    s.defaultPaymentTerms || s.iban || installments || (!isInvoice && acompte > 0)
      ? `
      <div style="margin-top:24px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
        <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.03em;">Modalit\u00e9s de paiement</div>
        ${s.defaultPaymentTerms ? `<div style="font-size:12px;color:#475569;">Mode : ${escapeHTML(s.defaultPaymentTerms)}</div>` : ''}
        ${data.dueDate ? `<div style="font-size:12px;color:#475569;">\u00c9ch\u00e9ance : ${formatDate(data.dueDate)}</div>` : ''}
        ${!isInvoice && acompte > 0 ? `<div style="font-size:12px;color:#475569;font-weight:600;margin-top:8px;">Acompte \u00e0 la commande : ${formatCurrency(acompte)}${formatPercentValue(data.totals.acomptePercent) ? ` (${formatPercentValue(data.totals.acomptePercent)})` : ''} \u2014 solde : ${formatCurrency(round2(data.totals.totalTTC - acompte))}</div>` : ''}
        ${installments ? `
        <div style="font-size:12px;color:#475569;font-weight:600;margin-top:8px;">Paiement en 3 fois${acompte > 0 ? ` — reste dû ${formatCurrency(installmentsBase)} (${formatCurrency(data.totals.totalTTC)} − acompte ${formatCurrency(acompte)} ${isInvoice ? 'déjà versé' : 'à la commande'}), dilué sur 3 mois` : ''} :</div>
        ${installments.map((e) => `<div style="font-size:12px;color:#475569;">${e.label} (${formatDate(e.date)}) : <strong>${formatCurrency(e.amount)}</strong></div>`).join('')}
        ` : ''}
        ${s.bank ? `<div style="font-size:12px;color:#475569;margin-top:6px;">Banque : ${escapeHTML(s.bank)}</div>` : ''}
        ${s.iban ? `<div style="font-size:12px;color:#475569;">IBAN : ${escapeHTML(s.iban)}</div>` : ''}
        ${s.bic ? `<div style="font-size:12px;color:#475569;">BIC : ${escapeHTML(s.bic)}</div>` : ''}
      </div>
    `
      : '';

  const notesHTML = data.notes
    ? `
      <div style="margin-top:16px;">
        <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;">Notes</div>
        <div style="font-size:12px;color:#475569;white-space:pre-wrap;">${escapeHTML(data.notes)}</div>
      </div>
    `
    : '';

  const tvaExemptMention = 'TVA non applicable, art. 293 B du CGI';
  const allLegalMentions = tvaExempt
    ? [tvaExemptMention, s.legalMentions].filter(Boolean).join('\n')
    : s.legalMentions;

  const legalHTML = allLegalMentions
    ? `
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;">
        ${tvaExempt ? `<div style="font-size:11px;font-weight:600;color:#475569;margin-bottom:4px;">TVA non applicable, art. 293 B du CGI</div>` : ''}
        ${s.legalMentions ? `<div style="font-size:10px;color:#94a3b8;line-height:1.5;">${escapeHTML(s.legalMentions)}</div>` : ''}
      </div>
    `
    : '';

  return `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1e293b;padding:40px;max-width:780px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;">
        <div>
          ${logoHTML}
          <div style="font-size:16px;font-weight:700;color:#1e293b;margin-top:${s.logo ? '8' : '0'}px;">${escapeHTML(s.companyName)}</div>
          ${companyLines.map((l) => `<div style="font-size:12px;color:#64748b;">${escapeHTML(l)}</div>`).join('')}
          ${companyContact ? `<div style="font-size:12px;color:#64748b;margin-top:4px;">${escapeHTML(companyContact)}</div>` : ''}
          ${companyIds ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${escapeHTML(companyIds)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:700;color:#2563eb;letter-spacing:0.02em;">${typeLabel}</div>
          <div style="font-size:14px;font-weight:600;color:#1e293b;margin-top:4px;">N\u00b0 ${escapeHTML(data.number)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Date : ${formatDate(data.date)}</div>
          ${data.dueDate ? `<div style="font-size:12px;color:#64748b;">\u00c9ch\u00e9ance : ${formatDate(data.dueDate)}</div>` : ''}
        </div>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;margin-bottom:28px;max-width:320px;margin-left:auto;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Destinataire</div>
        <div style="font-size:14px;font-weight:600;color:#1e293b;">${escapeHTML(c.name)}</div>
        ${clientLines.map((l) => `<div style="font-size:12px;color:#475569;">${escapeHTML(l)}</div>`).join('')}
        ${c.siret ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">SIRET: ${escapeHTML(c.siret)}</div>` : ''}
      </div>

      ${data.title ? `<div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:16px;">${escapeHTML(data.title)}</div>` : ''}

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:10px;text-align:left;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;">D\u00e9signation</th>
            <th style="padding:10px;text-align:center;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:60px;">Qt\u00e9</th>
            <th style="padding:10px;text-align:right;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:100px;">PU HT</th>
            ${tvaExempt ? '' : '<th style="padding:10px;text-align:center;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:60px;">TVA</th>'}
            <th style="padding:10px;text-align:right;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:110px;">Total HT</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;">
        <table style="border-collapse:collapse;min-width:260px;">
          ${data.totals.discountPercent > 0 ? `<tr>
            <td style="padding:5px 10px;font-size:13px;color:#64748b;">Total HT brut</td>
            <td style="padding:5px 10px;text-align:right;font-size:13px;font-weight:600;">${formatCurrency(data.totals.totalHTBrut)}</td>
          </tr>
          <tr>
            <td style="padding:5px 10px;font-size:13px;color:#dc2626;">Remise (${data.totals.discountPercent}%)</td>
            <td style="padding:5px 10px;text-align:right;font-size:13px;color:#dc2626;font-weight:600;">- ${formatCurrency(data.totals.discountAmount)}</td>
          </tr>
          <tr>
            <td style="padding:5px 10px;font-size:13px;color:#64748b;">Total HT net</td>
            <td style="padding:5px 10px;text-align:right;font-size:13px;font-weight:600;">${formatCurrency(data.totals.totalHT)}</td>
          </tr>` : `<tr>
            <td style="padding:5px 10px;font-size:13px;color:#64748b;">Total HT</td>
            <td style="padding:5px 10px;text-align:right;font-size:13px;font-weight:600;">${formatCurrency(data.totals.totalHTBrut)}</td>
          </tr>`}
          ${!tvaExempt ? tvaRows : ''}
          <tr style="border-top:2px solid #2563eb;">
            <td style="padding:10px;font-size:15px;font-weight:700;color:#1e293b;">Total TTC</td>
            <td style="padding:10px;text-align:right;font-size:15px;font-weight:700;color:#2563eb;">${formatCurrency(data.totals.totalTTC)}</td>
          </tr>
          ${acompteRowHTML}
          ${netAPayerRowHTML}
        </table>
      </div>

      ${cdcHTML}
      ${notesHTML}
      ${paymentInfo}
      ${cdcSeparateNote}
      ${legalHTML}
      ${cdcAnnexHTML}
    </div>
  `;
}

function showPreview() {
  const data = collectInvoiceData();
  if (!validateInvoice(data)) return;

  const html = buildInvoiceHTML(data);
  document.getElementById('invoice-preview').innerHTML = html;
  document.getElementById('preview-modal').classList.add('active');
}

function closePreview() {
  document.getElementById('preview-modal').classList.remove('active');
}

// --- pdfmake PDF Generation ---

function buildPdfDefinition(data) {
  const s = data.settings || state.settings;
  const c = data.client;
  const typeLabel = data.type === 'invoice' ? 'FACTURE' : 'DEVIS';
  const tvaExempt = !!s.tvaExempt;
  const blue = '#2563eb';
  const gray = '#64748b';
  const muted = '#94a3b8';
  const dark = '#1e293b';

  const companyLines = [
    s.address,
    [s.postalCode, s.city].filter(Boolean).join(' '),
  ].filter(Boolean);
  const companyContact = [s.phone, s.email].filter(Boolean).join(' \u2014 ');
  const companyIdParts = [
    s.siret ? `SIRET: ${s.siret}` : '',
    s.tvaNumber ? `TVA: ${s.tvaNumber}` : '',
  ].filter(Boolean);

  const clientLines = [
    c.address,
    [c.postalCode, c.city].filter(Boolean).join(' '),
  ].filter(Boolean);

  // --- Header columns ---
  const leftCol = [];
  if (s.logo) {
    leftCol.push({ image: s.logo, fit: [180, 50], margin: [0, 0, 0, 4] });
  }
  leftCol.push({ text: s.companyName, fontSize: 13, bold: true, color: dark });
  companyLines.forEach((l) => leftCol.push({ text: l, fontSize: 9, color: gray }));
  if (companyContact) leftCol.push({ text: companyContact, fontSize: 9, color: gray, margin: [0, 3, 0, 0] });
  if (companyIdParts.length) leftCol.push({ text: companyIdParts.join(' \u2014 '), fontSize: 8, color: muted, margin: [0, 2, 0, 0] });

  const rightCol = [];
  rightCol.push({ text: typeLabel, fontSize: 20, bold: true, color: blue, alignment: 'right' });
  rightCol.push({ text: `N\u00b0 ${data.number}`, fontSize: 12, bold: true, color: dark, alignment: 'right', margin: [0, 4, 0, 0] });
  rightCol.push({ text: `Date : ${formatDate(data.date)}`, fontSize: 9, color: gray, alignment: 'right', margin: [0, 4, 0, 0] });
  if (data.dueDate) rightCol.push({ text: `\u00c9ch\u00e9ance : ${formatDate(data.dueDate)}`, fontSize: 9, color: gray, alignment: 'right' });

  // --- Client block ---
  const clientBlock = [];
  clientBlock.push({ text: 'DESTINATAIRE', fontSize: 8, bold: true, color: muted, margin: [0, 0, 0, 4] });
  clientBlock.push({ text: c.name, fontSize: 12, bold: true, color: dark });
  clientLines.forEach((l) => clientBlock.push({ text: l, fontSize: 9, color: '#475569' }));
  if (c.siret) clientBlock.push({ text: `SIRET: ${c.siret}`, fontSize: 8, color: muted, margin: [0, 3, 0, 0] });

  // --- Tableau des prestations ---
  const filteredItems = data.items.filter(
    (i) => (i.title && i.title.trim()) || i.description.trim()
  );
  const tableHeader = [
    { text: 'D\u00e9signation', style: 'tableHeader' },
    { text: 'Qt\u00e9', style: 'tableHeader', alignment: 'center' },
    { text: 'PU HT', style: 'tableHeader', alignment: 'right' },
  ];
  if (!tvaExempt) tableHeader.push({ text: 'TVA', style: 'tableHeader', alignment: 'center' });
  tableHeader.push({ text: 'Total HT', style: 'tableHeader', alignment: 'right' });

  const tableBody = [tableHeader];
  filteredItems.forEach((item) => {
    // Titre en gras + description en dessous, plus petite
    const designationCell =
      item.title && item.title.trim()
        ? {
            stack: [
              { text: item.title, fontSize: 9, bold: true },
              ...(item.description && item.description.trim()
                ? [{ text: item.description, fontSize: 8, color: gray, margin: [0, 2, 0, 0] }]
                : []),
            ],
          }
        : { text: item.description, fontSize: 9 };
    const row = [
      designationCell,
      { text: String(item.quantity), fontSize: 9, alignment: 'center' },
      { text: formatCurrency(item.unitPrice), fontSize: 9, alignment: 'right' },
    ];
    if (!tvaExempt) row.push({ text: `${item.tvaRate}%`, fontSize: 9, alignment: 'center' });
    row.push({ text: formatCurrency(round2(item.quantity * item.unitPrice)), fontSize: 9, alignment: 'right', bold: true });
    tableBody.push(row);
  });

  // --- Totals ---
  // Mentions HT/TTC toujours présentes, même si TVA non applicable
  // (total HT = total TTC dans ce cas).
  const hasDiscount = data.totals.discountPercent > 0;
  // Acompte : déduit en facture (net à payer), mentionné en devis
  const acompte = data.totals.acompte || 0;
  const isInvoice = data.type === 'invoice';
  const acompteDeduction = isInvoice && acompte > 0;
  const totalsBody = [];
  if (hasDiscount) {
    totalsBody.push([
      { text: 'Total HT brut', fontSize: 9, color: gray },
      { text: formatCurrency(data.totals.totalHTBrut), fontSize: 9, bold: true, alignment: 'right' },
    ]);
    totalsBody.push([
      { text: `Remise (${data.totals.discountPercent}%)`, fontSize: 9, color: '#dc2626' },
      { text: `- ${formatCurrency(data.totals.discountAmount)}`, fontSize: 9, color: '#dc2626', alignment: 'right' },
    ]);
    totalsBody.push([
      { text: 'Total HT net', fontSize: 9, color: gray },
      { text: formatCurrency(data.totals.totalHT), fontSize: 9, bold: true, alignment: 'right' },
    ]);
  } else {
    totalsBody.push([
      { text: 'Total HT', fontSize: 9, color: gray },
      { text: formatCurrency(data.totals.totalHTBrut), fontSize: 9, bold: true, alignment: 'right' },
    ]);
  }
  if (!tvaExempt) {
    data.totals.tvaBreakdown.forEach((b) => {
      totalsBody.push([
        { text: `TVA ${b.rate}% (sur ${formatCurrency(b.base)})`, fontSize: 9, color: gray },
        { text: formatCurrency(b.tva), fontSize: 9, alignment: 'right' },
      ]);
    });
  }
  totalsBody.push([
    {
      text: 'Total TTC',
      fontSize: acompteDeduction ? 10 : 13,
      bold: true,
      color: dark,
      margin: [0, 4, 0, 0],
    },
    {
      text: formatCurrency(data.totals.totalTTC),
      fontSize: acompteDeduction ? 10 : 13,
      bold: true,
      color: acompteDeduction ? dark : blue,
      alignment: 'right',
      margin: [0, 4, 0, 0],
    },
  ]);
  if (acompteDeduction) {
    totalsBody.push([
      {
        text: `Acompte versé${data.totals.acompteDate ? ` le ${formatDate(data.totals.acompteDate)}` : ''}`,
        fontSize: 9,
        color: '#dc2626',
      },
      { text: `- ${formatCurrency(acompte)}`, fontSize: 9, color: '#dc2626', alignment: 'right' },
    ]);
    totalsBody.push([
      { text: 'Net à payer', fontSize: 13, bold: true, color: dark, margin: [0, 4, 0, 0] },
      {
        text: formatCurrency(data.totals.netAPayer),
        fontSize: 13,
        bold: true,
        color: blue,
        alignment: 'right',
        margin: [0, 4, 0, 0],
      },
    ]);
  } else if (!isInvoice && acompte > 0) {
    totalsBody.push([
      {
        text: `Acompte à la commande${formatPercentValue(data.totals.acomptePercent) ? ` (${formatPercentValue(data.totals.acomptePercent)})` : ''}`,
        fontSize: 9,
        color: gray,
      },
      { text: formatCurrency(acompte), fontSize: 9, bold: true, alignment: 'right' },
    ]);
  }

  // --- Build content ---
  const content = [];

  content.push({
    columns: [
      { width: '*', stack: leftCol },
      { width: 160, stack: rightCol },
    ],
    margin: [0, 0, 0, 24],
  });

  content.push({
    columns: [
      { width: '*', text: '' },
      {
        width: 240,
        stack: clientBlock,
        fillColor: '#f8fafc',
        margin: [0, 0, 0, 20],
        padding: [12, 10, 12, 10],
      },
    ],
    margin: [0, 0, 0, 20],
  });

  if (data.title) {
    content.push({ text: data.title, fontSize: 14, bold: true, color: dark, margin: [0, 0, 0, 12] });
  }

  content.push({
    table: {
      headerRows: 1,
      widths: tvaExempt ? ['*', 40, 70, 80] : ['*', 40, 70, 40, 80],
      body: tableBody,
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5,
      vLineWidth: () => 0,
      hLineColor: (i) => i <= 1 ? '#cbd5e1' : '#e2e8f0',
      fillColor: (i) => i === 0 ? '#f1f5f9' : null,
      paddingTop: () => 7,
      paddingBottom: () => 7,
      paddingLeft: () => 8,
      paddingRight: () => 8,
    },
    margin: [0, 0, 0, 16],
  });

  content.push({
    columns: [
      { width: '*', text: '' },
      {
        width: 220,
        table: { widths: ['*', 'auto'], body: totalsBody },
        layout: {
          hLineWidth: (i, node) => i === node.table.body.length - 1 ? 2 : 0,
          vLineWidth: () => 0,
          hLineColor: () => blue,
          paddingTop: () => 3,
          paddingBottom: () => 3,
          paddingLeft: () => 6,
          paddingRight: () => 6,
        },
      },
    ],
    margin: [0, 0, 0, 16],
  });

  // Cahier des charges (Markdown) — 'inline' : intégré après les totaux.
  // ('annex' : page dédiée en fin de PDF ; 'separate' : rien ici, PDF à part)
  const cdcFilled = !!(data.cahierDesCharges && data.cahierDesCharges.trim());
  const cdcMode = data.cdcMode || 'inline';
  if (cdcFilled && cdcMode === 'inline') {
    content.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e2e8f0' }],
      margin: [0, 10, 0, 6],
    });
    content.push({ text: 'Cahier des charges', fontSize: 10, bold: true, color: '#334155', margin: [0, 0, 0, 6] });
    markdownToPdfContent(data.cahierDesCharges).forEach((block) => content.push(block));
  }

  if (data.notes) {
    content.push({ text: 'Notes', fontSize: 9, bold: true, color: '#334155', margin: [0, 8, 0, 3] });
    content.push({ text: data.notes, fontSize: 9, color: '#475569', margin: [0, 0, 0, 12] });
  }

  // Échéancier (paiement en 3 fois) — sur le reste dû : net à payer
  // si un acompte est déduit (facture), sinon le total TTC moins l'acompte.
  const installmentsBase =
    data.totals.netAPayer != null
      ? data.totals.netAPayer
      : round2(data.totals.totalTTC - acompte);
  const installments = data.payment3x
    ? computeInstallments3x(installmentsBase, data.dueDate || data.date)
    : null;

  if (s.defaultPaymentTerms || s.iban || installments || (!isInvoice && acompte > 0)) {
    const paymentStack = [];
    paymentStack.push({ text: 'MODALIT\u00c9S DE PAIEMENT', fontSize: 8, bold: true, color: '#334155', margin: [0, 0, 0, 5] });
    if (s.defaultPaymentTerms) paymentStack.push({ text: `Mode : ${s.defaultPaymentTerms}`, fontSize: 9, color: '#475569' });
    if (data.dueDate) paymentStack.push({ text: `\u00c9ch\u00e9ance : ${formatDate(data.dueDate)}`, fontSize: 9, color: '#475569' });
    if (installments) {
      paymentStack.push({
        text: `Paiement en 3 fois${acompte > 0 ? ` — reste dû ${formatCurrency(installmentsBase)} (${formatCurrency(data.totals.totalTTC)} − acompte ${formatCurrency(acompte)} ${isInvoice ? 'déjà versé' : 'à la commande'}), dilué sur 3 mois` : ''} :`,
        fontSize: 9,
        bold: true,
        color: '#475569',
        margin: [0, 4, 0, 0],
      });
      installments.forEach((e) => {
        paymentStack.push({
          columns: [
            { width: '*', text: `${e.label} (${formatDate(e.date)})`, fontSize: 9, color: '#475569' },
            { width: 'auto', text: formatCurrency(e.amount), fontSize: 9, bold: true, color: '#475569', alignment: 'right' },
          ],
        });
      });
    }
    if (!isInvoice && acompte > 0) {
      paymentStack.push({
        text: `Acompte à la commande : ${formatCurrency(acompte)}${formatPercentValue(data.totals.acomptePercent) ? ` (${formatPercentValue(data.totals.acomptePercent)})` : ''} \u2014 solde : ${formatCurrency(round2(data.totals.totalTTC - acompte))}`,
        fontSize: 9,
        bold: true,
        color: '#475569',
        margin: [0, 4, 0, 0],
      });
    }
    if (s.bank) paymentStack.push({ text: `Banque : ${s.bank}`, fontSize: 9, color: '#475569', margin: [0, 4, 0, 0] });
    if (s.iban) paymentStack.push({ text: `IBAN : ${s.iban}`, fontSize: 9, color: '#475569' });
    if (s.bic) paymentStack.push({ text: `BIC : ${s.bic}`, fontSize: 9, color: '#475569' });
    content.push({
      stack: paymentStack,
      fillColor: '#f8fafc',
      margin: [0, 8, 0, 12],
      padding: [10, 8, 10, 8],
    });
  }

  if (tvaExempt || s.legalMentions) {
    content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e2e8f0' }], margin: [0, 12, 0, 8] });
    if (tvaExempt) {
      content.push({ text: 'TVA non applicable, art. 293 B du CGI', fontSize: 8, bold: true, color: '#475569', margin: [0, 0, 0, 4] });
    }
    if (s.legalMentions) {
      content.push({ text: s.legalMentions, fontSize: 7, color: muted, lineHeight: 1.4 });
    }
  }

  // Cahier des charges 'annex' : hors facture, sur une page dédiée du même PDF
  if (cdcFilled && cdcMode === 'annex') {
    cdcAnnexPdfBlocks(data, true).forEach((block) => content.push(block));
  }

  return {
    content,
    defaultStyle: { font: 'Roboto' },
    styles: {
      tableHeader: { fontSize: 8, bold: true, color: '#475569', fillColor: '#f1f5f9' },
    },
    pageMargins: [40, 30, 40, 30],
    info: {
      title: `${typeLabel} ${data.number}`,
      author: s.companyName,
    },
  };
}

// Blocs d'en-tête + contenu du cahier des charges en annexe.
// withPageBreak=true → nouvelle page (mode 'annex' dans le même PDF) ;
// false → document autonome (mode 'separate', second PDF).
function cdcAnnexPdfBlocks(data, withPageBreak) {
  const typeLabel = data.type === 'invoice' ? 'FACTURE' : 'DEVIS';
  const blocks = [];
  blocks.push({
    text: 'CAHIER DES CHARGES',
    fontSize: 16,
    bold: true,
    color: '#2563eb',
    ...(withPageBreak ? { pageBreak: 'before' } : {}),
    margin: [0, 0, 0, 2],
  });
  blocks.push({
    text: `Annexe ${typeLabel === 'FACTURE' ? 'de la facture' : 'du devis'} n\u00b0 ${data.number} \u2014 ${formatDate(data.date)}`,
    fontSize: 9,
    color: '#64748b',
    margin: [0, 0, 0, 2],
  });
  if (data.client && data.client.name) {
    blocks.push({ text: `Destinataire : ${data.client.name}`, fontSize: 9, color: '#64748b' });
  }
  blocks.push({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#cbd5e1' }],
    margin: [0, 10, 0, 12],
  });
  markdownToPdfContent(data.cahierDesCharges).forEach((block) => blocks.push(block));
  return blocks;
}

// PDF autonome du cahier des charges (mode 'separate')
function buildCahierDesChargesPdfDefinition(data) {
  const s = data.settings || state.settings;
  return {
    content: cdcAnnexPdfBlocks(data, false),
    defaultStyle: { font: 'Roboto' },
    pageMargins: [40, 40, 40, 40],
    info: {
      title: `Cahier des charges ${data.number}`,
      author: s.companyName,
    },
  };
}

function downloadPDF() {
  if (typeof pdfMake === 'undefined') {
    showToast('Biblioth\u00e8que PDF non charg\u00e9e', 'error');
    return;
  }

  const data = collectInvoiceData();
  if (!validateInvoice(data)) return;

  const cdcFilled = !!(data.cahierDesCharges && data.cahierDesCharges.trim());
  pdfMake.createPdf(buildPdfDefinition(data)).download(`${data.number}.pdf`);

  // Cahier des charges en PDF séparé (léger délai : certains navigateurs
  // bloquent deux téléchargements simultanés)
  if (cdcFilled && data.cdcMode === 'separate') {
    setTimeout(() => {
      pdfMake
        .createPdf(buildCahierDesChargesPdfDefinition(data))
        .download(`${data.number}-cahier-des-charges.pdf`);
    }, 500);
    showToast('PDF t\u00e9l\u00e9charg\u00e9 + cahier des charges s\u00e9par\u00e9');
    return;
  }

  showToast('PDF t\u00e9l\u00e9charg\u00e9');
}
