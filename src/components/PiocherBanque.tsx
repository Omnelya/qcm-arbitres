import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

interface BanqueInfo {
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

const TAILLE_PAGE = 30;

// Bouton + fenêtre « Piocher dans la banque » (QCM en brouillon uniquement).
// Le bouton n'apparaît que si le formateur a accès à au moins une banque.
export default function PiocherBanque({ quizId, onAjoute }: { quizId: string; onAjoute: () => void }) {
  const [banques, setBanques] = useState<BanqueInfo[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [banqueId, setBanqueId] = useState('');
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [filtreTheme, setFiltreTheme] = useState(''); // '' = tous, 'none' = sans thème, sinon id
  const [recherche, setRecherche] = useState('');
  const [rechercheEffective, setRechercheEffective] = useState('');
  const [page, setPage] = useState(0);
  const [lignes, setLignes] = useState<LigneQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [nombreHasard, setNombreHasard] = useState(10);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('banque_liste').then(({ data, error }) => {
      if (!error && data) setBanques(data as BanqueInfo[]);
    });
  }, []);

  function ouvrir() {
    setBanqueId((b) => b || banques[0]?.id || '');
    setErreur(null);
    setInfo(null);
    setOuvert(true);
  }

  // thèmes de la banque choisie
  useEffect(() => {
    if (!ouvert || !banqueId) return;
    supabase.rpc('banque_themes_liste', { p_banque: banqueId }).then(({ data }) => {
      setThemes((data ?? []) as ThemeInfo[]);
    });
  }, [ouvert, banqueId]);

  useEffect(() => {
    const t = setTimeout(() => {
      setRechercheEffective(recherche);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [recherche]);

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

  async function tirerAuHasard() {
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
      setErreur('Le tirage a échoué. Rien n’a été ajouté, réessaie dans un instant.');
      return;
    }
    setInfo(`${data ?? 0} question(s) tirée(s) au hasard et ajoutée(s).`);
    onAjoute();
    chargerListe();
  }

  if (banques.length === 0) return null;

  const nbPages = Math.max(1, Math.ceil(total / TAILLE_PAGE));
  const choisissables = lignes.filter((l) => !l.deja_dans_qcm);

  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
        className="w-full mb-4 bg-surface border border-border rounded-xl py-2.5 text-sm font-semibold"
      >
        Piocher dans la banque de questions
      </button>

      {ouvert && (
        <div className="fixed inset-0 z-50 bg-ink/45 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !occupe && setOuvert(false)}>
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
              <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted underline">
                Fermer
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
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
                <span>Tirer au hasard</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={nombreHasard}
                  onChange={(e) => setNombreHasard(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                  aria-label="Nombre de questions à tirer"
                  className="w-20 border border-border rounded-lg px-2 py-1"
                />
                <span>question(s) {filtreTheme && filtreTheme !== 'none' ? 'du thème choisi' : 'de la banque'}</span>
                <button
                  type="button"
                  onClick={tirerAuHasard}
                  disabled={occupe}
                  className="ml-auto bg-surface border border-border rounded-xl px-3 py-1.5 font-semibold disabled:opacity-50"
                >
                  Tirer
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
      )}
    </>
  );
}
