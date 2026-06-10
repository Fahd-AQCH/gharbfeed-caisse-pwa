import jsPDF from 'jspdf';
import { drawPdfLogo } from './pdfLogo';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DebtPaymentReceiptData {
  operationNumber: string;    // e.g. "OP-0042"
  clientName: string;         // nom de la contrepartie (client ou fournisseur)
  counterpartyLabel?: string; // 'Client' (défaut) ou 'Fournisseur' (comptes à payer)
  totalOriginal: number;      // original operation total
  montantCePaiement: number;  // amount paid in this payment
  totalDejaPaye: number;      // previously paid before this payment
  resteAPayerApres: number;   // remaining after this payment
  datePaiement: string;       // YYYY-MM-DD
  heurePaiement?: string;
  conditionPaiement: string;
  refPaiement?: string;
  cashierName?: string;
  notes?: string;
  isInitialPayment?: boolean; // acompte versé à la création de l'opération (pas dans debt_payments)
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  emerald:  [16,  185, 129] as [number, number, number],
  slate900: [15,   23,  42] as [number, number, number],
  slate700: [51,   65,  85] as [number, number, number],
  slate400: [148, 163, 184] as [number, number, number],
  slate100: [241, 245, 249] as [number, number, number],
  rose:     [244,  63,  94] as [number, number, number],
  white:    [255, 255, 255] as [number, number, number],
};

