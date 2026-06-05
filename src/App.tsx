import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';
import { UserProfile } from './types';
import { pullMasterData, syncAll } from './lib/syncService';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Cashier from './pages/Cashier';
import Inventory from './pages/Inventory';
import Clients from './pages/Clients';
import History from './pages/History';
import Admin from './pages/Admin';
import Fournisseurs from './pages/Fournisseurs';
import Debts from './pages/Debts';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import { AnimatePresence } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Offline / Online network state ─────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const syncedRef = useRef(false); // prevent duplicate pulls on fast reconnects

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      // Push any queued offline operations, then refresh local DB
      syncAll().catch((err) => console.warn('[App] syncAll on reconnect:', err));
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const initializeApp = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (!mounted) return;
        if (error) {
          console.error('[App] getSession error:', error);
          setUser(null);
          setProfile(null);
          return;
        }

        if (!session?.user) {
          setUser(null);
          setProfile(null);
          return;
        }

        // Set user first
        setUser(session.user);

        // Fetch profile
        const { data: userData, error: userError } = await supabase
          .from('utilisateurs')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (!mounted) return;

        if (userError) {
          console.error('[App] fetchProfile error:', userError);
          // Fallback for admin
          if (session.user.email === 'aqch.fahd@gmail.com') {
            setProfile({
              id: session.user.id,
              username: 'Administrator',
              email: session.user.email,
              roleId: 'admin',
              isActive: true,
              createdAt: new Date(),
            });
          } else {
            setProfile(null);
          }
          return;
        }

        if (userData) {
          const rawRole = userData.role_id || userData.role || 'caissier';
          const roleId = rawRole === 'admin' ? 'admin' : 'cashier';
          const isActive =
            userData.is_active !== undefined
              ? userData.is_active
              : userData.actif !== undefined
              ? userData.actif
              : true;

          setProfile({
            id: userData.id,
            username: userData.nom || userData.username || session.user.email?.split('@')[0] || 'Utilisateur',
            email: session.user.email || userData.email || '',
            roleId: roleId,
            isActive: isActive,
            createdAt: new Date(userData.created_at || userData.date_creation || Date.now()),
          } as UserProfile);

          // ── Populate local Dexie DB on first authenticated load ────────────
          if (!syncedRef.current && navigator.onLine) {
            syncedRef.current = true;
            pullMasterData().catch((err) =>
              console.warn('[App] initial pullMasterData failed:', err)
            );
          }
        }
      } catch (err) {
        console.error('[App] initializeApp exception:', err);
        if (mounted) {
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    initializeApp();

    // Listen for auth changes AFTER initial load
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'INITIAL_SESSION') return;
        if (!mounted) return;

        if (session?.user) {
          setUser(session.user);
          // Reuse the same fetch logic
          supabase
            .from('utilisateurs')
            .select('*')
            .eq('id', session.user.id)
            .single()
            .then(({ data: userData, error: userError }) => {
              if (!mounted) return;
              if (userError || !userData) {
                setProfile(null);
                return;
              }
              const rawRole = userData.role_id || userData.role || 'caissier';
              const roleId = rawRole === 'admin' ? 'admin' : 'cashier';
              const isActive = userData.is_active !== undefined ? userData.is_active : userData.actif !== undefined ? userData.actif : true;
              setProfile({
                id: userData.id,
                username: userData.nom || userData.username || session.user.email?.split('@')[0] || 'Utilisateur',
                email: session.user.email || userData.email || '',
                roleId: roleId,
                isActive: isActive,
                createdAt: new Date(userData.created_at || userData.date_creation || Date.now()),
              } as UserProfile);
            });
        } else {
          setUser(null);
          setProfile(null);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <Router>
      <AnimatePresence mode="wait">
        {!user ? (
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        ) : !profile ? (
          <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-gray-50 p-8 text-center">
            <p className="text-lg font-bold text-slate-800">Profil utilisateur introuvable</p>
            <p className="max-w-md text-sm text-slate-500">
              La session est active mais le profil n&apos;a pas pu être chargé. Reconnectez-vous ou
              contactez l&apos;administrateur.
            </p>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="rounded-xl bg-emerald-500 px-6 py-3 text-sm font-bold text-white hover:bg-emerald-600"
            >
              Retour à la connexion
            </button>
          </div>
        ) : (
          <div className="flex h-screen bg-gray-50 overflow-hidden">
            <Sidebar profile={profile} />
            <div className="flex flex-col flex-1 overflow-hidden">
              <Header profile={profile} isOffline={isOffline} />
              <main className="flex-1 overflow-hidden bg-slate-50">
                <Routes>
                  <Route path="/" element={<Dashboard profile={profile} />} />
                  <Route path="/cashier" element={<Cashier profile={profile} />} />
                  <Route path="/inventory" element={<Inventory profile={profile} />} />
                  <Route path="/clients" element={<Clients profile={profile} />} />
                  <Route path="/history" element={<History profile={profile} />} />
                  <Route path="/fournisseurs" element={<Fournisseurs profile={profile} />} />
                  <Route path="/debts" element={<Debts profile={profile} />} />
                  <Route path="/admin" element={<Admin profile={profile} />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </main>
            </div>
          </div>
        )}
      </AnimatePresence>
    </Router>
  );
}
