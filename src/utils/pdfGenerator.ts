import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Preload logo.png as base64 at module init so it's ready when PDF fires
let _logoUrl: string | null = null;
if (typeof window !== 'undefined') {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) { ctx.drawImage(img, 0, 0); _logoUrl = canvas.toDataURL('image/png'); }
  };
  img.src = '/logo.png';
}

// ─── Types locaux ───────────────────────────────────────────────────────────
export interface TicketItem {
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface TicketOperation {
  id: string;           // num_op ou uuid court
  type: 'vente' | 'achat';
  date: string;         // 'YYYY-MM-DD'
  time?: string;        // 'HH:MM:SS'
  clientName?: string;
  cashierName?: string;
  grossTotal: number;
  discountAmount: number;
  finalTotal: number;
  montantPaye?: number;   // Montant encaissé aujourd'hui (paiement partiel)
  resteAPayer?: number;   // Solde restant dû
}

// ─── Palette couleurs GharbFeed ─────────────────────────────────────────────
const COLORS = {
  emerald:    [16, 185, 129]  as [number, number, number],
  emeraldDark:[5,  150, 105]  as [number, number, number],
  slate900:   [15,  23,  42]  as [number, number, number],
  slate700:   [51,  65,  85]  as [number, number, number],
  slate400:   [148, 163, 184] as [number, number, number],
  slate100:   [241, 245, 249] as [number, number, number],
  blue:       [59, 130, 246]  as [number, number, number],
  white:      [255, 255, 255] as [number, number, number],
};

// ─── Fonction principale ─────────────────────────────────────────────────────
/**
 * Génère un ticket PDF A5 (ou A4 si plus de 10 articles) et déclenche
 * un téléchargement direct — utilitaire pur, sans effet React ni window.open.
 */
export function generateTicketPDF(
  operation: TicketOperation,
  items: TicketItem[],
): void {
  // Format A5 portrait pour les petits tickets, A4 portrait au-delà
  const format = items.length > 10 ? 'a4' : 'a5';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;

  let y = margin;

  // ── 1. BANDEAU EN-TÊTE ────────────────────────────────────────────────────
  const headerH = 22;
  const accentColor = operation.type === 'vente' ? COLORS.emerald : COLORS.blue;

  // Rectangle de fond de l'en-tête
  doc.setFillColor(...COLORS.slate900);
  doc.roundedRect(margin, y, contentW, headerH, 3, 3, 'F');

  // Logo (canvas-preloaded) — fallback "GF" if not yet loaded
  if (_logoUrl) {
    doc.addImage(_logoUrl, 'PNG', margin + 4, y + 4, 14, 14);
  } else {
    doc.setFillColor(...accentColor);
    doc.roundedRect(margin + 4, y + 4, 14, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.white);
    doc.text('GF', margin + 11, y + 12.5, { align: 'center' });
  }

  // Nom entreprise
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.white);
  doc.text('GharbFeed', margin + 22, y + 9);

