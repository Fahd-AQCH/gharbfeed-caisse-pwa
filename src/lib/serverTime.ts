/**
 * serverTime.ts — Horloge métier unique : heure VRAIE Africa/Casablanca.
 *
 * Problème résolu (B6) : les horodatages venaient de l'horloge du DEVICE
 * (`new Date().toTimeString()`), dans le fuseau du device — alors que les
 * dates utilisaient déjà Africa/Casablanca. Un appareil mal réglé produisait
 * des couples (date, heure) incohérents, qui sont précisément les bornes du
 * Ticket Z et du soft lock de clôture.
 *
 * Solution :
 *  1. Au démarrage (et à chaque retour réseau), `calibrateServerClock()`
 *     mesure le décalage device ↔ serveur via la RPC `get_server_time`
 *     (compensé de la moitié du round-trip).
 *  2. `nowMaroc()` retourne date + heure Casablanca calculées sur
 *     l'horloge CORRIGÉE. Hors-ligne, le dernier offset connu s'applique
 *     (ou 0 si jamais calibré — comportement d'avant, sans régression).
 */

import { supabase } from '../supabase';

let _serverOffsetMs = 0;
let _calibratedAt: number | null = null;

/** Mesure le décalage horloge device ↔ serveur. Silencieux en cas d'échec (offline). */
export async function calibrateServerClock(): Promise<void> {
  try {
    const t0 = Date.now();
    const { data, error } = await supabase.rpc('get_server_time');
    const t1 = Date.now();
    if (error || !data) return;
    const serverMs = new Date(data as string).getTime();
    if (!Number.isFinite(serverMs)) return;
    // Le serveur a répondu ~au milieu du round-trip
    _serverOffsetMs = serverMs + Math.round((t1 - t0) / 2) - t1;
    _calibratedAt = t1;
    if (Math.abs(_serverOffsetMs) > 60_000) {
      console.warn(`[serverTime] horloge device décalée de ${Math.round(_serverOffsetMs / 1000)}s — corrigée.`);
    }
  } catch {
    /* offline ou RPC indisponible → on garde le dernier offset connu */
  }
}

/** true si l'horloge a été calibrée au moins une fois sur le serveur. */
export function isClockCalibrated(): boolean {
  return _calibratedAt !== null;
}

/** Décalage device→serveur actuellement appliqué (ms, signé). */
export function clockOffsetMs(): number {
  return _serverOffsetMs;
}

/** Instant courant corrigé du décalage serveur. */
function correctedNow(): Date {
  return new Date(Date.now() + _serverOffsetMs);
}

/**
 * Date + heure Africa/Casablanca de l'instant courant (horloge corrigée).
 * date  : 'YYYY-MM-DD' — heure : 'HH:MM:SS'
 */
export function nowMaroc(): { date: string; heure: string } {
  const now = correctedNow();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(now);
  const heure = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Casablanca',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return { date, heure };
}
