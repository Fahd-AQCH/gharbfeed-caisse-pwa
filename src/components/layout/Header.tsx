import React from 'react';
import { User as UserIcon, WifiOff, Wifi } from 'lucide-react';
import { UserProfile } from '../../types';

interface HeaderProps {
  profile: UserProfile | null;
  isOffline?: boolean;
}

export default function Header({ profile, isOffline = false }: HeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
      <div className="flex items-center gap-4 flex-1">
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