  // Sous-titre
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.slate400);
  doc.text('Alimentation Animale · Gestion de Stock', margin + 22, y + 14.5);

  // Badge type opération (droite)
  const badgeLabel = operation.type === 'vente' ? '  VENTE  ' : '  ACHAT  ';
  doc.setFillColor(...accentColor);
  doc.roundedRect(pageW - margin - 22, y + 6, 18, 9, 2, 2, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.white);
  doc.text(badgeLabel, pageW - margin - 13, y + 11.8, { align: 'center' });

  y += headerH + 6;

  // ── 2. INFORMATIONS OPÉRATION ─────────────────────────────────────────────
  // Ligne séparateur fine
  doc.setDrawColor(...COLORS.slate100);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  // Deux colonnes : gauche (n° op, date) / droite (heure, client)
  const col1x = margin;
  const col2x = margin + contentW / 2;

  const infoData: [string, string][] = [
    ['N° Opération', `#${operation.id}`],
    ['Date', operation.date],
    ['Heure', operation.time ? operation.time.slice(0, 5) : '—'],
    ['Client', operation.clientName || 'Comptoir'],
  ];

  doc.setFontSize(7.5);
  infoData.forEach(([label, value], i) => {
    const isRight = i >= 2;
    const x = isRight ? col2x : col1x;
    const row = isRight ? i - 2 : i;
    const rowY = y + row * 6;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.slate400);
    doc.text(label + ' :', x, rowY);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.slate700);
    doc.text(value, x + 28, rowY);
  });

  if (operation.cashierName) {
    const cashierY = y + 12;
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.slate400);
    doc.text('Caissier :', col1x, cashierY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.slate700);
    doc.text(operation.cashierName, col1x + 28, cashierY);
  }

  y += 16;

  // ── 3. TABLEAU DES ARTICLES ───────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.slate700);
  doc.text('ARTICLES', margin, y);
  y += 3;

  const tableRows = items.map(item => [
    item.productCode,
    item.productName,
    item.quantity.toString(),
    item.unitPrice.toFixed(2),
    item.lineTotal.toFixed(2),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Code', 'Produit', 'Qté', 'Prix U. (DH)', 'Total (DH)']],
    body: tableRows,
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 8,
      cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
      font: 'helvetica',
      textColor: COLORS.slate900,
    },
    headStyles: {
      fillColor: COLORS.slate900,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    alternateRowStyles: {
      fillColor: COLORS.slate100,
    },
    columnStyles: {
      0: { cellWidth: 18, fontStyle: 'bold', textColor: COLORS.slate400 as any },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
    },
  });

  // Récupérer la position Y après le tableau
  const finalY = (doc as any).lastAutoTable.finalY + 5;
  y = finalY;

  // ── 4. BLOC TOTAUX ────────────────────────────────────────────────────────
  const totalsW = 68;
  const totalsX = pageW - margin - totalsW;

  const hasDiscount  = operation.discountAmount > 0;
  const hasPayDetail = (operation.montantPaye ?? 0) > 0.01 || (operation.resteAPayer ?? 0) > 0.01;
  // Rows: sous-total + [remise] + TOTAL + [montant payé + reste dû]
  const rowCount = 1 + (hasDiscount ? 1 : 0) + 1 + (hasPayDetail ? 2 : 0);
  const totalsH  = rowCount * 6 + 8;

  doc.setFillColor(...COLORS.slate100);
  doc.roundedRect(totalsX, y, totalsW, totalsH, 2, 2, 'F');

  let ty = y + 6;
  doc.setFontSize(7.5);

  const drawRow = (label: string, value: string, bold = false, color: [number, number, number] = COLORS.slate700) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...COLORS.slate400);
    doc.text(label, totalsX + 4, ty);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...color);
    doc.text(value, totalsX + totalsW - 4, ty, { align: 'right' });
    ty += 6;
  };

  // Sous-total
  drawRow('Sous-total :', `${operation.grossTotal.toFixed(2)} DH`);

  // Remise
  if (hasDiscount) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.slate400);
    doc.text('Remise :', totalsX + 4, ty);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...accentColor);
    doc.text(`-${operation.discountAmount.toFixed(2)} DH`, totalsX + totalsW - 4, ty, { align: 'right' });
    ty += 6;
  }

  // Séparateur avant total
  doc.setDrawColor(...COLORS.slate400);
  doc.setLineWidth(0.2);
  doc.line(totalsX + 4, ty - 2, totalsX + totalsW - 4, ty - 2);

  // TOTAL
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.slate900);
  doc.text('TOTAL :', totalsX + 4, ty + 4);
  doc.setTextColor(...accentColor);
  doc.text(`${operation.finalTotal.toFixed(2)} DH`, totalsX + totalsW - 4, ty + 4, { align: 'right' });
  ty += 10;

  // Détail paiement partiel
  if (hasPayDetail) {
    doc.setFontSize(7.5);
    doc.setLineWidth(0.2);
    doc.setDrawColor(...COLORS.slate400);
    doc.line(totalsX + 4, ty - 3, totalsX + totalsW - 4, ty - 3);

    if ((operation.montantPaye ?? 0) > 0.01) {
      drawRow('Montant payé :', `${(operation.montantPaye ?? 0).toFixed(2)} DH`, true, COLORS.emerald);
    }
    if ((operation.resteAPayer ?? 0) > 0.01) {
      const ROSE: [number, number, number] = [244, 63, 94];
      drawRow('Reste dû :', `${(operation.resteAPayer ?? 0).toFixed(2)} DH`, true, ROSE);
    }
  }

  y = y + totalsH + 8;

  // ── 5. PIED DE PAGE ───────────────────────────────────────────────────────
  const footerY = pageH - 10;

  // Ligne séparatrice pied de page
  doc.setDrawColor(...COLORS.slate100);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 4, pageW - margin, footerY - 4);

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.slate400);
  const now = new Date().toLocaleString('fr-FR');
  doc.text(`Imprimé le ${now}`, margin, footerY);
  doc.text('GharbFeed v1.2 · Système de Gestion de Stock', pageW / 2, footerY, { align: 'center' });
  doc.text(`Merci de votre ${operation.type === 'vente' ? 'achat' : 'livraison'} !`, pageW - margin, footerY, { align: 'right' });

  // ── 6. Téléchargement direct (évite window.open → perte de focus / race auth) ─
  const filename = `ticket_${operation.type}_${operation.id}_${operation.date}.pdf`;
  doc.save(filename);
}
