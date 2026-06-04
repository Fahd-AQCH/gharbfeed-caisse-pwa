import React, { useState, useEffect } from 'react';
import { Client, UserProfile } from '../types';
import { supabase } from '../supabase';
import { Users, Plus, Search, User, Phone, MapPin, Briefcase, Edit2, X, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface ClientsProps {
  profile: UserProfile | null;
}

export default function Clients({ profile }: ClientsProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  
  const [newClient, setNewClient] = useState({
    name: "",
    phone: "",
    address: "",
    function: ""
  });

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('nom_prenom', { ascending: true });
      if (error) throw error;
      setClients((data || []).map(item => ({
        id: item.id_client.toString(),
        name: item.nom_prenom,
        phone: item.num_telephone,
        address: item.adresse,
        function: item.fonction,
        createdAt: new Date(),
        updatedAt: new Date()
      } as Client)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingClientId) {
        const { error } = await supabase
          .from('clients')
          .update({
            nom_prenom: newClient.name,
            num_telephone: newClient.phone,
            adresse: newClient.address,
            fonction: newClient.function
          })
          .eq('id_client', parseInt(editingClientId));
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('clients')
          .insert({
            nom_prenom: newClient.name,
            num_telephone: newClient.phone,
            adresse: newClient.address,
            fonction: newClient.function
          });
        if (error) throw error;
      }
      setShowAddModal(false);
      setEditingClientId(null);
      setNewClient({ name: "", phone: "", address: "", function: "" });
      fetchClients();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleEditClick = (client: Client) => {
    setEditingClientId(client.id);
    setNewClient({
      name: client.name,
      phone: client.phone || "",
      address: client.address || "",
      function: client.function || ""
    });
    setShowAddModal(true);
  };

  const filtered = clients.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    (c.phone && c.phone.includes(search))
  );

  return (
    <div className="h-full overflow-y-auto p-8">
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">GESTION DES CLIENTS</h2>
          <p className="text-sm text-slate-500 font-medium">Référentiel complet de vos clients et partenaires.</p>
        </div>
        <button 
          onClick={() => {
            setEditingClientId(null);
            setNewClient({ name: "", phone: "", address: "", function: "" });
            setShowAddModal(true);
          }}
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-6 rounded-2xl flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all"
        >
          <Plus className="h-5 w-5" />
          Nouveau Client
        </button>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Rechercher par nom ou téléphone..." 
            className="w-full bg-slate-50 border-none rounded-xl py-3 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-emerald-500/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((client) => (
            <div key={client.id} className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm hover:shadow-xl transition-all group overflow-hidden relative">
              <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-50/50 rounded-bl-[40px] flex items-center justify-center translate-x-4 -translate-y-4 group-hover:translate-x-0 group-hover:-translate-y-0 transition-transform">
                <User className="h-6 w-6 text-emerald-300" />
              </div>

              <div className="flex items-center gap-4 mb-6">
                <div className="h-14 w-14 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-700 font-black text-xl border-2 border-emerald-50">
                  {client.name[0].toUpperCase()}
                </div>
                <div>
                  <h4 className="text-lg font-black text-slate-900 group-hover:text-emerald-600 transition-colors uppercase leading-tight">{client.name}</h4>
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold mt-1">
                    <Briefcase className="h-3 w-3" />
                    {client.function || 'Particulier'}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm text-slate-500 bg-slate-50 p-3 rounded-2xl">
                  <Phone className="h-4 w-4 text-emerald-500" />
                  <span className="font-bold">{client.phone || '--'}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-500 p-3">
                  <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="leading-snug truncate">{client.address || 'Aucune adresse enregistrée'}</span>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Partenaire GFeed</span>
                <button 
                  onClick={() => handleEditClick(client)}
                  className="h-10 w-10 flex items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:bg-emerald-500 hover:text-white transition-all"
                  title="Modifier"
                >
                  <Edit2 className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-12 text-slate-500 font-medium">
              Aucun client trouvé.
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Client Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowAddModal(false);
                setEditingClientId(null);
              }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-white rounded-[32px] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                    {editingClientId ? 'Modifier le client' : 'Nouveau client'}
                  </h3>
                  <p className="text-sm text-slate-500 font-medium text-emerald-600">
                    {editingClientId ? 'Modifiez les informations du partenaire.' : 'Ajouter un nouveau partenaire ou éleveur.'}
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingClientId(null);
                  }}
                  className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleSaveClient} className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Nom Complet</label>
                    <input 
                      type="text" 
                      required
                      placeholder="Ex: Adil Larach"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500/20"
                      value={newClient.name}
                      onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Téléphone</label>
                      <input 
                        type="text" 
                        placeholder="Ex: 0661962189"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500/20"
                        value={newClient.phone}
                        onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Fonction / Profil</label>
                      <select
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500/20"
                        value={newClient.function}
                        onChange={(e) => setNewClient({ ...newClient, function: e.target.value })}
                      >
                        <option value="">Sélectionner...</option>
                        <option value="Eleveur">Eleveur</option>
                        <option value="Technicien">Technicien</option>
                        <option value="Vétérinaire">Vétérinaire</option>
                        <option value="Inséminateur">Inséminateur</option>
                        <option value="Revendeur">Revendeur</option>
                        <option value="Client Comptoir">Client Comptoir</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Adresse</label>
                    <textarea 
                      placeholder="Ex: Larache, Maroc"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500/20 h-24 resize-none"
                      value={newClient.address}
                      onChange={(e) => setNewClient({ ...newClient, address: e.target.value })}
                    />
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-200 flex items-center justify-end gap-4">
                  <button 
                    type="button"
                    onClick={() => {
                      setShowAddModal(false);
                      setEditingClientId(null);
                    }}
                    className="px-6 py-3 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all text-sm"
                  >
                    Annuler
                  </button>
                  <button 
                    type="submit"
                    disabled={saving}
                    className="px-8 py-3 bg-emerald-500 text-white font-black rounded-2xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center gap-2 text-sm"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {saving ? 'ENREGISTREMENT...' : 'ENREGISTRER'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </div>
  );
}
