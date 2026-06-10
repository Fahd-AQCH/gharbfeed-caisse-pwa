/**
 * closureLock.ts — Soft lock des périodes clôturées (Arrêté de Caisse).
 *
 * La dernière ligne de `cash_closures` définit le verrou : tout élément daté
 * (date, heure) ≤ (date_cloture, heure_cloture) appartient à une période
 * clôturée. Les caissiers et trésoriers ne peuvent plus le modifier ;
 * l'admin conserve tous les droits (le verrou ne s'applique jamais à lui).
 *
 * Les opérations n'ont pas de created_at : toutes les comparaisons se font
 * sur des paires de chaînes ISO ('YYYY-MM-DD', 'HH:MM:SS') — ordre lexical fiable.
 */

import { supabase } from '../supabase';

export interface ClosureLock {
  closureId: number;
  date: string;   // date_cloture 'YYYY-MM-DD'
  heure: string;  // heure_cloture 'HH:MM:SS'
}

/** Récupère la dernière clôture (= borne du verrou). null si aucune clôture. */
export async function fetchLatestClosure(): Promise<ClosureLock | null> {
  try {
    const { data, error } = await supabase
      .from('cash_closures')
      .select('id, date_cloture, heure_cloture')
      .order('date_cloture', { ascending: false })
      .order('heure_cloture', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      closureId: data.id,
      date: String(data.date_cloture),
      heure: String(data.heure_cloture || '00:00:00').slice(0, 8),
    };
  } catch {
    return null;
  }
}

/** true si (date, heure) tombe DANS une période déjà clôturée (≤ verrou). */
export function isBeforeLock(
  date?: string | null,
  heure?: string | null,
  lock?: ClosureLock | null
): boolean {
  if (!lock || !date) return false;
  if (date < lock.date) return true;
  if (date > lock.date) return false;
  return (heure || '00:00:00').slice(0, 8) <= lock.heure;
}
