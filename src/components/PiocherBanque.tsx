import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { memorisee, memoriser } from '../lib/dernierePage';

export interface BanqueInfo {
  id: string;
  name: string;
  nb_questions: number;
}
interface ThemeInfo {
  id: string;
  name: string;
  nb_questions: number;
}
interface LigneQuestion {
  id: string;
  numero: number | null;
  text: string;
  theme_id: string | null;
  deja_dans_qcm: boolean;
  options: { id: string; text: string; is_correct: boolean }[];
  total: number;
}
// Ce qui est retenu pour retrouver la fenêtre exactement là où on l'a laissée
interface Memo {
  banqueId: string;
  filtreTheme: string;
  recherche: string;
  page: number;
  cochees: string[];
  nombreHasard: number;
  haut: number;
}

const TAILLE_PAGE = 30;

// Fenêtre « Piocher dans la banque » (QCM en brouillon uniquement), ouverte depuis le
// bouton « Ajouter une question » de la page. Les banques accessibles sont fournies par la page.
export default function PiocherBanque({
  quizId,
  banques,
  ouvert,
  onFermer,
  onAjoute,
}: {
  quizId: string;
  banques: BanqueInfo[];
  ouvert: boolean;
  onFermer: () => void;
  onAjoute: () => void;
}) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const cle = `banque-qcm:${quizId}`;
  const [memo] = useState(() => (userId ? memorisee<Memo>(cle, userId) : null));

  const [banqueId, setBanqueId] = useState(memo?.banqueId ?? '');
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [filtreTheme, setFiltreTheme] = useState(memo?.filtreTheme ?? ''); // '' = tous, 'none' = sans thème, sinon id
  const [recherche, setRecherche] = useState(memo?.recherche ?? '');
  const [rechercheEffective, setRechercheEffective] = useState(memo?.recherche ?? '');
  const [page, setPage] = useState(memo?.page ?? 0);
  const [lignes, setLignes] = useState<LigneQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [cochees, setCochees] = useState<Set<string>>(new Set(memo?.cochees ?? []));
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [nombreHasard, setNombreHasard] = useState(memo?.nombreHasard ?? 10);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const zone = useRef<HTMLDivElement>(null);
  const hautARestaurer = useRef<number | null>(memo?.haut ?? null);
  const hautCourant = useRef(memo?.haut ?? 0);

  // banque choisie : celle retenue si elle existe encore, sinon la première
  useEffect(() => {
    if (banques.length === 0) return;
    if (!banques.some((b) => b.id === banqueId)) setBanqueId(banques[0].id);
  }, [banques, banqueId]);

  const sauver = useCallback(() => {
    if (!userId) return;
    memoriser(cle, userId, {
      banqueId,
      filtreTheme,
      recherche,
      page,
      cochees: [...cochees],
      nombreHasard,
      haut: hautCourant.current,
    } satisfies Memo);
  }, [userId, cle, banqueId, filtreTheme, recherche, page, cochees, nombreHasard]);

  useEffect(() => {
    sauver();
  }, [sauver]);

  // thèmes de la banque choisie
  useEffect(() => {
    if (!ouvert || !banqueId) return;
    supabase.rpc('banque_themes_liste', { p_banque: banqueId }).then(({ data }) => {
      // ordre naturel : « Règle 2 » avant « Règle 10 »
      setThemes(((data ?? []) as ThemeInfo[]).sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' })));
    });
  }, [ouvert, banqueId]);

  useEffect(() => {
    if (recherche === rechercheEffective) return; // évite de remettre la page à 0 au retour
    const t = setTimeout(() => {
      setRechercheEffective(recherche);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [recherche, rechercheEffective]);

  const chargerListe = useCallback(async () => {
    if (!ouvert || !banqueId) return;
    const { data, error } = await supabase.rpc('banque_questions_liste', {
      p_banque: banqueId,
      p_theme: filtreTheme && filtreTheme !== 'none' ? filtreTheme : null,
      p_sans_theme: filtreTheme === 'none',
      p_recherche: rechercheEffective.trim() || null,
      p_quiz: quizId,
      p_limite: TAILLE_PAGE,
      p_decalage: page * TAILLE_PAGE,
    });
    if (error) {
      setErreur('Impossible de charger les questions de la banque.');
      return;
    }
    const l = (data ?? []) as LigneQuestion[];
    setLignes(l);
    setTotal(l[0]?.total ?? 0);
  }, [ouvert, banqueId, filtreTheme, rechercheEffective, page, quizId]);

  useEffect(() => {
    chargerListe();
  }, [chargerListe]);

  // retour sur la fenêtre : on retrouve la position de défilement une fois la liste affichée
  useEffect(() => {
    if (ouvert && lignes.length > 0 && hautARestaurer.current != null && zone.current) {
      zone.current.scrollTop = hautARestaurer.current;
      hautARestaurer.current = null;
    }
  }, [ouvert, lignes]);

  async function ajouterCochees() {
    setOccupe(true);
    setErreur(null);
    const { data, error } = await supabase.rpc('banque_copier', { p_quiz: quizId, p_questions: [...cochees] });
    setOccupe(false);
    if (error) {
      setErreur('L’ajout a échoué. Rien n’a été ajouté, réessaie dans un instant.');
      return;
    }
    setInfo(`${data ?? 0} question(s) ajoutée(s) à ton QCM.`);
    setCochees(new Set());
    onAjoute();
    chargerListe();
  }

  async function ajouterAuHasard() {
    setOccupe(true);
    setErreur(null);
    const { data, error } = await supabase.rpc('banque_copier_hasard', {
      p_quiz: quizId,
      p_banque: banqueId,
      p_theme: filtreTheme && filtreTheme !== 'none' ? filtreTheme : null,
      p_nombre: nombreHasard,
    });
    setOccupe(false);
    if (error) {
      setErreur('L’ajout au hasard a échoué. Rien n’a été ajouté, réessaie dans un instant.');
      return;
    }
    setInfo(`${data ?? 0} question(s) ajoutée(s) au hasard à ton QCM.`);
    onAjoute();
    chargerListe();
  }

  if (!ouvert || banques.length === 0) return null;

  const nbPages = Math.max(1, Math.ceil(total / TAILLE_PAGE));
  const choisissables = lignes.filter((l) => !l.deja_dans_qcm);

  return (
    <div className="fixed inset-0 z-50 bg-ink/45 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !occupe && onFermer()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-banque"
        className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-carte-haute w-full max-w-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <p id="titre-banque" className="font-bold">
            Banque de questions
          </p>
          <button type="button" onClick={onFermer} className="text-sm text-muted underline">
            Fermer
          </button>
        </div>

        <div
          ref={zone}
          className="p-4 overflow-y-auto flex-1"
          onScroll={(e) => {
            hautCourant.current = e.currentTarget.scrollTop;
            sauver();
          }}
        >
          <p className="text-xs text-muted mb-3">
            Les questions sont <b>copiées</b> dans ton QCM : tu pourras ensuite les modifier sans toucher à la banque.
          </p>
          {erreur && (
            <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded-xl px-3 py-2 mb-3">
              {erreur}
            </p>
          )}
          {info && <p className="text-sm text-pitch mb-3">{info}</p>}

          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            {banques.length > 1 && (
              <select
                value={banqueId}
                onChange={(e) => {
                  setBanqueId(e.target.value);
                  setFiltreTheme('');
                  setPage(0);
                  setCochees(new Set());
                }}
                aria-label="Banque"
                className="border border-border rounded-xl px-3 py-2 text-sm bg-surface"
              >
                {banques.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={filtreTheme}
              onChange={(e) => {
                setFiltreTheme(e.target.value);
                setPage(0);
              }}
              aria-label="Thème"
              className="border border-border rounded-xl px-3 py-2 text-sm bg-surface"
            >
              <option value="">Tous les thèmes</option>
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.nb_questions})
                </option>
              ))}
              <option value="none">Sans thème</option>
            </select>
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher"
              aria-label="Rechercher"
              className="flex-1 min-w-0 border border-border rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <div className="bg-canvas rounded-xl p-3 mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span>Ajouter au hasard</span>
            <input
              type="number"
              min={1}
              max={200}
              value={nombreHasard}
              onChange={(e) => setNombreHasard(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              aria-label="Nombre de questions à ajouter au hasard"
              className="w-20 border border-border rounded-lg px-2 py-1"
            />
            <span>question(s) {filtreTheme && filtreTheme !== 'none' ? 'du thème choisi' : 'de la banque'}</span>
            <button
              type="button"
              onClick={ajouterAuHasard}
              disabled={occupe}
              className="ml-auto bg-surface border border-border rounded-xl px-3 py-1.5 font-semibold disabled:opacity-50"
            >
              Ajouter
            </button>
          </div>

          {choisissables.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted mb-2">
              <input
                type="checkbox"
                checked={choisissables.every((l) => cochees.has(l.id))}
                onChange={() =>
                  setCochees((prev) => {
                    const tout = choisissables.every((l) => prev.has(l.id));
                    const n = new Set(prev);
                    choisissables.forEach((l) => (tout ? n.delete(l.id) : n.add(l.id)));
                    return n;
                  })
                }
              />
              Tout cocher sur cette page
            </label>
          )}

          <ul>
            {lignes.map((l) => {
              const ouverte = ouvertes.has(l.id);
              return (
                <li key={l.id} className={`border-t border-border py-3 ${l.deja_dans_qcm ? 'opacity-55' : ''}`}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      disabled={l.deja_dans_qcm}
                      checked={cochees.has(l.id)}
                      aria-label={`Choisir la question ${l.numero ?? ''}`}
                      onChange={() =>
                        setCochees((prev) => {
                          const n = new Set(prev);
                          if (n.has(l.id)) n.delete(l.id);
                          else n.add(l.id);
                          return n;
                        })
                      }
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm whitespace-pre-line break-words">{l.text}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <button
                          type="button"
                          onClick={() =>
                            setOuvertes((prev) => {
                              const n = new Set(prev);
                              if (n.has(l.id)) n.delete(l.id);
                              else n.add(l.id);
                              return n;
                            })
                          }
                          className="text-xs text-muted underline"
                        >
                          {ouverte ? 'Masquer les réponses' : `Voir les ${l.options.length} réponses`}
                        </button>
                        {l.deja_dans_qcm && <span className="text-xs text-muted">Déjà dans ce QCM</span>}
                      </div>
                      {ouverte && (
                        <ul className="mt-2 text-sm">
                          {l.options.map((o) => (
                            <li key={o.id} className={o.is_correct ? 'font-semibold text-pitch' : 'text-muted'}>
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
            {lignes.length === 0 && <li className="text-sm text-muted py-3">Aucune question ne correspond.</li>}
          </ul>

          {nbPages > 1 && (
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="text-sm font-semibold disabled:opacity-40">
                ← Précédentes
              </button>
              <span className="text-xs text-muted">
                Page {page + 1} / {nbPages} · {total} question(s)
              </span>
              <button type="button" disabled={page + 1 >= nbPages} onClick={() => setPage((p) => p + 1)} className="text-sm font-semibold disabled:opacity-40">
                Suivantes →
              </button>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border">
          <button
            type="button"
            onClick={ajouterCochees}
            disabled={occupe || cochees.size === 0}
            className="w-full bg-pitch text-white font-semibold rounded-xl py-2.5 disabled:opacity-50"
          >
            {occupe ? 'Patiente…' : `Ajouter ${cochees.size} question(s) à mon QCM`}
          </button>
        </div>
      </div>
    </div>
  );
}
