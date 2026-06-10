import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import logo from '@/logo.png';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  History,
  Settings,
  LogOut,
  Building2,
  CreditCard,
  Receipt,
} from 'lucide-react';
import { UserProfile } from '../../types';
import { cn } from '../../lib/utils';
import { supabase } from '../../supabase';

interface SidebarProps {
  profile: UserProfile | null;
}

const menuItems = [
  { path: '/', label: 'Tableau de bord', icon: LayoutDashboard, roles: ['admin', 'tresorier', 'supervisor', 'cashier', 'stock_manager'] },
  { path: '/cashier', label: 'Ventes / Caissier', icon: ShoppingCart, roles: ['admin', 'cashier', 'supervisor'] },
  { path: '/inventory', label: 'État du Stock', icon: Package, roles: ['admin', 'tresorier', 'stock_manager', 'supervisor', 'cashier'] },
  { path: '/clients', label: 'Clients', icon: Users, roles: ['admin', 'tresorier', 'cashier', 'supervisor'] },
  { path: '/fournisseurs', label: 'Fournisseurs', icon: Building2, roles: ['admin', 'tresorier', 'cashier', 'supervisor', 'stock_manager'] },
  { path: '/debts', label: 'Gestion des Dettes', icon: CreditCard, roles: ['admin', 'tresorier', 'cashier', 'supervisor'] },
  { path: '/expenses', label: 'Charges & Dépenses', icon: Receipt, roles: ['admin', 'tresorier'] },
  { path: '/history', label: 'Historique', icon: History, roles: ['admin', 'tresorier', 'supervisor', 'cashier', 'stock_manager'] },
  { path: '/admin', label: 'Administration', icon: Settings, roles: ['admin'] },
];

export default function Sidebar({ profile }: SidebarProps) {
  const navigate = useNavigate();

  const filteredMenu = menuItems.filter(
    (item) => !profile || item.roles.includes(profile.roleId)
  );

  const handleLogout = async () => {
    try {
      // 1. Déconnexion propre côté Supabase
      await supabase.auth.signOut();
      
      // 2. SOLUTION NUCLÉAIRE : Purge totale du navigateur
      localStorage.clear();
      sessionStorage.clear();
      
      // 3. Redirection dure (efface la mémoire React et recharge la page)
      window.location.href = '/login';
    } catch (err) {
      console.error('Logout failed:', err);
      // Fallback : On force le nettoyage même si Supabase ne répond pas
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/login';
    }
  };

  return (
    <aside className="w-64 bg-slate-900 flex flex-col shrink-0">
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <img
            src={logo}
            alt="GharbFeed"
            className="w-10 h-10 object-contain shrink-0"
          />
          <div>
            <h1 className="text-white font-bold text-lg tracking-tight leading-none">
              GharbFeed
            </h1>
            <span className="text-emerald-400 text-xs font-bold tracking-widest uppercase">
              v1.2
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4">
        <div className="px-4 space-y-1">
          {filteredMenu.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-colors group',
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                )
              }
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="p-4 bg-slate-800/50 m-4 rounded-xl border border-slate-700">
        <div className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-2">
          Statut Serveur
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
          <span className="text-sm text-slate-300">Connecté au Cloud</span>
        </div>
      </div>

      <div className="p-4 mt-auto border-t border-slate-800 shrink-0">
        <button
          onClick={handleLogout}
          className="w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg text-slate-400 hover:bg-rose-950/40 hover:text-rose-400 transition-colors group font-medium"
        >
          <LogOut className="w-5 h-5 text-rose-500 group-hover:text-rose-400" />
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}