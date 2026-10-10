import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import FormateurNav from '../../components/FormateurNav';
import { supabase } from '../../lib/supabaseClient';
import BadgeStructure from '../../components/BadgeStructure';
import { chargerStructures, type Structure } from '../../lib/structures';
import { avecRetriesTimeout } from '../../lib/retryTimeout';

interface ArbitreRow {
  id: string;
  full_name: string;
  email: string;
}

export default function GroupMembers() {
  const { id: groupId } = useParams();

  const [nomGroupe, setNomGroupe] = useState('');
  const [structureGroupe, setStructureGroupe] = useState<Structure | null>(null);
  // true = ancien groupe pas encore rattaché à une structure : ses
  // membres ne peuvent pas être modifiés tant que ce n'est pas fait.
  const [aRattacher, setARattacher] = useState(false);
  const [arbitres, setArbitres] = useState<ArbitreRow[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [recherche, setRecherche] = useState('');
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [confirmation, setConfirmation] = useState(false);

  useEffect(() => {
    async function charger() {
      if (!groupId) return;
      setLoading(true);
      setErreur(null);

      // Structures : si la mise à jour SQL n'a pas encore été exécutée
      // dans Supabase, on retombe sur le fonctionnement d'avant.
      const { structures: structuresData, erreur: errStructures } = await chargerStructures();
      const structuresDisponibles = !errStructures;

      const [{ data: groupeBrut, error: err1 }, { data: idsArbitres }, { data: membresActuels }] =
        await Promise.all([
          supabase
            .from('groups')
            .select(structuresDisponibles ? 'name, structure_id' : 'name')
            .eq('id', groupId)
            .single(),
          supabase.from('user_roles').select('user_id').eq('role', 'arbitre'),
          supabase.from('group_members').select('user_id').eq('group_id', groupId),
        ]);
      const groupe = groupeBrut as unknown as {
        name: string;
        structure_id?: string | null;
      } | null;

      if (err1 || !groupe) {
        setErreur('Impossible de charger ce groupe.');
        setLoading(false);
        return;
      }
      setNomGroupe(groupe.name);

      let ids = (idsArbitres ?? []).map((r) => r.user_id);

      if (structuresDisponibles) {
        if (!groupe.structure_id) {
          setARattacher(true);
          setLoading(false);
          return;
        }
        setStructureGroupe(structuresData.find((s) => s.id === groupe.structure_id) ?? null);
        // Seuls les arbitres de la structure du groupe peuvent en faire partie.
        const { data: affectes } = await supabase
          .from('user_structures')
          .select('user_id')
          .eq('structure_id', groupe.structure_id);
        const idsStructure = new Set((affectes ?? []).map((a) => a.user_id));
        ids = ids.filter((id) => idsStructure.has(id));
      }

      if (ids.length > 0) {
        const { data: profils } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', ids)
          .order('full_name');
        setArbitres(profils ?? []);
      }

      setSelection(new Set((membresActuels ?? []).map((m) => m.user_id)));
      setLoading(false);
    }
    charger();
  }, [groupId]);

  function basculer(id: string) {
    setConfirmation(false);
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function enregistrer() {
    if (!groupId) return;
    setEnregistrement(true);
    setErreur(null);

    const { error: errDelete } = await avecRetriesTimeout(() =>
      supabase.from('group_members').delete().eq('group_id', groupId),
    );
    if (errDelete) {
      setErreur("L'enregistrement a échoué. Réessaie dans un instant.");
      setEnregistrement(false);
      return;
    }
    if (selection.size > 0) {
      const { error } = await supabase.from('group_members').insert(
        Array.from(selection).map((userId) => ({
          group_id: groupId,
          user_id: userId,
        })),
      );
      if (error) {
        setErreur("L'enregistrement a échoué. Réessaie dans un instant.");
        setEnregistrement(false);
        return;
      }
    }
    setEnregistrement(false);
    setConfirmation(true);
  }

  const arbitresFiltres = arbitres.filter((a) => a.full_name.toLowerCase().includes(recherche.toLowerCase()));

  if (loading) {
    return (
      <AppLayout>
        <FormateurNav />
        <p className="text-sm text-muted">Chargement…</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <FormateurNav />
      <Link to="/formateur/groupes" className="text-sm text-muted underline mb-3 inline-block">
        ← Mes groupes
      </Link>
      <h1 className="text-lg font-semibold mb-1">{nomGroupe}</h1>
      {structureGroupe && <BadgeStructure structure={structureGroupe} className="mb-2" />}
      {aRattacher ? (
        <p className="text-sm text-card-yellow bg-card-yellow-bg rounded px-3 py-2">
          Ce groupe n'est rattaché à aucune structure. Retourne dans « Mes groupes » et rattache-le à une
          structure pour pouvoir modifier ses membres.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted mb-4">
            Coche les arbitres à inclure (
            {selection.size} sélectionné(s))
          </p>

          {erreur && <p className="text-sm text-card-red mb-3">{erreur}</p>}

          <input
            type="text"
            placeholder="Rechercher un arbitre…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-full border border-border rounded px-3 py-2 mb-4 text-sm"
          />

          {arbitresFiltres.length === 0 && <p className="text-sm text-muted">Aucun arbitre trouvé.</p>}

          <ul className="mb-6">
            {arbitresFiltres.map((a) => (
              <li key={a.id} className="border-b border-border py-2">
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={selection.has(a.id)} onChange={() => basculer(a.id)} />
                  <span className="text-sm">{a.full_name}</span>
                </label>
              </li>
            ))}
          </ul>

          {confirmation && (
            <p className="text-sm text-pitch-dark bg-pitch-light rounded px-3 py-2 mb-3">Enregistré.</p>
          )}

          <button
            type="button"
            onClick={enregistrer}
            disabled={enregistrement}
            className="w-full bg-pitch text-white font-medium rounded py-2 disabled:opacity-60"
          >
            {enregistrement ? 'Enregistrement…' : `Enregistrer (${selection.size} arbitre(s))`}
          </button>
        </>
      )}
    </AppLayout>
  );
}
