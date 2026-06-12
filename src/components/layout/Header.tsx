import React from 'react';
import { Link } from 'react-router-dom';
import { User as UserIcon, WifiOff, Wifi, CloudUpload, Menu } from 'lucide-react';
import { UserProfile } from '../../types';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db';
import { cn } from '../../lib/utils';

interface HeaderProps {
  profile: UserProfile | null;
  isOffline?: boolean;
  /** U4 — ouvre/ferme le drawer sidebar sur mobile */
  onToggleSidebar?: () => void;
}

export default function Header({ profile, isOffline = false, onToggleSidebar }: HeaderProps) {
  // U7 — compteur live de la file de synchro locale (pending + failed)
  const queuePending = useLiveQuery(() => db.sync_queue.where('status').anyOf('pending', 'processing').count(), []) ?? 0;
  const queueFailed = useLiveQuery(() => db.sync_queue.where('status').equals('failed').count(), []) ?? 0;
  const queueTotal = queuePending + queueFailed;

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 shrink-0">
      <div className="flex items-center gap-4 flex-1">
        {/* Burger mobile (U4) — masqué ≥ lg où la sidebar est fixe */}
        <button
          onClick={onToggleSidebar}
          className="lg:hidden p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="text-slate-400 text-sm font-medium hidden sm:block">
          Bienvenue, <span className="font-bold text-slate-700">{profile?.username || '...'}</span>
        </div>

        {/* ── Offline indicator ─────────────────────────────────────────── */}
        {isOffline ? (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500 text-white rounded-full text-xs font-black shadow-md shadow-amber-500/30 animate-pulse">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span>Hors Ligne — Sauvegarde locale</span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black border border-emerald-100">
            <Wifi className="h-3 w-3 shrink-0" />
            <span>En ligne</span>
          </div>
        )}

        {/* ── File de synchro non vide → chip cliquable vers le Hub (U7) ── */}
        {queueTotal > 0 && (
          <Link
            to="/sync"
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border transition-all',
              queueFailed > 0
                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
            )}
            title="Ouvrir le centre de synchronisation"
          >
            <CloudUpload className="h-3.5 w-3.5 shrink-0" />
            <span>
              {queueTotal} à synchroniser{queueFailed > 0 ? ` (${queueFailed} échec${queueFailed > 1 ? 's' : ''})` : ''}
            </span>
          </Link>
        )}
      </div>

      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-slate-800 leading-tight">
              {profile?.username || 'Chargement...'}
            </p>
            <p className="text-xs text-slate-500 capitalize leading-tight">
              {profile?.roleId?.replace('_', ' ') || 'Utilisateur'}
            </p>
          </div>
          <div className="w-10 h-10 bg-emerald-100 rounded-full border-2 border-emerald-200 shadow-sm flex items-center justify-center text-emerald-700 font-bold overflow-hidden">
            {profile?.username?.[0]?.toUpperCase() || <UserIcon className="h-5 w-5" />}
          </div>
        </div>
      </div>
    </header>
  );
}
