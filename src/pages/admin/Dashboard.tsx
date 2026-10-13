import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import { supabase } from '../../lib/supabaseClient';
import { BadgesStructures } from '../../components/BadgeStructure';
import { chargerStructures, chargerStructuresDesQcm, type Structure } from '../../lib/structures';

// Vue d'ensemble de l'administrateur, maquette A « Table de marque » :
// tableau d'affichage des chiffres clés, tableau des QCM, puis ce qu'il y a
// à traiter et les structures.

interface QuizVue {
  id: string;
  title: string;
  computed_status: 'draft' | 'a_venir' | 'actif' | 'expire';
  formateur_nom: string;
  repondus: number;
  cibles: number;
  period_start: string;
  period_end: string;
  structures: Structure[];
}

const STATUT: Record<QuizVue['computed_status'], { label: string; className: string }> = {
  draft: { label: 'Brouillon', className: 'bg-canvas text-muted' },
  a_venir: { label: 'À venir', className: 'bg-card-yellow-bg text-[#8A6516]' },
  // Toujours vert, quelle que soit la couleur de la structure du QCM.
  actif: { label: 'Actif', className: 'bg-[#E6F0EA] text-[#164F35]' },
  expire: { label: 'Terminé', className: 'bg-card-red-bg text-card-red' },
};
// Ordre du tableau : ce qui se passe maintenant d'abord.
const ORDRE: Record<QuizVue['computed_status'], number> = { actif: 0, a_venir: 1, draft: 2, expire: 3 };

