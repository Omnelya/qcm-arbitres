import { useEffect, useState, type FormEvent } from 'react';
import AppLayout from '../../components/AppLayout';
import AdminNav from '../../components/AdminNav';
import { supabase } from '../../lib/supabaseClient';
import { logActivity } from '../../lib/activityLog';

interface StructureRow {
  id: string;
  name: string;
}

export default function Structures() {
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [affectations, setAffectations] = useState<{ user_id: string; structure_id: string }[]>([]);
  const [groupes, setGroupes] = useState<{ structure_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [nomNouvelle, setNomNouvelle] = useState('');
  const [creation, setCreation] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  const [renommageId, setRenommageId] = useState<string | null>(null);
  const [nomEdite, setNomEdite] = useState('');
  const [suppressionId, setSuppressionId] = useState<string | null>(null);
  const [erreurLigne, setErreurLigne] = useState<{ id: string; message: string } | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function charger() {
    setLoading(true);
    setErreur(null);
    const [{ data: s, error: err1 }, { data: a }, { data: g }] = await Promise.all([
      supabase.from('structures').select('id, name').order('name'),
      supabase.from('user_structures').select('user_id, structure_id'),
      supabase.from('groups').select('structure_id'),
    ]);
    if (err1) {
      setErreur(
        "Impossible de charger les structures. Si la mise à jour de la base de données (fichier SQL des structures) n'a pas encore été exécutée dans Supabase, c'est normal."
      );
      setLoading(false);
      return;
    }
    setStructures(s ?? []);
    setAffectations(a ?? []);
    setGroupes(g ?? []);
    setLoading(false);
  }

  useEffect(() => {
    charger();
  }, []);

  function messageErreur(code: string | undefined, defaut: string) {
    if (code === '23505') return 'Une structure porte déjà ce nom.';
    if (code === '23503')
      return 'Suppression impossible : des groupes sont rattachés à cette structure. Les formateurs doivent d’abord supprimer ces groupes.';
    return defaut;
  }

  async function creer(e: FormEvent) {
    e.preventDefault();
    const nom = nomNouvelle.trim();
    if (!nom) return;
    setCreation(true);
    setErreurCreation(null);
    const { error } = await supabase.from('structures').insert({ name: nom });
    setCreation(false);
    if (error) {
      setErreurCreation(messageErreur(error.code, 'La création a échoué. Réessaie dans un instant.'));
      return;
    }
    setNomNouvelle('');
    await logActivity(`a créé la structure « ${nom} »`, 'structure');
    await charger();
  }

  async function renommer(s: StructureRow) {
    const nom = nomEdite.trim();
    if (!nom || nom === s.name) {
      setRenommageId(null);
      return;
    }
    setEnCours(true);
    setErreurLigne(null);
    const { error } = await supabase.from('structures').update({ name: nom }).eq('id', s.id);
    setEnCours(false);
    if (error) {
      setErreurLigne({ id: s.id, message: messageErreur(error.code, 'Le renommage a échoué.') });
      return;
    }
    setRenommageId(null);
    await logActivity(`a renommé la structure « ${s.name} » en « ${nom} »`, 'structure', s.id);
    await charger();
  }

  async function supprimer(s: StructureRow) {
    setEnCours(true);
    setErreurLigne(null);
    const { error } = await supabase.from('structures').delete().eq('id', s.id);
    setEnCours(false);
    if (error) {
      setErreurLigne({ id: s.id, message: messageErreur(error.code, 'La suppression a échoué.') });
      return;
    }
    setSuppressionId(null);
    await logActivity(`a supprimé la structure « ${s.name} »`, 'structure', s.id);
    await charger();
  }

  function nombreComptes(id: string) {
    return affectations.filter((a) => a.structure_id === id).length;
  }
  function nombreGroupes(id: string) {
    return groupes.filter((g) => g.structure_id === id).length;
  }

  return (
    <AppLayout>
      <AdminNav />
      <h1 className="text-lg font-semibold mb-1">Structures</h1>
      <p className="text-sm text-muted mb-4">
        Une structure regroupe les arbitres et formateurs d'une même entité. Un formateur ne voit que les
        arbitres de ses structures. L'affectation des personnes se fait dans l'onglet Comptes.
      </p>

      <form onSubmit={creer} className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="Nom de la nouvelle structure"
          value={nomNouvelle}
          onChange={(e) => setNomNouvelle(e.target.value)}
          className="flex-1 border border-border rounded px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={creation || !nomNouvelle.trim()}
          className="bg-pitch text-white text-sm font-medium rounded px-4 disabled:opacity-60"
        >
          Créer
        </button>
      </form>
      {erreurCreation && <p className="text-sm text-card-red mb-2">{erreurCreation}</p>}

      {loading && <p className="text-sm text-muted mt-4">Chargement…</p>}
      {erreur && <p className="text-sm text-card-red mt-4">{erreur}</p>}
      {!loading && !erreur && structures.length === 0 && (
        <p className="text-sm text-muted mt-4">Aucune structure pour le moment.</p>
      )}

      <ul className="flex flex-col gap-2 mt-4">
        {structures.map((s) => (
          <li key={s.id} className="bg-surface border border-border rounded p-3">
            {renommageId === s.id ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nomEdite}
                  onChange={(e) => setNomEdite(e.target.value)}
                  className="flex-1 border border-border rounded px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => renommer(s)}
                  disabled={enCours || !nomEdite.trim()}
                  className="text-xs bg-pitch text-white rounded px-3 disabled:opacity-60"
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => setRenommageId(null)}
                  className="text-xs border border-border rounded px-3"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="text-xs text-muted text-right">
                    {nombreComptes(s.id)} compte(s) · {nombreGroupes(s.id)} groupe(s)
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRenommageId(s.id);
                      setNomEdite(s.name);
                      setSuppressionId(null);
                      setErreurLigne(null);
                    }}
                    className="flex-1 text-xs border border-border rounded py-1.5"
                  >
                    Renommer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSuppressionId(suppressionId === s.id ? null : s.id);
                      setErreurLigne(null);
                    }}
                    className="flex-1 text-xs border border-border rounded py-1.5 text-card-red"
                  >
                    Supprimer
                  </button>
                </div>
              </>
            )}

            {suppressionId === s.id && renommageId !== s.id && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-sm mb-2">
                  Supprimer « {s.name} » ? Les {nombreComptes(s.id)} compte(s) rattaché(s) ne seront pas
                  supprimés, ils ne feront simplement plus partie de cette structure.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSuppressionId(null)}
                    className="flex-1 border border-border rounded py-1.5 text-xs"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={() => supprimer(s)}
                    disabled={enCours}
                    className="flex-1 bg-card-red text-white rounded py-1.5 text-xs disabled:opacity-60"
                  >
                    {enCours ? 'Suppression…' : 'Supprimer'}
                  </button>
                </div>
              </div>
            )}

            {erreurLigne?.id === s.id && <p className="text-xs text-card-red mt-2">{erreurLigne.message}</p>}
          </li>
        ))}
      </ul>
    </AppLayout>
  );
}