// ─── PDF Generator ────────────────────────────────────────────────────────────
export function generateDebtPaymentPDF(data: DebtPaymentReceiptData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ── HEADER ──────────────────────────────────────────────────────────────────
  doc.setFillColor(...C.slate900);
  doc.roundedRect(margin, y, contentW, 22, 3, 3, 'F');

  drawPdfLogo(doc, margin + 4, y + 4, 14, C.emerald);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...C.white);
  doc.text('GharbFeed', margin + 22, y + 9);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.slate400);
  doc.text("Alimentation animale et Matériel d'élevage", margin + 22, y + 14.5);

  doc.setFillColor(...C.emerald);
  doc.roundedRect(pageW - margin - 30, y + 6, 26, 9, 2, 2, 'F');
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.white);
  doc.text('REÇU PAIEMENT', pageW - margin - 17, y + 11.8, { align: 'center' });
  y += 27;

  // ── TITLE BANNER ────────────────────────────────────────────────────────────
  doc.setFillColor(...C.emerald);
  doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.white);
  doc.text(
    data.isInitialPayment ? "REÇU D'ACOMPTE INITIAL — À LA CRÉATION" : 'REÇU DE RÈGLEMENT DE CRÉANCE',
    pageW / 2, y + 6.5, { align: 'center' }
  );
  y += 14;

  // ── REFERENCE INFO (2 columns) ───────────────────────────────────────────────
  const col1x = margin;
  const col2x = margin + contentW / 2;
  doc.setFontSize(7.5);

  const leftInfo: [string, string][] = [
    ['Réf. Opération', data.operationNumber],
    ['Date paiement',  data.datePaiement],
    ['Mode',           data.conditionPaiement],
  ];
  const rightInfo: [string, string][] = [
    [data.counterpartyLabel || 'Client', data.clientName || 'Comptoir'],
    ['Heure',  data.heurePaiement ? data.heurePaiement.slice(0, 5) : '—'],
    ['Réf.',   data.refPaiement   || '—'],
  ];

  const startInfoY = y;
  leftInfo.forEach(([label, value], i) => {
    const rowY = startInfoY + i * 6;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.slate400);
    doc.text(label + ' :', col1x, rowY);
    doc.setFont('helvetica', 'bold');   doc.setTextColor(...C.slate700);
    doc.text(value, col1x + 32, rowY);
  });
  rightInfo.forEach(([label, value], i) => {
    const rowY = startInfoY + i * 6;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.slate400);
    doc.text(label + ' :', col2x, rowY);
    doc.setFont('helvetica', 'bold');   doc.setTextColor(...C.slate700);
    doc.text(value, col2x + 22, rowY);
  });
  if (data.cashierName) {
    const cY = startInfoY + 18;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.slate400);
    doc.text('Agent :', col1x, cY);
    doc.setFont('helvetica', 'bold');   doc.setTextColor(...C.slate700);
    doc.text(data.cashierName, col1x + 32, cY);
  }
  y = startInfoY + 26;

  // ── SEPARATOR ───────────────────────────────────────────────────────────────
  doc.setDrawColor(...C.slate100); doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ── PAYMENT BREAKDOWN BOX ───────────────────────────────────────────────────
  const isSolde = data.resteAPayerApres <= 0.01;
  const boxH = 54;
  doc.setFillColor(...C.slate100);
  doc.roundedRect(margin, y, contentW, boxH, 3, 3, 'F');

  let bY = y + 8;

  const drawRow = (
    label: string,
    value: string,
    color: [number, number, number] = C.slate700,
    bold = false
  ) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.slate400);
    doc.text(label, margin + 4, bY);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...color);
    doc.text(value, pageW - margin - 4, bY, { align: 'right' });
    bY += 7;
  };

  drawRow('Total opération :', `${data.totalOriginal.toFixed(2)} DH`);
  drawRow('Total déjà réglé :', `${data.totalDejaPaye.toFixed(2)} DH`);

  // Thin separator
  doc.setDrawColor(...C.slate400); doc.setLineWidth(0.15);
  doc.line(margin + 4, bY - 2, pageW - margin - 4, bY - 2);

  // THIS PAYMENT — highlighted
  doc.setFillColor(...C.emerald);
  doc.roundedRect(margin + 2, bY - 3, contentW - 4, 11, 2, 2, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.setTextColor(...C.white);
  doc.text('Paiement encaissé :', margin + 5, bY + 3.8);
  doc.text(`${data.montantCePaiement.toFixed(2)} DH`, pageW - margin - 5, bY + 3.8, { align: 'right' });
  bY += 13;

  // Remaining balance
  const balColor: [number, number, number] = isSolde ? C.emerald : C.rose;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.setTextColor(...C.slate400);
  doc.text(isSolde ? 'Solde : INTÉGRALEMENT SOLDÉ' : 'Solde restant dû :', margin + 4, bY);
  doc.setTextColor(...balColor);
  doc.text(
    isSolde ? '0,00 DH  ✓' : `${data.resteAPayerApres.toFixed(2)} DH`,
    pageW - margin - 4, bY, { align: 'right' }
  );

  y += boxH + 8;

  // ── NOTES ───────────────────────────────────────────────────────────────────
  if (data.notes) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5);
    doc.setTextColor(...C.slate400);
    doc.text(`Note : ${data.notes}`, margin, y);
    y += 8;
  }

  // ── SIGNATURE AREA ──────────────────────────────────────────────────────────
  y = Math.max(y + 4, pageH - 38);
  doc.setDrawColor(...C.slate100); doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 5;
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.slate400);
  const sigLeft  = margin + contentW * 0.18;
  const sigRight = margin + contentW * 0.82;
  doc.text('Signature client',  sigLeft, y, { align: 'center' });
  doc.text('Signature agent',   sigRight, y, { align: 'center' });
  doc.setLineWidth(0.2);
  doc.line(margin + 4,           y + 13, margin + contentW * 0.38, y + 13);
  doc.line(margin + contentW * 0.62, y + 13, pageW - margin - 4, y + 13);

  // ── FOOTER ──────────────────────────────────────────────────────────────────
  const footerY = pageH - 7;
  doc.setDrawColor(...C.slate100); doc.setLineWidth(0.3);
  doc.line(margin, footerY - 4, pageW - margin, footerY - 4);
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.slate400);
  doc.text(`Imprimé le ${new Date().toLocaleString('fr-FR')}`, margin, footerY);
  doc.text('GharbFeed v1.2 · Gestion des Créances', pageW / 2, footerY, { align: 'center' });
  doc.text('Merci !', pageW - margin, footerY, { align: 'right' });

  doc.save(`recu_${data.operationNumber}_${data.datePaiement}${data.isInitialPayment ? '_initial' : ''}.pdf`);
}