function dateCourte(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nbFormateurs, setNbFormateurs] = useState(0);
  const [nbArbitres, setNbArbitres] = useState(0);
  const [nbActifs, setNbActifs] = useState(0);
  const [nbNonRepondants, setNbNonRepondants] = useState(0);
  const [quizzes, setQuizzes] = useState<QuizVue[]>([]);
  const [structures, setStructures] = useState<(Structure & { comptes: number })[]>([]);
  const [aTraiter, setATraiter] = useState({ sansStructure: 0, invitationsEchec: 0, jamaisConnectes: 0 });
  const [recherche, setRecherche] = useState('');
  const [filtreDebutDu, setFiltreDebutDu] = useState('');
  const [filtreDebutAu, setFiltreDebutAu] = useState('');
  const [filtreFinDu, setFiltreFinDu] = useState('');
  const [filtreFinAu, setFiltreFinAu] = useState('');

  useEffect(() => {
    async function charger() {
      setLoading(true);
      setErreur(null);

      const [
        { data: roles },
        { data: quizzesData, error: err1 },
        { data: profils },
        { data: quizGroups },
        { data: groupMembers },
        { data: attempts },
        { structures: structuresData, erreur: errStructures },
        { data: affectations },
        { data: invitations },
        { data: connexions },
      ] = await Promise.all([
        supabase.from('user_roles').select('user_id, role'),
        supabase
          .from('quizzes_with_computed_status')
          .select('id, title, formateur_id, computed_status, period_start, period_end'),
        supabase.from('profiles').select('id, full_name'),
        supabase.from('quiz_groups').select('quiz_id, group_id'),
        supabase.from('group_members').select('group_id, user_id'),
        supabase.from('quiz_attempts').select('quiz_id, user_id, status'),
        chargerStructures(),
        supabase.from('user_structures').select('user_id, structure_id'),
        supabase.from('invite_queue').select('id').eq('status', 'echec'),
        supabase.rpc('admin_dernieres_connexions'),
      ]);

      if (err1) {
        setErreur('Impossible de charger la vue d’ensemble. Réessaie dans un instant.');
        setLoading(false);
        return;
      }

      const rolesListe = roles ?? [];
      setNbFormateurs(rolesListe.filter((r) => r.role === 'formateur').length);
      setNbArbitres(rolesListe.filter((r) => r.role === 'arbitre').length);

      const nomsFormateurs = Object.fromEntries((profils ?? []).map((p) => [p.id, p.full_name]));
      const structuresParQuiz = await chargerStructuresDesQcm((quizzesData ?? []).map((q) => q.id));
      let totalNonRepondants = 0;
      let totalActifs = 0;

      const liste: QuizVue[] = (quizzesData ?? []).map((q) => {
        const groupIds = (quizGroups ?? []).filter((qg) => qg.quiz_id === q.id).map((qg) => qg.group_id);
        const cibleIds = new Set(
          (groupMembers ?? []).filter((gm) => groupIds.includes(gm.group_id)).map((gm) => gm.user_id)
        );
        const repondusIds = new Set(
          (attempts ?? [])
            .filter((a) => a.quiz_id === q.id && a.status !== 'in_progress' && cibleIds.has(a.user_id))
            .map((a) => a.user_id)
        );
        if (q.computed_status === 'actif') {
          totalActifs++;
          totalNonRepondants += Math.max(0, cibleIds.size - repondusIds.size);
        }
        return {
          id: q.id,
          title: q.title,
          computed_status: q.computed_status,
          formateur_nom: nomsFormateurs[q.formateur_id] ?? '—',
          repondus: repondusIds.size,
          cibles: cibleIds.size,
          period_start: q.period_start,
          period_end: q.period_end,
          structures: structuresParQuiz[q.id] ?? [],
        };
      });
      liste.sort(
        (a, b) => ORDRE[a.computed_status] - ORDRE[b.computed_status] || a.period_end.localeCompare(b.period_end)
      );

      // À traiter : comptes arbitre/formateur sans structure, invitations en
      // échec, comptes jamais connectés (chaque donnée est facultative : si
      // une mise à jour SQL manque, la ligne correspondante n'apparaît pas).
      const avecStructure = new Set((affectations ?? []).map((a) => a.user_id));
      const concernes = new Set(
        rolesListe.filter((r) => r.role === 'arbitre' || r.role === 'formateur').map((r) => r.user_id)
      );
      setATraiter({
        sansStructure: errStructures ? 0 : [...concernes].filter((id) => !avecStructure.has(id)).length,
        invitationsEchec: (invitations ?? []).length,
        jamaisConnectes: Array.isArray(connexions)
          ? (connexions as { last_sign_in_at: string | null }[]).filter((c) => !c.last_sign_in_at).length
          : 0,
      });
      setStructures(
        structuresData.map((s) => ({
          ...s,
          comptes: (affectations ?? []).filter((a) => a.structure_id === s.id).length,
        }))
      );

      setNbActifs(totalActifs);
      setNbNonRepondants(totalNonRepondants);
      setQuizzes(liste);
      setLoading(false);
    }
    charger();
  }, []);

  const quizzesFiltres = quizzes.filter((q) => {
    const texte = recherche.trim().toLowerCase();
    if (texte && !q.title.toLowerCase().includes(texte) && !q.formateur_nom.toLowerCase().includes(texte)) {
      return false;
    }
    // Les filtres de date comparent des jours (AAAA-MM-JJ).
    const debut = q.period_start.slice(0, 10);
    const fin = q.period_end.slice(0, 10);
    if (filtreDebutDu && debut < filtreDebutDu) return false;
    if (filtreDebutAu && debut > filtreDebutAu) return false;
    if (filtreFinDu && fin < filtreFinDu) return false;
    if (filtreFinAu && fin > filtreFinAu) return false;
    return true;
  });

  const filtresDateActifs = Boolean(filtreDebutDu || filtreDebutAu || filtreFinDu || filtreFinAu);
  const lignesATraiter = [
    {
      n: aTraiter.sansStructure,
      texte: `${aTraiter.sansStructure} compte(s) sans structure`,
      action: 'Affecter',
      aller: () => navigate('/admin/comptes', { state: { filtreStructure: 'aucune' } }),
    },
    {
      n: aTraiter.invitationsEchec,
      texte: `${aTraiter.invitationsEchec} invitation(s) en échec`,
      action: 'Voir',
      aller: () => navigate('/admin/comptes'),
    },
    {
      n: aTraiter.jamaisConnectes,
      texte: `${aTraiter.jamaisConnectes} compte(s) jamais connecté(s)`,
      action: 'Voir',
      aller: () => navigate('/admin/comptes', { state: { tri: 'jamais-connecte' } }),
    },
  ]
    .slice(1) // « sans structure » est affiché dans l'encart ambre en haut
    .filter((l) => l.n > 0);

  const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  if (loading) {
    return (
      <AppLayout>
        <p className="text-sm text-muted">Chargement…</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1>Vue d'ensemble</h1>
          <p className="text-sm text-muted mt-1 first-letter:uppercase">
            {aujourdhui} · {nbActifs} QCM en cours
            {structures.length > 0 && ` sur ${structures.length} structure(s)`}
          </p>
        </div>
        {erreur && <p className="text-sm text-card-red">{erreur}</p>}

        {/* Chiffres clés */}
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {[
            { n: nbArbitres, label: 'arbitres' },
            { n: nbFormateurs, label: 'formateurs' },
            { n: nbActifs, label: 'QCM en cours' },
            { n: nbNonRepondants, label: 'réponses attendues', alerte: true },
          ].map((c) => (
            <div key={c.label} className="bg-surface border rounded-2xl px-3.5 py-3">
              <dd className={`text-[26px] font-extrabold leading-tight tabular-nums ${c.alerte && c.n > 0 ? 'text-ambre-fonce' : ''}`}>
                {c.n}
              </dd>
              <dt className="text-[13px] text-muted">{c.label}</dt>
            </div>
          ))}
        </dl>

        {aTraiter.sansStructure > 0 && (
          <div className="flex items-center gap-3 bg-ambre-doux rounded-2xl px-3.5 py-3">
            <span className="w-9 h-9 rounded-full bg-surface grid place-items-center font-extrabold text-ambre-fonce shrink-0">
              {aTraiter.sansStructure}
            </span>
            <p className="flex-1 text-sm">compte(s) sans structure : leurs formateurs ne les voient pas.</p>
            <button
              type="button"
              onClick={() => navigate('/admin/comptes', { state: { filtreStructure: 'aucune' } })}
              className="bg-surface rounded-xl px-3 py-1.5 text-[13px] font-bold shadow-carte min-h-0"
            >
              Affecter
            </button>
          </div>
        )}

        {/* QCM */}
        <section className="flex flex-col gap-2">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-muted">Tous les QCM</h2>
            <span className="text-sm text-muted">
              {quizzesFiltres.length === quizzes.length
                ? `${quizzes.length} QCM`
                : `${quizzesFiltres.length} QCM sur ${quizzes.length}`}
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher par titre ou par formateur…"
              aria-label="Rechercher un QCM"
              className="flex-1 min-w-[12rem] border border-border rounded px-3 py-2 text-sm bg-surface"
            />
          </div>
          <details className="bg-surface border border-border rounded px-3 py-2 text-sm" open={filtresDateActifs}>
            <summary className="cursor-pointer text-muted">
              Filtrer par date{filtresDateActifs ? ' (actif)' : ''}
            </summary>
            <div className="grid sm:grid-cols-2 gap-3 mt-3 mb-1">
              {[
                { titre: 'Début du QCM entre le', du: filtreDebutDu, au: filtreDebutAu, setDu: setFiltreDebutDu, setAu: setFiltreDebutAu },
                { titre: 'Fin du QCM entre le', du: filtreFinDu, au: filtreFinAu, setDu: setFiltreFinDu, setAu: setFiltreFinAu },
              ].map((f) => (
                <div key={f.titre}>
                  <p className="text-xs text-muted mb-1">{f.titre}</p>
                  <div className="flex items-center gap-2">
                    <input type="date" value={f.du} onChange={(e) => f.setDu(e.target.value)} aria-label={`${f.titre} (du)`} className="flex-1 min-w-0 border border-border rounded px-2 py-1.5" />
                    <span className="text-xs text-muted">et le</span>
                    <input type="date" value={f.au} onChange={(e) => f.setAu(e.target.value)} aria-label={`${f.titre} (au)`} className="flex-1 min-w-0 border border-border rounded px-2 py-1.5" />
                  </div>
                </div>
              ))}
            </div>
            {filtresDateActifs && (
              <button
                type="button"
                onClick={() => {
                  setFiltreDebutDu('');
                  setFiltreDebutAu('');
                  setFiltreFinDu('');
                  setFiltreFinAu('');
                }}
                className="text-xs underline text-muted min-h-0 py-1"
              >
                Effacer les dates
              </button>
            )}
          </details>

          {quizzes.length === 0 && <p className="text-sm text-muted">Aucun QCM pour le moment.</p>}
          {quizzes.length > 0 && quizzesFiltres.length === 0 && (
            <p className="text-sm text-muted">Aucun QCM ne correspond à ces critères.</p>
          )}
          <ul className="flex flex-col gap-2.5">
            {quizzesFiltres.map((q) => {
              const statut = STATUT[q.computed_status];
              const couleur = q.structures[0]?.color ?? '#66736C';
              const pct = q.cibles > 0 ? Math.round((q.repondus / q.cibles) * 100) : 0;
              return (
                <li key={q.id}>
                  <Link
                    to={`/admin/qcm/${q.id}/resultats`}
                    className="flex flex-col gap-2 bg-surface rounded-2xl p-3.5 shadow-carte hover:shadow-carte-haute hover:-translate-y-px"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <BadgesStructures structures={q.structures} />
                      <span className={`text-xs font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap ${statut.className}`}>
                        {statut.label}
                      </span>
                    </span>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-bold">{q.title}</span>
                      {q.computed_status !== 'draft' && <span className="font-bold tabular-nums">{pct} %</span>}
                    </span>
                    {q.computed_status !== 'draft' && (
                      <span className="block h-2 rounded-full bg-canvas overflow-hidden">
                        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: couleur }} />
                      </span>
                    )}
                    <span className="flex justify-between gap-2 text-[13px] text-muted">
                      <span>{q.formateur_nom}{q.computed_status !== 'draft' && ` · ${q.repondus}/${q.cibles} réponses`}</span>
                      <span className="whitespace-nowrap">fin le {dateCourte(q.period_end)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* À traiter + Structures */}
        <div className="grid md:grid-cols-[1.2fr_1fr] gap-4">
          <section>
            <h2 className="text-sm font-bold text-muted mb-2">À traiter</h2>
            <ul className="bg-surface border rounded-2xl px-3.5">
              {lignesATraiter.length === 0 && <li className="py-3 text-sm text-muted">Rien à traiter pour le moment.</li>}
              {lignesATraiter.map((l) => (
                <li key={l.texte} className="flex items-center justify-between gap-3 py-2.5 border-b border-[#ECEFEC] last:border-b-0 text-sm">
                  <span>{l.texte}</span>
                  <button type="button" onClick={l.aller} className="border border-border rounded px-3 py-1 text-[13px] min-h-0">
                    {l.action}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {structures.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-muted mb-2">Structures</h2>
              <ul className="bg-surface border rounded-2xl px-3.5">
                {structures.map((s) => (
                  <li key={s.id} className="border-b border-[#ECEFEC] last:border-b-0">
                    <Link to="/admin/structures" className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </span>
                      <span className="text-muted">{s.comptes} compte(s)</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
