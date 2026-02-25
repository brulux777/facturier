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

  const itemRows = data.items
    .filter((i) => i.description.trim())
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${escapeHTML(item.description)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${item.quantity}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;">${formatCurrency(item.unitPrice)}</td>
        ${tvaExempt ? '' : `<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${item.tvaRate}%</td>`}
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;font-weight:500;">${formatCurrency(round2(item.quantity * item.unitPrice))}</td>
      </tr>
    `
    )
    .join('');

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
    s.defaultPaymentTerms || s.iban
      ? `
      <div style="margin-top:24px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
        <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.03em;">Modalit\u00e9s de paiement</div>
        ${s.defaultPaymentTerms ? `<div style="font-size:12px;color:#475569;">Mode : ${escapeHTML(s.defaultPaymentTerms)}</div>` : ''}
        ${data.dueDate ? `<div style="font-size:12px;color:#475569;">\u00c9ch\u00e9ance : ${formatDate(data.dueDate)}</div>` : ''}
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
          ${data.title ? `<div style="font-size:12px;color:#475569;font-style:italic;margin-top:4px;">${escapeHTML(data.title)}</div>` : ''}
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

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:10px;text-align:left;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;">Description</th>
            <th style="padding:10px;text-align:center;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:60px;">Qt\u00e9</th>
            <th style="padding:10px;text-align:right;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:100px;">${tvaExempt ? 'Prix unit.' : 'PU HT'}</th>
            ${tvaExempt ? '' : '<th style="padding:10px;text-align:center;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:60px;">TVA</th>'}
            <th style="padding:10px;text-align:right;font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #cbd5e1;width:110px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;">
        <table style="border-collapse:collapse;min-width:260px;">
          ${tvaExempt ? '' : `<tr>
            <td style="padding:5px 10px;font-size:13px;color:#64748b;">Total HT</td>
            <td style="padding:5px 10px;text-align:right;font-size:13px;font-weight:600;">${formatCurrency(data.totals.totalHT)}</td>
          </tr>
          ${tvaRows}`}
          <tr style="border-top:2px solid #2563eb;">
            <td style="padding:10px;font-size:15px;font-weight:700;color:#1e293b;">${tvaExempt ? 'Total' : 'Total TTC'}</td>
            <td style="padding:10px;text-align:right;font-size:15px;font-weight:700;color:#2563eb;">${formatCurrency(data.totals.totalTTC)}</td>
          </tr>
        </table>
      </div>

      ${notesHTML}
      ${paymentInfo}
      ${legalHTML}
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
  if (data.title) rightCol.push({ text: data.title, fontSize: 9, italics: true, color: '#475569', alignment: 'right', margin: [0, 3, 0, 0] });
  rightCol.push({ text: `Date : ${formatDate(data.date)}`, fontSize: 9, color: gray, alignment: 'right', margin: [0, 4, 0, 0] });
  if (data.dueDate) rightCol.push({ text: `\u00c9ch\u00e9ance : ${formatDate(data.dueDate)}`, fontSize: 9, color: gray, alignment: 'right' });

  // --- Client block ---
  const clientBlock = [];
  clientBlock.push({ text: 'DESTINATAIRE', fontSize: 8, bold: true, color: muted, margin: [0, 0, 0, 4] });
  clientBlock.push({ text: c.name, fontSize: 12, bold: true, color: dark });
  clientLines.forEach((l) => clientBlock.push({ text: l, fontSize: 9, color: '#475569' }));
  if (c.siret) clientBlock.push({ text: `SIRET: ${c.siret}`, fontSize: 8, color: muted, margin: [0, 3, 0, 0] });

  // --- Items table ---
  const filteredItems = data.items.filter((i) => i.description.trim());
  const tableHeader = [
    { text: 'Description', style: 'tableHeader' },
    { text: 'Qt\u00e9', style: 'tableHeader', alignment: 'center' },
    { text: tvaExempt ? 'Prix unit.' : 'PU HT', style: 'tableHeader', alignment: 'right' },
  ];
  if (!tvaExempt) tableHeader.push({ text: 'TVA', style: 'tableHeader', alignment: 'center' });
  tableHeader.push({ text: 'Total', style: 'tableHeader', alignment: 'right' });

  const tableBody = [tableHeader];
  filteredItems.forEach((item) => {
    const row = [
      { text: item.description, fontSize: 9 },
      { text: String(item.quantity), fontSize: 9, alignment: 'center' },
      { text: formatCurrency(item.unitPrice), fontSize: 9, alignment: 'right' },
    ];
    if (!tvaExempt) row.push({ text: `${item.tvaRate}%`, fontSize: 9, alignment: 'center' });
    row.push({ text: formatCurrency(round2(item.quantity * item.unitPrice)), fontSize: 9, alignment: 'right', bold: true });
    tableBody.push(row);
  });

  // --- Totals ---
  const totalsBody = [];
  if (!tvaExempt) {
    totalsBody.push([
      { text: 'Total HT', fontSize: 9, color: gray },
      { text: formatCurrency(data.totals.totalHT), fontSize: 9, bold: true, alignment: 'right' },
    ]);
    data.totals.tvaBreakdown.forEach((b) => {
      totalsBody.push([
        { text: `TVA ${b.rate}% (sur ${formatCurrency(b.base)})`, fontSize: 9, color: gray },
        { text: formatCurrency(b.tva), fontSize: 9, alignment: 'right' },
      ]);
    });
  }
  totalsBody.push([
    { text: tvaExempt ? 'Total' : 'Total TTC', fontSize: 13, bold: true, color: dark, margin: [0, 4, 0, 0] },
    { text: formatCurrency(data.totals.totalTTC), fontSize: 13, bold: true, color: blue, alignment: 'right', margin: [0, 4, 0, 0] },
  ]);

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

  if (data.notes) {
    content.push({ text: 'Notes', fontSize: 9, bold: true, color: '#334155', margin: [0, 8, 0, 3] });
    content.push({ text: data.notes, fontSize: 9, color: '#475569', margin: [0, 0, 0, 12] });
  }

  if (s.defaultPaymentTerms || s.iban) {
    const paymentStack = [];
    paymentStack.push({ text: 'MODALIT\u00c9S DE PAIEMENT', fontSize: 8, bold: true, color: '#334155', margin: [0, 0, 0, 5] });
    if (s.defaultPaymentTerms) paymentStack.push({ text: `Mode : ${s.defaultPaymentTerms}`, fontSize: 9, color: '#475569' });
    if (data.dueDate) paymentStack.push({ text: `\u00c9ch\u00e9ance : ${formatDate(data.dueDate)}`, fontSize: 9, color: '#475569' });
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

function downloadPDF() {
  if (typeof pdfMake === 'undefined') {
    showToast('Biblioth\u00e8que PDF non charg\u00e9e', 'error');
    return;
  }

  const data = collectInvoiceData();
  if (!validateInvoice(data)) return;

  const docDef = buildPdfDefinition(data);
  pdfMake.createPdf(docDef).download(`${data.number}.pdf`);
  showToast('PDF t\u00e9l\u00e9charg\u00e9');
}
