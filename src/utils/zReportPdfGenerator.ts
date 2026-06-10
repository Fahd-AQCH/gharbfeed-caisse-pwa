import jsPDF from 'jspdf';
import { drawPdfLogo } from './pdfLogo';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ZReportData {
  closureId?: number;          // n° de clôture (absent avant insertion → 'BROUILLON')
  periodeDebut: string;        // affichage libre, ex: '01/06/2026 08:00'
  periodeFin: string;
  fondsOuverture: number;
  // Entrées espèces
  ventesEspeces: number;
  encaissementsDettes: number;
  retoursFournisseurs: number;
  // Sorties espèces
  achatsEspeces: number;
  paiementsFournisseurs: number;
  chargesEspeces: number;
  remboursementsClients: number;
  // Résultat
  soldeTheorique: number;
  soldeReel: number;
  ecart: number;               // réel − théorique
  fondsProchaineOuverture: number;
  adminName?: string;
  notes?: string;
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  emerald:  [16,  185, 129] as [number, number, number],
  blue:     [59,  130, 246] as [number, number, number],
  amber:    [245, 158,  11] as [number, number, number],
  rose:     [244,  63,  94] as [number, number, number],
  slate900: [15,   23,  42] as [number, number, number],
  slate700: [51,   65,  85] as [number, number, number],
  slate400: [148, 163, 184] as [number, number, number],
  slate100: [241, 245, 249] as [number, number, number],
  white:    [255, 255, 255] as [number, number, number],
};

