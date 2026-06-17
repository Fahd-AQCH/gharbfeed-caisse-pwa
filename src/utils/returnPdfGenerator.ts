import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawPdfLogo } from './pdfLogo';
import { unitLabel } from '../lib/units';

export interface RetourItem {
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  unite?: string | null;   // unité produit ('u'|'kg'|'L') — affichée après la quantité
}

export interface RetourOperation {
  returnOpNumber: string;     // OP-XXXX of the return
  originalOpNumber: string;   // OP-XXXX of original sale/purchase
  type: 'retour_client' | 'retour_fournisseur';
  date: string;
  time?: string;
  partyName?: string;         // client name (retour_client) or fournisseur name
  cashierName?: string;
  total: number;
}

const COLORS = {
  purple:     [124, 58, 237]  as [number, number, number],
  purpleDark: [109, 40, 217]  as [number, number, number],
  blue:       [59, 130, 246]  as [number, number, number],
  slate900:   [15,  23,  42]  as [number, number, number],
  slate700:   [51,  65,  85]  as [number, number, number],
  slate400:   [148, 163, 184] as [number, number, number],
  slate100:   [241, 245, 249] as [number, number, number],
  white:      [255, 255, 255] as [number, number, number],
};

export function generateRetourPDF(operation: RetourOperation, items: RetourItem[]): void {
  const format = items.length > 10 ? 'a4' : 'a5';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;

  const isRetourClient = operation.type === 'retour_client';
  const accentColor = isRetourClient ? COLORS.purple : COLORS.blue;

  let y = margin;

  // ── Header ─────────────────────────────────────────────────────────────────
  const headerH = 22;
  doc.setFillColor(...COLORS.slate900);
  doc.roundedRect(margin, y, contentW, headerH, 3, 3, 'F');

  drawPdfLogo(doc, margin + 4, y + 4, 14, accentColor);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.white);
  doc.text('GharbFeed', margin + 22, y + 9);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.slate400);
  doc.text("Alimentation animale et Matériel d'élevage", margin + 22, y + 14.5);

  // Badge type retour
  const badgeLabel = isRetourClient ? '  AVOIR  ' : '  RET. FOURN.  ';
  doc.setFillColor(...accentColor);
  doc.roundedRect(pageW - margin - 28, y + 6, 24, 9, 2, 2, 'F');
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.white);
  doc.text(badgeLabel, pageW - margin - 16, y + 11.8, { align: 'center' });

  y += headerH + 5;

  // ── Sub-header: TICKET RETOUR / AVOIR ──────────────────────────────────────
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...accentColor);
  doc.text('TICKET RETOUR / AVOIR', pageW / 2, y + 5, { align: 'center' });
  y += 10;

  // ── Info block ─────────────────────────────────────────────────────────────
  doc.setDrawColor(...COLORS.slate100);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  const col2x = margin + contentW / 2;
  const infoData: [string, string][] = [
    ["N° Retour", `#${operation.returnOpNumber}`],
    ["N° Orig.", `#${operation.originalOpNumber}`],
    ["Date", operation.date],
    ["Heure", operation.time ? operation.time.slice(0, 5) : '—'],
  ];

  doc.setFontSize(7.5);
  infoData.forEach(([label, value], i) => {
    const isRight = i >= 2;
    const x = isRight ? col2x : margin;
    const row = isRight ? i - 2 : i;
    const rowY = y + row * 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.slate400);
    doc.text(label + ' :', x, rowY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.slate700);
    doc.text(value, x + 30, rowY);
  });

  if (operation.partyName) {
    const partyY = y + 12;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.slate400);
    doc.text((isRetourClient ? 'Client' : 'Fournisseur') + ' :', margin, partyY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.slate700);
    doc.text(operation.partyName, margin + 30, partyY);
  }

  y += 18;

  // ── Table ──────────────────────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.slate700);
  doc.text('ARTICLES RETOURNÉS', margin, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Code', 'Produit', 'Qté', 'Prix U. (DH)', 'Total (DH)']],
    body: items.map(it => [it.productCode, it.productName, `${it.quantity} ${unitLabel(it.unite)}`, it.unitPrice.toFixed(2), it.lineTotal.toFixed(2)]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 }, font: 'helvetica', textColor: COLORS.slate900 },
    headStyles: { fillColor: accentColor, textColor: COLORS.white, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: COLORS.slate100 },
    columnStyles: {
      0: { cellWidth: 18, fontStyle: 'bold', textColor: COLORS.slate400 as any },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 5;

  // ── Total ──────────────────────────────────────────────────────────────────
  const totalsW = 60;
  const totalsX = pageW - margin - totalsW;
  doc.setFillColor(...COLORS.slate100);
  doc.roundedRect(totalsX, y, totalsW, 14, 2, 2, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.slate900);
  doc.text('AVOIR :', totalsX + 4, y + 9);
  doc.setTextColor(...accentColor);
  doc.text(`${operation.total.toFixed(2)} DH`, totalsX + totalsW - 4, y + 9, { align: 'right' });

  y += 20;

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerY = pageH - 10;
  doc.setDrawColor(...COLORS.slate100);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 4, pageW - margin, footerY - 4);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.slate400);
  doc.text(`Imprimé le ${new Date().toLocaleString('fr-FR')}`, margin, footerY);
  doc.text('GharbFeed v2.0 · Système de Gestion', pageW / 2, footerY, { align: 'center' });
  doc.text('Merci de votre confiance.', pageW - margin, footerY, { align: 'right' });

  const filename = `retour_${operation.type}_${operation.returnOpNumber}_${operation.date}.pdf`;
  doc.save(filename);
}
