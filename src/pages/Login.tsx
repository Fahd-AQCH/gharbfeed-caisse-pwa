import React, { useState } from 'react';
import { supabase } from '../supabase';
import { motion } from 'motion/react';
import { ArrowRight, Loader2, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import logo from '@/logo.png';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handlePostLogin = async (user: any) => {
    const { data: profile, error } = await supabase
      .from('utilisateurs')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error || !profile) {
      // Profil absent : on tente un auto-insert de secours sans déconnecter
      const username = user.email.split('@')[0];
      const isAdmin = user.email === 'aqch.fahd@gmail.com';
      const roleValue = isAdmin ? 'admin' : 'caissier';

      // Essai 1 : colonnes is_active + role_id
      let res = await supabase.from('utilisateurs').insert({
        id: user.id,
        username,
        role_id: roleValue,
        is_active: true,
        actif: true,
      });

      // Essai 2 : colonnes actif + role (ancienne structure)
      if (res.error) {
        res = await supabase.from('utilisateurs').insert({
          id: user.id,
          username,
          role: roleValue,
          actif: true,
        });
      }

      if (res.error) {
        // L'insert a échoué (RLS bloqué ou colonnes différentes)
        // On n'appelle PAS signOut() pour éviter la boucle infinie.
        // App.tsx prendra le relais via onAuthStateChange et affichera le fallback admin si besoin.
        console.error('Profil auto-insert failed (RLS ou schéma):', res.error);
        setError(
          `Profil introuvable ou bloqué par RLS. Contactez l'administrateur.\n` +
          `(Détail : ${res.error.message})`
        );
        // Déconnexion propre uniquement si ce n'est pas l'admin connu
        if (!isAdmin) {
          await supabase.auth.signOut();
        }
      }
      // Si l'insert réussit, onAuthStateChange dans App.tsx gérera la suite
    } else {
      // Profil trouvé — vérifier si le compte est actif
      const isActive =
        profile.is_active !== undefined
          ? profile.is_active
          : profile.actif !== undefined
          ? profile.actif
          : true;

      if (!isActive) {
        setError('Votre compte est désactivé. Contactez l\'administrateur.');
        await supabase.auth.signOut();
      }
      // Compte actif → App.tsx redirige automatiquement via onAuthStateChange
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let authEmail = email.trim();
      if (!authEmail.includes('@')) {
        authEmail = `${authEmail.toLowerCase()}@gharbfeed.com`;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: password
      });

      if (error) throw error;
      if (data?.user) {
        await handlePostLogin(data.user);
      }
    } catch (err: any) {
      console.error(err);
      setError("Email ou mot de passe incorrect.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500 rounded-full blur-[120px]"></div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-slate-900 border border-white/10 p-8 rounded-3xl shadow-2xl relative z-10"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="mb-5 transition-transform hover:scale-105">
            <img
              src={logo}
              alt="GharbFeed"
              className="h-24 w-24 object-contain drop-shadow-[0_0_24px_rgba(16,185,129,0.35)]"
            />
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">GharbFeed</h1>
          <span className="text-emerald-400 text-xs font-black tracking-[0.25em] uppercase mb-3">v1.2</span>
          <p className="text-slate-400 text-sm">Système de gestion de stock et caisse professionnel</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm flex items-start gap-3">
            <span className="shrink-0 pt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-4 mb-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-1">Nom d'utilisateur</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
              <input 
                type="text" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ex: hajar, badr123..."
                className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
              />
            </div>
          </div>
          <div className="space-y-2 mb-2">
             <label className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-1">Mot de passe</label>
             <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-3 pl-10 pr-10 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-emerald-400 transition-colors"
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 px-6 rounded-2xl transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 group mt-4"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <span>Se connecter</span>
                <ArrowRight className="h-5 w-5 ml-auto text-emerald-100 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

      </motion.div>

      <footer className="mt-8 text-slate-500 text-sm flex items-center gap-4 relative z-10">
        <span>© 2026 GharbFeed System</span>
        <span className="h-1 w-1 bg-slate-700 rounded-full"></span>
        <span>Infrastructure Supabase & Cloud Run</span>
      </footer>
    </div>
  );
}
