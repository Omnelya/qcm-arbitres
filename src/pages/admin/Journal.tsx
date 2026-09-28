import { useEffect, useState } from 'react';
import AppLayout from '../../components/AppLayout';
import AdminNav from '../../components/AdminNav';
import { supabase } from '../../lib/supabaseClient';

interface LigneJournal {
  id: string;
  action: string;
  created_at: string;
  auteur: string;
}
interface ProfilLeger {
  id: string;
  full_name: string;
}

export default function Journal() {
  const [lignes, setLignes] = useState<LigneJournal[]>([]);
  const [personnes, setPersonnes] = useState<ProfilLeger[]>([]);
  const [filtre, setFiltre] = useState('tous');
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    async function charger() {
      setLoading(true);
      setErreur(null);

      let requete = supabase
        .from('activity_log')
        .select('id, action, created_at, user_id')
        // Les connexions ne figurent plus dans le journal : la dernière
        // connexion de chacun est affichée dans l'onglet Comptes.
        .neq('action', "s'est connecté")
        .order('created_at', { ascending: false })
        .limit(100);

      if (filtre !== 'tous') {
        requete = requete.eq('user_id', filtre);
      }

      const { data: entrees, error: err1 } = await requete;

      if (err1) {
        setErreur('Impossible de charger le journal. Réessaie dans un instant.');
        setLoading(false);
        return;
      }

      const userIds = Array.from(new Set((entrees ?? []).map((e) => e.user_id).filter(Boolean)));
      let noms: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profils } = await supabase.from('profiles').select('id, full_name').in('id', userIds as string[]);
        noms = Object.fromEntries((profils ?? []).map((p) => [p.id, p.full_name]));
      }

      setLignes(
        (entrees ?? []).map((e) => ({
          id: e.id,
          action: e.action,
          created_at: e.created_at,
          auteur: e.user_id ? (noms[e.user_id] ?? 'Compte supprimé') : 'Système',
        }))
      );
      setLoading(false);
    }
    charger();
  }, [filtre]);

  useEffect(() => {
    async function chargerPersonnes() {
      const { data } = await supabase.from('profiles').select('id, full_name').order('full_name');
      setPersonnes(data ?? []);
    }
    chargerPersonnes();
  }, []);

  function formatDate(d: string) {
    return new Date(d).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <AppLayout>
      <AdminNav />
      <h1 className="text-lg font-semibold mb-4">Journal d'activité</h1>

      <label className="block text-xs text-muted mb-1">Filtrer par personne</label>
      <select
        value={filtre}
        onChange={(e) => setFiltre(e.target.value)}
        className="w-full border border-border rounded px-3 py-2 mb-4 text-sm"
      >
        <option value="tous">Toutes les personnes</option>
        {personnes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </select>

      {loading && <p className="text-sm text-muted">Chargement…</p>}
      {erreur && <p className="text-sm text-card-red">{erreur}</p>}
      {!loading && !erreur && lignes.length === 0 && (
        <p className="text-sm text-muted">Aucune activité enregistrée pour le moment.</p>
      )}

      <ul>
        {lignes.map((l) => (
          <li key={l.id} className="border-b border-border py-2.5">
            <p className="text-sm">
              <span className="font-medium">{l.auteur}</span> {l.action}
            </p>
            <p className="text-xs text-muted mt-0.5">{formatDate(l.created_at)}</p>
          </li>
        ))}
      </ul>
    </AppLayout>
  );
}
