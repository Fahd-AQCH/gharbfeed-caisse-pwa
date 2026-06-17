// Étiquettes d'unité partagées pour l'affichage (tickets PDF, etc.).
// La colonne produits.unite stocke l'id de la liste : 'u' | 'kg' | 'L' (défaut 'u').
export const UNIT_LABELS: Record<string, string> = {
  u: 'u',
  kg: 'kg',
  L: 'L',
};

/** Étiquette d'affichage d'une unité ; repli sûr sur 'u' si absente/inconnue. */
export function unitLabel(unite?: string | null): string {
  const key = (unite ?? '').trim();
  return UNIT_LABELS[key] ?? 'u';
}

/** Quantité suivie de son unité, ex. "5 kg". */
export function qtyWithUnit(quantity: number | string, unite?: string | null): string {
  return `${quantity} ${unitLabel(unite)}`;
}
