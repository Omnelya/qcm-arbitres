import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import FormateurNav from '../../components/FormateurNav';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import BadgeStructure from '../../components/BadgeStructure';
import { chargerStructures, type Structure } from '../../lib/structures';

interface GroupRow {
  id: string;
  name: string;
  formateur_id: string;
  // null = groupe créé avant la mise en place des structures
  structure_id: string | null;
}
type StructureRow = Structure;
interface ProfilLeger {
  id: string;
  full_name: string;
}

export default function Groupes() {
  const { session } = useAuth();
  const [groupes, setGroupes] = useState<GroupRow[]>([]);
  const [membres, setMembres] = useState<{ group_id: string; user_id: string }[]>([]);
  const [profils, setProfils] = useState<ProfilLeger[]>([]);
  const [formateurs, setFormateurs] = useState<ProfilLeger[]>([]);
  const [partages, setPartages] = useState<{ group_id: string; shared_with_user_id: string }[]>([]);

  // --- Structures ---
  // structuresDisponibles = false tant que la mise à jour SQL des
  // structures n'a pas été exécutée dans Supabase : la page fonctionne
  // alors comme avant.
  // structures = UNIQUEMENT celles auxquelles le formateur appartient
  // (création et rattachement de groupes). Un compte à la fois admin et
  // formateur voit toutes les structures en base : on ne s'en sert ici que
  // pour afficher l'étiquette d'un groupe partagé.
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [toutesStructures, setToutesStructures] = useState<StructureRow[]>([]);
  const [structuresDisponibles, setStructuresDisponibles] = useState(false);
  const [affectations, setAffectations] = useState<{ user_id: string; structure_id: string }[]>([]);
  const [structureNouveauGroupe, setStructureNouveauGroupe] = useState('');
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);
  const [structureRattachement, setStructureRattachement] = useState<Record<string, string>>({});
  const [rattachementEnCours, setRattachementEnCours] = useState<string | null>(null);
  const [erreurRattachement, setErreurRattachement] = useState<{ id: string; message: string } | null>(null);
  const [erreurPartage, setErreurPartage] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nomNouveauGroupe, setNomNouveauGroupe] = useState('');
  const [creation, setCreation] = useState(false);
  const [panneauPartageOuvert, setPanneauPartageOuvert] = useState<string | null>(null);
  const [confirmationSuppression, setConfirmationSuppression] = useState<string | null>(null);
  const [suppression, setSuppression] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);
  const [membresVisibles, setMembresVisibles] = useState<string | null>(null);

  async function charger() {
    setLoading(true);
    setErreur(null);

    const [{ structures: structuresData, erreur: errStructures }, { data: affectationsData }] = await Promise.all([
      chargerStructures(),
      supabase.from('user_structures').select('user_id, structure_id'),
    ]);
    const dispo = !errStructures;
    setStructuresDisponibles(dispo);
    const mesIds = new Set(
      (affectationsData ?? []).filter((a) => a.user_id === session?.user.id).map((a) => a.structure_id)
    );
    const miennes = structuresData.filter((s) => mesIds.has(s.id));
    setToutesStructures(structuresData);
    setStructures(miennes);
    setAffectations(affectationsData ?? []);
    // Une seule structure : elle est choisie d'office, sans question.
    if (dispo && miennes.length === 1) {
      setStructureNouveauGroupe(miennes[0].id);
    }

    const [
      { data: groupesData, error: err1 },
      { data: membresData },
      { data: partagesData },
      { data: rolesFormateurs },
      { data: profilsData },
    ] = await Promise.all([
      supabase
        .from('groups')
        .select(dispo ? 'id, name, formateur_id, structure_id' : 'id, name, formateur_id')
        .order('name'),
      supabase.from('group_members').select('group_id, user_id'),
      supabase.from('group_shares').select('group_id, shared_with_user_id'),
      supabase.from('user_roles').select('user_id').eq('role', 'formateur'),
      supabase.from('profiles').select('id, full_name'),
    ]);

    if (err1) {
      setErreur('Impossible de charger les groupes. Réessaie dans un instant.');
      setLoading(false);
      return;
    }

    setGroupes(
      ((groupesData ?? []) as unknown as Partial<GroupRow>[]).map((g) => ({
        id: g.id!,
        name: g.name!,
        formateur_id: g.formateur_id!,
        structure_id: g.structure_id ?? null,
      }))
    );
    setMembres(membresData ?? []);
    setPartages(partagesData ?? []);
    setProfils(profilsData ?? []);

    const idsFormateurs = new Set(
      (rolesFormateurs ?? []).map((r) => r.user_id).filter((id) => id !== session?.user.id)
    );
    setFormateurs((profilsData ?? []).filter((p) => idsFormateurs.has(p.id)));

    setLoading(false);
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function nombreMembres(groupId: string) {
    return membres.filter((m) => m.group_id === groupId).length;
  }

  function nomsMembres(groupId: string) {
    return membres
      .filter((m) => m.group_id === groupId)
      .map((m) => profils.find((p) => p.id === m.user_id)?.full_name ?? '—')
      .sort((a, b) => a.localeCompare(b));
  }

  function estPartageAvec(groupId: string, formateurId: string) {
    return partages.some((p) => p.group_id === groupId && p.shared_with_user_id === formateurId);
  }

  function structureDe(id: string | null) {
    return id ? (toutesStructures.find((s) => s.id === id) ?? null) : null;
  }

  // Formateurs avec qui un groupe peut être partagé : ceux de la
  // structure du groupe uniquement.
  function formateursPartageables(g: GroupRow) {
    if (!structuresDisponibles) return formateurs;
    if (!g.structure_id) return [];
    return formateurs.filter((f) =>
      affectations.some((a) => a.user_id === f.id && a.structure_id === g.structure_id)
    );
  }

  // Membres actuels d'un ancien groupe qui n'appartiennent pas à la
  // structure choisie (ils seront retirés au rattachement).
  function membresHorsStructure(groupId: string, structureId: string) {
    return membres.filter(
      (m) =>
        m.group_id === groupId &&
        !affectations.some((a) => a.user_id === m.user_id && a.structure_id === structureId)
    ).length;
  }

  async function creerGroupe(e: FormEvent) {
    e.preventDefault();
    if (!session || !nomNouveauGroupe.trim()) return;
    if (structuresDisponibles && !structureNouveauGroupe) {
      setErreurCreation('Choisis la structure dans laquelle créer ce groupe.');
      return;
    }
    setCreation(true);
    setErreurCreation(null);
    const { error } = await supabase.from('groups').insert(
      structuresDisponibles
        ? { name: nomNouveauGroupe.trim(), formateur_id: session.user.id, structure_id: structureNouveauGroupe }
        : { name: nomNouveauGroupe.trim(), formateur_id: session.user.id }
    );
    setCreation(false);
    if (error) {
      setErreurCreation('La création du groupe a échoué. Réessaie dans un instant.');
      return;
    }
    setNomNouveauGroupe('');
    await charger();
  }

  async function rattacherGroupe(g: GroupRow) {
    const structureId = structureRattachement[g.id];
    if (!structureId) return;
    setRattachementEnCours(g.id);
    setErreurRattachement(null);
    const { error } = await supabase.from('groups').update({ structure_id: structureId }).eq('id', g.id);
    setRattachementEnCours(null);
    if (error) {
      setErreurRattachement({ id: g.id, message: 'Le rattachement a échoué. Réessaie dans un instant.' });
      return;
    }
    await charger();
  }

  async function basculerPartage(groupId: string, formateurId: string, actif: boolean) {
    setErreurPartage(null);
    const { error } = actif
      ? await supabase
          .from('group_shares')
          .delete()
          .eq('group_id', groupId)
          .eq('shared_with_user_id', formateurId)
      : await supabase.from('group_shares').insert({ group_id: groupId, shared_with_user_id: formateurId });
    if (error) setErreurPartage('Le partage a échoué. Réessaie dans un instant.');
    await charger();
  }

  async function dupliquerGroupe(groupe: GroupRow) {
    if (!session) return;
    const { data: nouveauGroupe, error } = await supabase
      .from('groups')
      .insert(
        structuresDisponibles
          ? { name: `${groupe.name} (copie)`, formateur_id: session.user.id, structure_id: groupe.structure_id }
          : { name: `${groupe.name} (copie)`, formateur_id: session.user.id }
      )
      .select('id')
      .single();
    if (error || !nouveauGroupe) return;

    const membresACopier = membres.filter((m) => m.group_id === groupe.id);
    if (membresACopier.length > 0) {
      await supabase.from('group_members').insert(
        membresACopier.map((m) => ({ group_id: nouveauGroupe.id, user_id: m.user_id }))
      );
    }
    await charger();
  }

  async function supprimerGroupe(groupId: string) {
    setSuppression(true);
    setErreurSuppression(null);
    const { error } = await supabase.from('groups').delete().eq('id', groupId);
    setSuppression(false);
    if (error) {
      setErreurSuppression(error.message);
    } else {
      setConfirmationSuppression(null);
      await charger();
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <FormateurNav />
        <p className="text-sm text-muted">Chargement…</p>
      </AppLayout>
    );
  }

  const mesGroupes = groupes.filter((g) => g.formateur_id === session?.user.id);
  const groupesPartages = groupes.filter((g) => g.formateur_id !== session?.user.id);
  const sansStructure = structuresDisponibles && structures.length === 0;

  return (
    <AppLayout>
      <FormateurNav />
      <h1 className="text-lg font-semibold mb-4">Mes groupes</h1>
      {erreur && <p className="text-sm text-card-red mb-4">{erreur}</p>}

      {sansStructure ? (
        <p className="text-sm text-card-yellow bg-card-yellow-bg rounded px-3 py-2 mb-6">
          Tu n'es rattaché à aucune structure pour le moment : tu ne peux pas encore créer de groupe. Contacte
          l'administrateur pour qu'il t'affecte à ta structure.
        </p>
      ) : (
        <form onSubmit={creerGroupe} className="mb-6">
          {structuresDisponibles && structures.length > 1 && (
            <select
              value={structureNouveauGroupe}
              onChange={(e) => setStructureNouveauGroupe(e.target.value)}
              aria-label="Structure du nouveau groupe"
              className="w-full border border-border rounded px-3 py-2 text-sm mb-2"
            >
              <option value="">Choisir la structure du groupe…</option>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {structuresDisponibles && structures.length === 1 && (
            <p className="text-xs text-muted mb-2 flex items-center gap-1.5 flex-wrap">
              Nouveau groupe dans la structure <BadgeStructure structure={structures[0]} />
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={
                'Nom du nouveau groupe'
              }
              value={nomNouveauGroupe}
              onChange={(e) => setNomNouveauGroupe(e.target.value)}
              className="flex-1 border border-border rounded px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={creation || !nomNouveauGroupe.trim()}
              className="bg-pitch text-white text-sm font-medium rounded px-4 disabled:opacity-60"
            >
              Créer
            </button>
          </div>
          {erreurCreation && <p className="text-sm text-card-red mt-2">{erreurCreation}</p>}
        </form>
      )}

      {mesGroupes.length === 0 && groupesPartages.length === 0 && (
        <p className="text-sm text-muted">Aucun groupe pour le moment.</p>
      )}

      <ul className="flex flex-col gap-2 mb-6">
        {mesGroupes.map((g) => (
          <li key={g.id} className="bg-surface border border-border rounded p-3">
            <div className="flex items-center justify-between mb-2 gap-2">
              <span className="text-sm font-medium">
                {g.name}
                {structureDe(g.structure_id) && (
                  <BadgeStructure structure={structureDe(g.structure_id)!} className="ml-2 align-middle" />
                )}
              </span>
              <span className="text-xs text-muted shrink-0">{nombreMembres(g.id)} arbitre(s)</span>
            </div>

            {structuresDisponibles && !g.structure_id && (
              <div className="bg-card-yellow-bg rounded px-3 py-2 mb-2">
                <p className="text-xs text-card-yellow mb-2">
                  Ce groupe n'est rattaché à aucune structure. Rattache-le pour pouvoir modifier ses membres ou
                  le partager. Ce choix est définitif.
                </p>
                {structures.length === 0 ? (
                  <p className="text-xs text-muted">
                    Tu n'es rattaché à aucune structure : contacte l'administrateur.
                  </p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <select
                        value={structureRattachement[g.id] ?? ''}
                        onChange={(e) =>
                          setStructureRattachement((prev) => ({ ...prev, [g.id]: e.target.value }))
                        }
                        aria-label="Structure à laquelle rattacher le groupe"
                        className="flex-1 border border-border rounded px-2 py-1.5 text-xs bg-surface"
                      >
                        <option value="">Choisir une structure…</option>
                        {structures.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => rattacherGroupe(g)}
                        disabled={!structureRattachement[g.id] || rattachementEnCours === g.id}
                        className="text-xs bg-pitch text-white rounded px-3 disabled:opacity-60"
                      >
                        {rattachementEnCours === g.id ? '…' : 'Rattacher'}
                      </button>
                    </div>
                    {structureRattachement[g.id] &&
                      membresHorsStructure(g.id, structureRattachement[g.id]) > 0 && (
                        <p className="text-xs text-card-red mt-2">
                          Attention : {membresHorsStructure(g.id, structureRattachement[g.id])} arbitre(s) de ce
                          groupe n'appartiennent pas à cette structure et seront retirés du groupe.
                        </p>
                      )}
                  </>
                )}
                {erreurRattachement?.id === g.id && (
                  <p className="text-xs text-card-red mt-2">{erreurRattachement.message}</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Link
                to={`/formateur/groupes/${g.id}`}
                className="flex-1 text-center text-xs border border-border rounded py-1.5"
              >
                Modifier
              </Link>
              <button
                type="button"
                onClick={() => setPanneauPartageOuvert(panneauPartageOuvert === g.id ? null : g.id)}
                className="flex-1 text-xs border border-border rounded py-1.5"
              >
                Partager
              </button>
              <button
                type="button"
                onClick={() => {
                  setErreurSuppression(null);
                  setConfirmationSuppression(confirmationSuppression === g.id ? null : g.id);
                }}
                className="flex-1 text-xs border border-border rounded py-1.5 text-card-red"
              >
                Supprimer
              </button>
            </div>

            {confirmationSuppression === g.id && (
              <div className="mt-3 pt-3 border-t border-border">
                {erreurSuppression ? (
                  <p className="text-xs text-card-red">{erreurSuppression}</p>
                ) : (
                  <>
                    <p className="text-sm mb-2">Confirmer la suppression de ce groupe ?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmationSuppression(null)}
                        className="flex-1 border border-border rounded py-1.5 text-xs"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={() => supprimerGroupe(g.id)}
                        disabled={suppression}
                        className="flex-1 bg-card-red text-white rounded py-1.5 text-xs disabled:opacity-60"
                      >
                        {suppression ? 'Suppression…' : 'Supprimer'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {panneauPartageOuvert === g.id && (
              <div className="mt-3 pt-3 border-t border-border">
                {formateursPartageables(g).length === 0 && (
                  <p className="text-xs text-muted">
                    {structuresDisponibles && !g.structure_id
                      ? "Rattache d'abord ce groupe à une structure pour pouvoir le partager."
                      : structuresDisponibles
                        ? 'Aucun autre formateur dans cette structure pour le moment.'
                        : 'Aucun autre formateur pour le moment.'}
                  </p>
                )}
                {erreurPartage && <p className="text-xs text-card-red mb-1">{erreurPartage}</p>}
                {formateursPartageables(g).map((f) => {
                  const actif = estPartageAvec(g.id, f.id);
                  return (
                    <label key={f.id} className="flex items-center gap-2 text-sm py-1">
                      <input
                        type="checkbox"
                        checked={actif}
                        onChange={() => basculerPartage(g.id, f.id, actif)}
                      />
                      {f.full_name}
                    </label>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>

      {groupesPartages.length > 0 && (
        <>
          <p className="text-sm font-medium mb-2">Partagés avec toi</p>
          <ul className="flex flex-col gap-2">
            {groupesPartages.map((g) => (
              <li key={g.id} className="bg-surface border border-border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    {g.name}
                    {structureDe(g.structure_id) && (
                      <BadgeStructure structure={structureDe(g.structure_id)!} className="ml-2 align-middle" />
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {nombreMembres(g.id)} arbitre(s) · lecture seule
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMembresVisibles(membresVisibles === g.id ? null : g.id)}
                  className="w-full text-xs border border-border rounded py-1.5 mb-2"
                >
                  {membresVisibles === g.id ? 'Masquer les membres' : 'Voir les membres'}
                </button>

                {membresVisibles === g.id && (
                  <ul className="mb-2 text-sm">
                    {nomsMembres(g.id).length === 0 && (
                      <li className="text-xs text-muted">Ce groupe est vide.</li>
                    )}
                    {nomsMembres(g.id).map((nom, i) => (
                      <li key={i} className="py-1 border-t border-border first:border-t-0">
                        {nom}
                      </li>
                    ))}
                  </ul>
                )}

                {structuresDisponibles && !structures.some((s) => s.id === g.structure_id) ? (
                  <p className="text-xs text-muted">
                    Duplication impossible : ce groupe n'est pas rattaché à l'une de tes structures.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => dupliquerGroupe(g)}
                    className="w-full text-xs border border-border rounded py-1.5"
                  >
                    Dupliquer pour modifier
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </AppLayout>
  );
}
