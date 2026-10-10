import { useEffect, useState, type FormEvent } from 'react';
import AppLayout from '../../components/AppLayout';
import AdminNav from '../../components/AdminNav';
import { supabase } from '../../lib/supabaseClient';
import { logActivity } from '../../lib/activityLog';
import {
  chargerStructures,
  PALETTE_STRUCTURES,
  prochaineCouleur,
  type Structure,
} from '../../lib/structures';
import BadgeStructure from '../../components/BadgeStructure';

type StructureRow = Structure;

// Choix d'une couleur : couleurs proposées + couleur libre.
function ChoixCouleur({
  valeur,
  onChange,
  idLibre,
  desactive,
}: {
  valeur: string;
  onChange: (c: string) => void;
  idLibre: string;
  desactive?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Couleur de la structure">
      {PALETTE_STRUCTURES.map((p) => {
        const choisie = p.valeur.toUpperCase() === valeur.toUpperCase();
        return (
          <button
            key={p.valeur}
            type="button"
            role="radio"
            aria-checked={choisie}
            aria-label={p.nom}
            title={p.nom}
            disabled={desactive}
            onClick={() => onChange(p.valeur)}
            className={`w-7 h-7 min-h-0 p-0 shrink-0 rounded-full border-2 flex items-center justify-center leading-none disabled:opacity-50 ${choisie ? 'border-ink' : 'border-surface'}`}
            style={{ backgroundColor: p.valeur, boxShadow: '0 0 0 1px #E3E1DB' }}
          >
            {choisie && <span className="text-white text-xs">✓</span>}
          </button>
        );
      })}
      <label htmlFor={idLibre} className="flex items-center gap-1 text-xs text-muted ml-1 cursor-pointer">
        <input
          id={idLibre}
          type="color"
          value={valeur}
          disabled={desactive}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-7 h-7 p-0 border border-border rounded cursor-pointer bg-surface"
        />
        Autre
      </label>
    </div>
  );
}

export default function Structures() {
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [affectations, setAffectations] = useState<{ user_id: string; structure_id: string }[]>([]);
  const [groupes, setGroupes] = useState<{ structure_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [nomNouvelle, setNomNouvelle] = useState('');
  const [couleurNouvelle, setCouleurNouvelle] = useState<string | null>(null);
  // false tant que la mise à jour SQL des couleurs n'a pas été exécutée
  const [couleursDisponibles, setCouleursDisponibles] = useState(false);
  const [couleurEnCours, setCouleurEnCours] = useState<string | null>(null);
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
    const [{ structures: s, erreur: err1, couleurs }, { data: a }, { data: g }] = await Promise.all([
      chargerStructures(),
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
    setStructures(s);
    setCouleursDisponibles(couleurs);
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
    const couleur = couleurNouvelle ?? prochaineCouleur(structures.map((x) => x.color));
    const { error } = await supabase
      .from('structures')
      .insert(couleursDisponibles ? { name: nom, color: couleur } : { name: nom });
    setCreation(false);
    if (error) {
      setErreurCreation(messageErreur(error.code, 'La création a échoué. Réessaie dans un instant.'));
      return;
    }
    setNomNouvelle('');
    setCouleurNouvelle(null);
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

  async function changerCouleur(s: StructureRow, couleur: string) {
    if (couleur.toUpperCase() === s.color.toUpperCase()) return;
    setCouleurEnCours(s.id);
    setErreurLigne(null);
    // Affichage immédiat, puis enregistrement
    setStructures((prev) => prev.map((x) => (x.id === s.id ? { ...x, color: couleur } : x)));
    const { error } = await supabase.from('structures').update({ color: couleur }).eq('id', s.id);
    setCouleurEnCours(null);
    if (error) {
      setErreurLigne({ id: s.id, message: "La couleur n'a pas pu être enregistrée. Réessaie dans un instant." });
      await charger();
      return;
    }
    await logActivity(`a changé la couleur de la structure « ${s.name} »`, 'structure', s.id);
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
        {couleursDisponibles &&
          ' La couleur de chaque structure aide formateurs et arbitres à reconnaître ses QCM et ses groupes.'}
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
      {couleursDisponibles && nomNouvelle.trim() && (
        <div className="mb-2">
          <p className="text-xs text-muted mb-1">Couleur de la nouvelle structure</p>
          <ChoixCouleur
            idLibre="couleur-nouvelle"
            valeur={couleurNouvelle ?? prochaineCouleur(structures.map((x) => x.color))}
            onChange={setCouleurNouvelle}
          />
        </div>
      )}
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
                  <BadgeStructure structure={s} className="text-sm font-medium" />
                  <span className="text-xs text-muted text-right">
                    {nombreComptes(s.id)} compte(s) · {nombreGroupes(s.id)} groupe(s)
                  </span>
                </div>
                {couleursDisponibles && (
                  <div className="mb-3">
                    <ChoixCouleur
                      idLibre={`couleur-${s.id}`}
                      valeur={s.color}
                      desactive={couleurEnCours === s.id}
                      onChange={(c) => changerCouleur(s, c)}
                    />
                  </div>
                )}
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
