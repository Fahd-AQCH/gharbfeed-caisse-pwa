// Préchargeur partagé du logo pour tous les générateurs PDF.
// Convertit /logo.png (dossier public) en DataURL base64 dès le chargement
// du module, pour que jsPDF (synchrone) puisse l'utiliser immédiatement.
let _logoUrl: string | null = null;

if (typeof window !== 'undefined') {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      _logoUrl = canvas.toDataURL('image/png');
    }
  };
  img.src = '/logo.png';
}

export function getLogoDataUrl(): string | null {
  return _logoUrl;
}

/**
 * Dessine le logo dans l'en-tête d'un PDF jsPDF (carré x/y/size en mm).
 * Fallback : carré accentué avec le texte "GF" si le logo n'est pas encore chargé.
 */
export function drawPdfLogo(
  doc: import('jspdf').jsPDF,
  x: number,
  y: number,
  size: number,
  fallbackColor: [number, number, number],
): void {
  if (_logoUrl) {
    doc.addImage(_logoUrl, 'PNG', x, y, size, size);
  } else {
    doc.setFillColor(...fallbackColor);
    doc.roundedRect(x, y, size, size, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text('GF', x + size / 2, y + size / 2 + 1.5, { align: 'center' });
  }
}
