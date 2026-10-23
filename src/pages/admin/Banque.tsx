import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import AppLayout from '../../components/AppLayout';
import BadgeStructure from '../../components/BadgeStructure';
import { supabase } from '../../lib/supabaseClient';
import { logActivity } from '../../lib/activityLog';
import { chargerStructures, type Structure } from '../../lib/structures';
import { lireQuestionsBanque, type ResultatLecture } from '../../lib/banqueExcel';

interface BanqueRow {
  id: string;
  name: string;
  nbQuestions: number;
  nbThemes: number;
  structureIds: string[];
}

interface ThemeRow {
  id: string;
  name: string;
  nb: number;
}

interface QuestionRow {
  id: string;
  numero: number | null;
  text: string;
  theme_id: string | null;
  banque_options: { text: string; is_correct: boolean; position: number }[];
}

const TAILLE_PAGE = 25;

function messageErreur(err: { code?: string } | null, defaut: string): string {
  return err?.code === '23505' ? 'Ce nom est déjà utilisé.' : defaut;
}

// Fenêtre de confirmation (même présentation que la suppression d'un QCM)
function Confirmation({
  titre,
  texte,
  bouton,
  enCours,
  erreur,
  onAnnuler,
  onConfirmer,
}: {
  titre: string;
  texte: string;
  bouton: string;
  enCours: boolean;
  erreur: string | null;
  onAnnuler: () => void;
  onConfirmer: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/45 flex items-center justify-center p-4"
      onClick={() => !enCours && onAnnuler()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="titre-confirmation"
        className="bg-surface rounded-2xl shadow-carte-haute w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="titre-confirmation" className="font-bold mb-1">
          {titre}
        </p>
        <p className="text-sm text-muted mb-4">{texte}</p>
        {erreur && <p className="text-sm text-card-red mb-3">{erreur}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            autoFocus
            onClick={onAnnuler}
            disabled={enCours}
            className="flex-1 bg-canvas rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            disabled={enCours}
            className="flex-1 bg-card-red text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
          >
            {enCours ? 'Patiente…' : bouton}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Détail d'une banque : structures autorisées, thèmes, questions
// ---------------------------------------------------------------------------
function DetailBanque({
  banque,
  structures,
  onRetour,
  onChange,
}: {
  banque: BanqueRow;
  structures: Structure[];
  onRetour: () => void;
  onChange: () => void;
}) {
  const [structureIds, setStructureIds] = useState<string[]>(banque.structureIds);
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [nbSansTheme, setNbSansTheme] = useState(0);
  const [nouveauTheme, setNouveauTheme] = useState('');
  const [renommage, setRenommage] = useState<{ id: string; nom: string } | null>(null);
  const [themeASupprimer, setThemeASupprimer] = useState<string | null>(null);

  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [recherche, setRecherche] = useState('');
  const [rechercheEffective, setRechercheEffective] = useState('');
  const [filtreTheme, setFiltreTheme] = useState(''); // '' = tous, 'none' = sans thème, sinon id
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  const [themeCible, setThemeCible] = useState('none');
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());

  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [confirmerBanque, setConfirmerBanque] = useState(false);
  const [suppressionBanque, setSuppressionBanque] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);

  const chargerThemes = useCallback(async () => {
    const { data, error } = await supabase
      .from('banque_themes')
      .select('id, name')
      .eq('banque_id', banque.id)
      .order('name');
    if (error) {
      setErreur('Impossible de charger les thèmes.');
      return;
    }
    const lignes = await Promise.all(
      (data ?? []).map(async (t) => {
        const { count } = await supabase
          .from('banque_questions')
          .select('id', { count: 'exact', head: true })
          .eq('theme_id', t.id);
        return { id: t.id as string, name: t.name as string, nb: count ?? 0 };
      })
    );
    setThemes(lignes);
    const { count } = await supabase
      .from('banque_questions')
      .select('id', { count: 'exact', head: true })
      .eq('banque_id', banque.id)
      .is('theme_id', null);
    setNbSansTheme(count ?? 0);
  }, [banque.id]);

  // Applique recherche + filtre de thème à une requête Supabase (select ou update)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function filtrer(q: any) {
    let r = q;
    const mot = rechercheEffective.trim();
    if (mot) r = r.ilike('text', `%${mot.replace(/[\\%_]/g, '\\$&')}%`);
    if (filtreTheme === 'none') r = r.is('theme_id', null);
    else if (filtreTheme) r = r.eq('theme_id', filtreTheme);
    return r;
  }

  const chargerQuestions = useCallback(async () => {
    const base = supabase
      .from('banque_questions')
      .select('id, numero, text, theme_id, banque_options(text, is_correct, position)', { count: 'exact' })
      .eq('banque_id', banque.id);
    const { data, count, error } = await filtrer(base)
      .order('numero')
      .range(page * TAILLE_PAGE, page * TAILLE_PAGE + TAILLE_PAGE - 1);
    if (error) {
      setErreur('Impossible de charger les questions.');
      return;
    }
    setQuestions((data ?? []) as unknown as QuestionRow[]);
    setTotal(count ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banque.id, page, rechercheEffective, filtreTheme]);

  useEffect(() => {
    chargerThemes();
  }, [chargerThemes]);

  useEffect(() => {
    chargerQuestions();
  }, [chargerQuestions]);

  // la recherche se lance un instant après la frappe
  useEffect(() => {
    const t = setTimeout(() => {
      setRechercheEffective(recherche);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [recherche]);

  async function basculerStructure(id: string) {
    setErreur(null);
    const present = structureIds.includes(id);
    const { error } = present
      ? await supabase.from('banque_structures').delete().eq('banque_id', banque.id).eq('structure_id', id)
      : await supabase.from('banque_structures').insert({ banque_id: banque.id, structure_id: id });
    if (error) {
      setErreur('Impossible de modifier les structures. Réessaie dans un instant.');
      return;
    }
    setStructureIds((prev) => (present ? prev.filter((x) => x !== id) : [...prev, id]));
    onChange();
  }

  async function ajouterTheme() {
    const nom = nouveauTheme.trim();
    if (!nom) return;
    setErreur(null);
    const { error } = await supabase.from('banque_themes').insert({ banque_id: banque.id, name: nom });
    if (error) {
      setErreur(messageErreur(error, 'Impossible de créer le thème.'));
      return;
    }
    setNouveauTheme('');
    await chargerThemes();
    onChange();
  }

  async function renommerTheme() {
    if (!renommage) return;
    const nom = renommage.nom.trim();
    if (!nom) return;
    setErreur(null);
    const { error } = await supabase.from('banque_themes').update({ name: nom }).eq('id', renommage.id);
    if (error) {
      setErreur(messageErreur(error, 'Impossible de renommer le thème.'));
      return;
    }
    setRenommage(null);
    await chargerThemes();
  }

  async function supprimerTheme(id: string) {
    setErreur(null);
    const { error } = await supabase.from('banque_themes').delete().eq('id', id);
    setThemeASupprimer(null);
    if (error) {
      setErreur('Impossible de supprimer le thème.');
      return;
    }
    if (filtreTheme === id) setFiltreTheme('');
    await Promise.all([chargerThemes(), chargerQuestions()]);
    onChange();
  }

  async function changerThemeQuestion(questionId: string, valeur: string) {
    setErreur(null);
    const { error } = await supabase
      .from('banque_questions')
      .update({ theme_id: valeur === 'none' ? null : valeur })
      .eq('id', questionId);
    if (error) {
      setErreur('Impossible de changer le thème de cette question.');
      return;
    }
    await Promise.all([chargerThemes(), chargerQuestions()]);
  }

  async function appliquerTheme(cible: 'cochees' | 'resultats') {
    setErreur(null);
    setMessage(null);
    setOccupe(true);
    const champs = { theme_id: themeCible === 'none' ? null : themeCible };
    const requete = supabase.from('banque_questions').update(champs, { count: 'exact' }).eq('banque_id', banque.id);
    const { error, count } = cible === 'cochees' ? await requete.in('id', [...cochees]) : await filtrer(requete);
    setOccupe(false);
    if (error) {
      setErreur('Impossible d’appliquer le thème.');
      return;
    }
    setMessage(`${count ?? 0} question(s) mise(s) à jour.`);
    setCochees(new Set());
    await Promise.all([chargerThemes(), chargerQuestions()]);
  }

  async function supprimerBanque() {
    setSuppressionBanque(true);
    setErreurSuppression(null);
    const { error } = await supabase.from('banques').delete().eq('id', banque.id);
    setSuppressionBanque(false);
    if (error) {
      setErreurSuppression('La suppression a échoué. Réessaie dans un instant.');
      return;
    }
    await logActivity(`a supprimé la banque de questions « ${banque.name} »`, 'banque', banque.id);
    onChange();
    onRetour();
  }

  const nbPages = Math.max(1, Math.ceil(total / TAILLE_PAGE));
  const toutesCochees = questions.length > 0 && questions.every((q) => cochees.has(q.id));

  return (
    <div>
      <button type="button" onClick={onRetour} className="text-sm text-muted underline mb-3">
        ← Toutes les banques
      </button>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold break-words min-w-0">{banque.name}</h1>
        <button
          type="button"
          onClick={() => setConfirmerBanque(true)}
          className="shrink-0 text-sm text-card-red font-semibold"
        >
          Supprimer
        </button>
      </div>
      <p className="text-sm text-muted mb-4">{banque.nbQuestions} question(s)</p>

      {erreur && (
        <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded-xl px-3 py-2 mb-3">
          {erreur}
        </p>
      )}

      <section className="bg-surface border border-border rounded p-4 mb-4">
        <h2 className="font-bold mb-1">Structures autorisées</h2>
        <p className="text-sm text-muted mb-3">
          Les formateurs de ces structures peuvent piocher dans cette banque. Les autres ne la voient pas.
        </p>
        {structures.length === 0 ? (
          <p className="text-sm text-muted">Aucune structure n’existe encore (onglet Structures).</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {structures.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2 border border-border rounded-full pl-3 pr-2 py-1 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={structureIds.includes(s.id)}
                    onChange={() => basculerStructure(s.id)}
                  />
                  <BadgeStructure structure={s} />
                </label>
              </li>
            ))}
          </ul>
        )}
        {structureIds.length === 0 && structures.length > 0 && (
          <p className="text-sm text-muted mt-3">Aucune structure cochée : aucun formateur ne peut l’utiliser.</p>
        )}
      </section>

      <section className="bg-surface border border-border rounded p-4 mb-4">
        <h2 className="font-bold mb-1">Thèmes</h2>
        <p className="text-sm text-muted mb-3">
          Crée des thèmes (ex. : Terrain, Sanctions, Hors-jeu), puis range les questions dedans ci-dessous. Les
          formateurs pourront filtrer par thème.
        </p>
        <ul className="mb-3">
          {themes.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-1.5 border-b border-border last:border-0">
              {renommage?.id === t.id ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    value={renommage.nom}
                    onChange={(e) => setRenommage({ id: t.id, nom: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && renommerTheme()}
                    aria-label="Nouveau nom du thème"
                    className="flex-1 min-w-0 border border-border rounded-lg px-2 py-1 text-sm"
                  />
                  <button type="button" onClick={renommerTheme} className="text-sm font-semibold text-pitch">
                    OK
                  </button>
                  <button type="button" onClick={() => setRenommage(null)} className="text-sm text-muted">
                    Annuler
                  </button>
                </>
              ) : themeASupprimer === t.id ? (
                <>
                  <span className="flex-1 text-sm">Supprimer « {t.name} » ? Les questions restent, sans thème.</span>
                  <button type="button" onClick={() => supprimerTheme(t.id)} className="text-sm font-semibold text-card-red">
                    Confirmer
                  </button>
                  <button type="button" onClick={() => setThemeASupprimer(null)} className="text-sm text-muted">
                    Annuler
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 text-sm font-semibold break-words">{t.name}</span>
                  <span className="text-xs text-muted shrink-0">{t.nb} question(s)</span>
                  <button type="button" onClick={() => setRenommage({ id: t.id, nom: t.name })} className="text-sm text-muted underline">
                    Renommer
                  </button>
                  <button type="button" onClick={() => setThemeASupprimer(t.id)} className="text-sm text-card-red">
                    Supprimer
                  </button>
                </>
              )}
            </li>
          ))}
          {themes.length === 0 && <li className="text-sm text-muted">Aucun thème pour le moment.</li>}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ajouterTheme();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={nouveauTheme}
            onChange={(e) => setNouveauTheme(e.target.value)}
            placeholder="Nom du nouveau thème"
            aria-label="Nom du nouveau thème"
            className="flex-1 min-w-0 border border-border rounded-xl px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!nouveauTheme.trim()}
            className="bg-pitch text-white rounded-xl px-4 text-sm font-semibold disabled:opacity-50"
          >
            Ajouter
          </button>
        </form>
      </section>

      <section className="bg-surface border border-border rounded p-4">
        <h2 className="font-bold mb-3">Questions ({total})</h2>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher dans les questions"
            aria-label="Rechercher dans les questions"
            className="flex-1 min-w-0 border border-border rounded-xl px-3 py-2 text-sm"
          />
          <select
            value={filtreTheme}
            onChange={(e) => {
              setFiltreTheme(e.target.value);
              setPage(0);
            }}
            aria-label="Filtrer par thème"
            className="border border-border rounded-xl px-3 py-2 text-sm bg-surface"
          >
            <option value="">Tous les thèmes</option>
            <option value="none">Sans thème ({nbSansTheme})</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.nb})
              </option>
            ))}
          </select>
        </div>

        <div className="bg-canvas rounded-xl p-3 mb-3">
          <p className="text-sm font-semibold mb-2">Ranger dans un thème</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={themeCible}
              onChange={(e) => setThemeCible(e.target.value)}
              aria-label="Thème à appliquer"
              className="border border-border rounded-xl px-3 py-2 text-sm bg-surface"
            >
              <option value="none">Aucun thème</option>
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={occupe || cochees.size === 0}
              onClick={() => appliquerTheme('cochees')}
              className="bg-surface border border-border rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Aux {cochees.size} cochée(s)
            </button>
            <button
              type="button"
              disabled={occupe || total === 0}
              onClick={() => appliquerTheme('resultats')}
              className="bg-surface border border-border rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              À tous les {total} résultat(s)
            </button>
          </div>
          {message && <p className="text-sm text-pitch mt-2">{message}</p>}
        </div>

        {questions.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted mb-2">
            <input
              type="checkbox"
              checked={toutesCochees}
              onChange={() => setCochees(toutesCochees ? new Set() : new Set(questions.map((q) => q.id)))}
            />
            Tout cocher sur cette page
          </label>
        )}
        <ul>
          {questions.map((q) => {
            const options = [...q.banque_options].sort((a, b) => a.position - b.position);
            const ouverte = ouvertes.has(q.id);
            return (
              <li key={q.id} className="border-t border-border py-3">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={cochees.has(q.id)}
                    aria-label={`Cocher la question ${q.numero ?? ''}`}
                    onChange={() =>
                      setCochees((prev) => {
                        const s = new Set(prev);
                        if (s.has(q.id)) s.delete(q.id);
                        else s.add(q.id);
                        return s;
                      })
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm whitespace-pre-line break-words">
                      <span className="text-muted">{q.numero != null ? `Q${q.numero} · ` : ''}</span>
                      {q.text}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 mt-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setOuvertes((prev) => {
                            const s = new Set(prev);
                            if (s.has(q.id)) s.delete(q.id);
                            else s.add(q.id);
                            return s;
                          })
                        }
                        className="text-xs text-muted underline"
                      >
                        {ouverte ? 'Masquer les réponses' : `Voir les ${options.length} réponses`}
                      </button>
                      <select
                        value={q.theme_id ?? 'none'}
                        onChange={(e) => changerThemeQuestion(q.id, e.target.value)}
                        aria-label={`Thème de la question ${q.numero ?? ''}`}
                        className="border border-border rounded-lg px-2 py-1 text-xs bg-surface max-w-full"
                      >
                        <option value="none">Sans thème</option>
                        {themes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {ouverte && (
                      <ul className="mt-2 text-sm">
                        {options.map((o, i) => (
                          <li key={i} className={o.is_correct ? 'font-semibold text-pitch' : 'text-muted'}>
                            {o.is_correct ? '✓' : '·'} {o.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {questions.length === 0 && <li className="text-sm text-muted py-3">Aucune question ne correspond.</li>}
        </ul>

        {nbPages > 1 && (
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="text-sm font-semibold disabled:opacity-40"
            >
              ← Précédentes
            </button>
            <span className="text-xs text-muted">
              Page {page + 1} / {nbPages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= nbPages}
              onClick={() => setPage((p) => p + 1)}
              className="text-sm font-semibold disabled:opacity-40"
            >
              Suivantes →
            </button>
          </div>
        )}
      </section>

      {confirmerBanque && (
        <Confirmation
          titre={`Supprimer la banque « ${banque.name} » ?`}
          texte="Ses questions et ses thèmes seront supprimés. Les questions déjà copiées dans des QCM sont conservées."
          bouton="Supprimer"
          enCours={suppressionBanque}
          erreur={erreurSuppression}
          onAnnuler={() => setConfirmerBanque(false)}
          onConfirmer={supprimerBanque}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page : liste des banques + import d'un fichier Excel
// ---------------------------------------------------------------------------
export default function Banque() {
  const [structures, setStructures] = useState<Structure[]>([]);
  const [banques, setBanques] = useState<BanqueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreurListe, setErreurListe] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);

  const [nom, setNom] = useState('');
  const [structuresImport, setStructuresImport] = useState<Set<string>>(new Set());
  const [lecture, setLecture] = useState<ResultatLecture | null>(null);
  const [nomFichier, setNomFichier] = useState('');
  const [erreurFichier, setErreurFichier] = useState<string | null>(null);
  const [enImport, setEnImport] = useState(false);
  const [erreurImport, setErreurImport] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const { data, error } = await supabase
      .from('banques')
      .select('id, name, banque_questions(count), banque_themes(count), banque_structures(structure_id)')
      .order('name');
    if (error) {
      setErreurListe('Impossible de charger les banques. As-tu bien exécuté le SQL de la banque dans Supabase ?');
    } else {
      setErreurListe(null);
      setBanques(
        (data ?? []).map((b) => {
          const brut = b as unknown as {
            id: string;
            name: string;
            banque_questions: { count: number }[];
            banque_themes: { count: number }[];
            banque_structures: { structure_id: string }[];
          };
          return {
            id: brut.id,
            name: brut.name,
            nbQuestions: brut.banque_questions?.[0]?.count ?? 0,
            nbThemes: brut.banque_themes?.[0]?.count ?? 0,
            structureIds: (brut.banque_structures ?? []).map((s) => s.structure_id),
          };
        })
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    charger();
    chargerStructures().then((r) => setStructures(r.structures));
  }, [charger]);

  async function choisirFichier(e: ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    setErreurFichier(null);
    setErreurImport(null);
    setSucces(null);
    setLecture(null);
    try {
      const XLSX = await import('xlsx');
      const classeur = XLSX.read(await fichier.arrayBuffer(), { type: 'array' });
      const lignes = XLSX.utils.sheet_to_json<unknown[]>(classeur.Sheets[classeur.SheetNames[0]], {
        header: 1,
        defval: '',
      });
      const resultat = lireQuestionsBanque(lignes);
      if (resultat.questions.length === 0) {
        setErreurFichier('Aucune question reconnue dans ce fichier. Vérifie le format (Q1., puis [X] / [ ] pour les réponses).');
        return;
      }
      setLecture(resultat);
      setNomFichier(fichier.name);
      if (!nom.trim()) setNom(fichier.name.replace(/\.xlsx?$/i, '').replace(/_+/g, ' ').trim());
    } catch {
      setErreurFichier('Ce fichier n’a pas pu être lu. Utilise un fichier Excel (.xlsx).');
    }
  }

  async function importer() {
    if (!lecture || !nom.trim()) return;
    setEnImport(true);
    setErreurImport(null);
    const { error } = await supabase.rpc('banque_importer', {
      p_nom: nom.trim(),
      p_structures: [...structuresImport],
      p_questions: lecture.questions,
    });
    setEnImport(false);
    if (error) {
      setErreurImport(
        error.code === '23505'
          ? 'Une banque porte déjà ce nom. Choisis un autre nom.'
          : 'L’import a échoué, rien n’a été enregistré. Réessaie dans un instant.'
      );
      return;
    }
    await logActivity(`a importé la banque de questions « ${nom.trim()} » (${lecture.questions.length} questions)`, 'banque');
    setSucces(`Banque « ${nom.trim()} » importée : ${lecture.questions.length} questions.`);
    setLecture(null);
    setNom('');
    setNomFichier('');
    setStructuresImport(new Set());
    await charger();
  }

  const banqueOuverte = banques.find((b) => b.id === ouverte) ?? null;

  return (
    <AppLayout>
      {banqueOuverte ? (
        <DetailBanque
          key={banqueOuverte.id}
          banque={banqueOuverte}
          structures={structures}
          onRetour={() => setOuverte(null)}
          onChange={charger}
        />
      ) : (
        <div>
          <h1 className="text-xl font-bold mb-1">Banque de questions</h1>
          <p className="text-sm text-muted mb-4">
            Des questions préenregistrées que les formateurs des structures choisies peuvent copier dans leurs QCM.
            Elles ne sont visibles ni des arbitres ni des autres formateurs.
          </p>

          <section className="bg-surface border border-border rounded p-4 mb-4">
            <h2 className="font-bold mb-3">Importer un fichier Excel</h2>
            <label className="block text-sm text-muted mb-1" htmlFor="fichier-banque">
              Fichier (.xlsx)
            </label>
            <input
              id="fichier-banque"
              type="file"
              accept=".xlsx,.xls"
              onChange={choisirFichier}
              className="block w-full text-sm mb-3"
            />
            {erreurFichier && (
              <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded-xl px-3 py-2 mb-3">
                {erreurFichier}
              </p>
            )}

            {lecture && (
              <div>
                <div className="bg-canvas rounded-xl p-3 mb-3 text-sm">
                  <p className="font-semibold">{nomFichier}</p>
                  <p>{lecture.questions.length} question(s) prête(s) à importer.</p>
                  {lecture.doublons.length > 0 && (
                    <p className="text-muted">
                      {lecture.doublons.length} doublon(s) exact(s) ignoré(s) (même énoncé, mêmes réponses).
                    </p>
                  )}
                  {lecture.invalides.length > 0 && (
                    <p>
                      {lecture.invalides.length} question(s) inutilisable(s), ignorée(s) :{' '}
                      {lecture.invalides.slice(0, 20).join(', ')}
                      {lecture.invalides.length > 20 ? '…' : ''}
                    </p>
                  )}
                </div>

                <label className="block text-sm text-muted mb-1" htmlFor="nom-banque">
                  Nom de la banque
                </label>
                <input
                  id="nom-banque"
                  type="text"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm mb-3"
                />

                <p className="text-sm text-muted mb-1">Structures autorisées</p>
                <ul className="flex flex-wrap gap-2 mb-3">
                  {structures.map((s) => (
                    <li key={s.id}>
                      <label className="flex items-center gap-2 border border-border rounded-full pl-3 pr-2 py-1 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={structuresImport.has(s.id)}
                          onChange={() =>
                            setStructuresImport((prev) => {
                              const n = new Set(prev);
                              if (n.has(s.id)) n.delete(s.id);
                              else n.add(s.id);
                              return n;
                            })
                          }
                        />
                        <BadgeStructure structure={s} />
                      </label>
                    </li>
                  ))}
                  {structures.length === 0 && (
                    <li className="text-sm text-muted">Aucune structure : crées-en d’abord dans l’onglet Structures.</li>
                  )}
                </ul>
                <p className="text-xs text-muted mb-3">Tu pourras modifier ce choix plus tard.</p>

                {erreurImport && (
                  <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded-xl px-3 py-2 mb-3">
                    {erreurImport}
                  </p>
                )}
                <button
                  type="button"
                  onClick={importer}
                  disabled={enImport || !nom.trim()}
                  className="w-full bg-pitch text-white font-semibold rounded-xl py-2.5 disabled:opacity-60"
                >
                  {enImport ? 'Import en cours…' : `Importer ${lecture.questions.length} questions`}
                </button>
              </div>
            )}
            {succes && <p className="text-sm text-pitch mt-3">{succes}</p>}
          </section>

          <h2 className="font-bold mb-2">Banques existantes</h2>
          {loading ? (
            <p className="text-sm text-muted">Chargement…</p>
          ) : erreurListe ? (
            <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded-xl px-3 py-2">
              {erreurListe}
            </p>
          ) : banques.length === 0 ? (
            <p className="text-sm text-muted">Aucune banque pour le moment.</p>
          ) : (
            <ul className="space-y-3">
              {banques.map((b) => (
                <li key={b.id} className="bg-surface border border-border rounded p-4">
                  <button type="button" onClick={() => setOuverte(b.id)} className="w-full text-left">
                    <p className="font-bold break-words">{b.name}</p>
                    <p className="text-sm text-muted mb-2">
                      {b.nbQuestions} question(s) · {b.nbThemes} thème(s)
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {structures
                        .filter((s) => b.structureIds.includes(s.id))
                        .map((s) => (
                          <BadgeStructure key={s.id} structure={s} />
                        ))}
                      {b.structureIds.length === 0 && (
                        <span className="text-xs text-muted">Aucune structure autorisée</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-pitch mt-2">Gérer →</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AppLayout>
  );
}