// ─── Générateur ───────────────────────────────────────────────────────────────
export function generateZReportPDF(data: ZReportData): void {
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

  doc.setFillColor(...C.rose);
  doc.roundedRect(pageW - margin - 26, y + 6, 22, 9, 2, 2, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.white);
  doc.text('TICKET Z', pageW - margin - 15, y + 11.8, { align: 'center' });
  y += 27;

  // ── TITLE BANNER ────────────────────────────────────────────────────────────
  doc.setFillColor(...C.slate700);
  doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.white);
  doc.text('ARRÊTÉ DE CAISSE — RAPPORT DE CLÔTURE (ESPÈCES)', pageW / 2, y + 6.5, { align: 'center' });
  y += 14;

  // ── INFO ────────────────────────────────────────────────────────────────────
  doc.setFontSize(7.5);
  const infoRows: [string, string][] = [
    ['N° Clôture', data.closureId != null ? `Z-${String(data.closureId).padStart(4, '0')}` : 'BROUILLON'],
    ['Période', `${data.periodeDebut}  →  ${data.periodeFin}`],
    ['Responsable', data.adminName || '—'],
  ];
  infoRows.forEach(([label, value], i) => {
    const rowY = y + i * 5.5;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.slate400);
    doc.text(label + ' :', margin, rowY);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.slate700);
    doc.text(value, margin + 26, rowY);
  });
  y += infoRows.length * 5.5 + 3;

  doc.setDrawColor(...C.slate100); doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  // ── Ligne générique ─────────────────────────────────────────────────────────
  const line = (
    label: string,
    value: number,
    opts: { bold?: boolean; color?: [number, number, number]; sign?: '+' | '-' | '' } = {}
  ) => {
    const { bold = false, color = C.slate700, sign = '' } = opts;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.slate400);
    doc.text(label, margin + 3, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(`${sign}${Math.abs(value).toFixed(2)} DH`, pageW - margin - 3, y, { align: 'right' });
    y += 5.5;
  };

  const section = (title: string, color: [number, number, number]) => {
    doc.setFillColor(...color);
    doc.roundedRect(margin, y - 3.5, contentW, 5.5, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...C.white);
    doc.text(title, margin + 3, y);
    y += 6;
  };

  // ── FONDS D'OUVERTURE ───────────────────────────────────────────────────────
  line("Fonds de caisse à l'ouverture", data.fondsOuverture, { bold: true, color: C.slate900 });
  y += 1;

  // ── ENTRÉES ─────────────────────────────────────────────────────────────────
  const totalEntrees = data.ventesEspeces + data.encaissementsDettes + data.retoursFournisseurs;
  section('ENTRÉES ESPÈCES', C.emerald);
  line('Ventes encaissées (acomptes inclus)', data.ventesEspeces, { sign: '+' });
  line('Encaissements créances clients', data.encaissementsDettes, { sign: '+' });
  line('Remboursements fournisseurs (retours)', data.retoursFournisseurs, { sign: '+' });
  line('Total entrées', totalEntrees, { bold: true, color: C.emerald, sign: '+' });
  y += 1;

  // ── SORTIES ─────────────────────────────────────────────────────────────────
  const totalSorties = data.achatsEspeces + data.paiementsFournisseurs + data.chargesEspeces + data.remboursementsClients;
  section('SORTIES ESPÈCES', C.rose);
  line('Achats payés comptant', data.achatsEspeces, { sign: '-' });
  line('Règlements crédits fournisseurs', data.paiementsFournisseurs, { sign: '-' });
  line('Charges & dépenses', data.chargesEspeces, { sign: '-' });
  line('Remboursements clients (avoirs)', data.remboursementsClients, { sign: '-' });
  line('Total sorties', totalSorties, { bold: true, color: C.rose, sign: '-' });
  y += 2;

  // ── RÉSULTAT ────────────────────────────────────────────────────────────────
  doc.setDrawColor(...C.slate400); doc.setLineWidth(0.2);
  doc.line(margin, y - 2, pageW - margin, y - 2);

  doc.setFillColor(...C.slate100);
  doc.roundedRect(margin, y, contentW, 24, 2, 2, 'F');
  y += 6;
  line('SOLDE THÉORIQUE (calculé)', data.soldeTheorique, { bold: true, color: C.slate900 });
  line('SOLDE RÉEL (compté en caisse)', data.soldeReel, { bold: true, color: C.blue });

  // Écart — mis en évidence
  const noEcart = Math.abs(data.ecart) <= 0.01;
  const ecartColor: [number, number, number] = noEcart ? C.emerald : data.ecart > 0 ? C.amber : C.rose;
  const ecartLabel = noEcart
    ? 'ÉCART : AUCUN — CAISSE JUSTE'
    : data.ecart > 0
      ? 'ÉCART : SURPLUS DE CAISSE'
      : 'ÉCART : MANQUANT DE CAISSE';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...ecartColor);
  doc.text(ecartLabel, margin + 3, y);
  doc.text(
    `${data.ecart > 0 ? '+' : data.ecart < 0 ? '−' : ''}${Math.abs(data.ecart).toFixed(2)} DH`,
    pageW - margin - 3, y, { align: 'right' }
  );
  y += 9;

  // ── FONDS PROCHAINE OUVERTURE ───────────────────────────────────────────────
  doc.setFillColor(...C.blue);
  doc.roundedRect(margin, y, contentW, 9, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.white);
  doc.text('FONDS DE CAISSE — PROCHAINE OUVERTURE', margin + 3, y + 5.8);
  doc.text(`${data.fondsProchaineOuverture.toFixed(2)} DH`, pageW - margin - 3, y + 5.8, { align: 'right' });
  y += 13;

  // ── NOTES ───────────────────────────────────────────────────────────────────
  if (data.notes) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7);
    doc.setTextColor(...C.slate400);
    const noteLines = doc.splitTextToSize(`Note : ${data.notes}`, contentW - 4);
    doc.text(noteLines, margin + 2, y);
    y += noteLines.length * 3.5 + 3;
  }

  // ── SIGNATURE ───────────────────────────────────────────────────────────────
  y = Math.max(y + 2, pageH - 32);
  doc.setDrawColor(...C.slate100); doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 5;
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.slate400);
  doc.text('Signature responsable', margin + contentW * 0.5, y, { align: 'center' });
  doc.setLineWidth(0.2);
  doc.line(margin + contentW * 0.3, y + 11, margin + contentW * 0.7, y + 11);

  // ── FOOTER ──────────────────────────────────────────────────────────────────
  const footerY = pageH - 7;
  doc.setDrawColor(...C.slate100); doc.setLineWidth(0.3);
  doc.line(margin, footerY - 4, pageW - margin, footerY - 4);
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.slate400);
  doc.text(`Imprimé le ${new Date().toLocaleString('fr-FR')}`, margin, footerY);
  doc.text('GharbFeed - Souk larbaa lgharb, Lot Zohour, num 68 - +212663775265', pageW - margin, footerY, { align: 'right' });

  const idLabel = data.closureId != null ? `Z-${String(data.closureId).padStart(4, '0')}` : 'brouillon';
  doc.save(`ticket_Z_${idLabel}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
