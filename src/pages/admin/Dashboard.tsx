import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import AdminNav from '../../components/AdminNav';
import { supabase } from '../../lib/supabaseClient';
import { BadgesStructures } from '../../components/BadgeStructure';
import { chargerStructuresDesQcm, type Structure } from '../../lib/structures';

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

function formatDateAffichage(dateIso: string): string {
  const [annee, mois, jour] = dateIso.split('-');
  return `${jour}/${mois}/${annee}`;
}

const STATUT: Record<QuizVue['computed_status'], { label: string; className: string }> = {
  draft: { label: 'Brouillon', className: 'bg-canvas text-muted' },
  a_venir: { label: 'À venir', className: 'bg-card-yellow-bg text-card-yellow' },
  // Toujours vert, quelle que soit la couleur de la structure du QCM.
  actif: { label: 'Actif', className: 'bg-[#E6F0EA] text-[#164F35]' },
  expire: { label: 'Expiré', className: 'bg-card-red-bg text-card-red' },
};

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nbFormateurs, setNbFormateurs] = useState(0);
  const [nbArbitres, setNbArbitres] = useState(0);
  const [nbActifs, setNbActifs] = useState(0);
  const [nbNonRepondants, setNbNonRepondants] = useState(0);
  const [quizzes, setQuizzes] = useState<QuizVue[]>([]);
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
      ] = await Promise.all([
        supabase.from('user_roles').select('user_id, role'),
        supabase
          .from('quizzes_with_computed_status')
          .select('id, title, formateur_id, computed_status, period_start, period_end'),
        supabase.from('profiles').select('id, full_name'),
        supabase.from('quiz_groups').select('quiz_id, group_id'),
        supabase.from('group_members').select('group_id, user_id'),
        supabase.from('quiz_attempts').select('quiz_id, user_id, status'),
      ]);

      if (err1) {
        setErreur('Impossible de charger la vue d’ensemble. Réessaie dans un instant.');
        setLoading(false);
        return;
      }

      setNbFormateurs((roles ?? []).filter((r) => r.role === 'formateur').length);
      setNbArbitres((roles ?? []).filter((r) => r.role === 'arbitre').length);

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
    if (filtreDebutDu && q.period_start < filtreDebutDu) return false;
    if (filtreDebutAu && q.period_start > filtreDebutAu) return false;
    if (filtreFinDu && q.period_end < filtreFinDu) return false;
    if (filtreFinAu && q.period_end > filtreFinAu) return false;
    return true;
  });

  const filtresDateActifs = Boolean(filtreDebutDu || filtreDebutAu || filtreFinDu || filtreFinAu);

  function reinitialiserFiltresDate() {
    setFiltreDebutDu('');
    setFiltreDebutAu('');
    setFiltreFinDu('');
    setFiltreFinAu('');
  }

  if (loading) {
    return (
      <AppLayout>
        <AdminNav />
        <p className="text-sm text-muted">Chargement…</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <AdminNav />
      <h1 className="text-lg font-semibold mb-4">Vue d'ensemble</h1>
      {erreur && <p className="text-sm text-card-red mb-4">{erreur}</p>}

      <div className="grid grid-cols-2 gap-2.5 mb-6">
        <div className="bg-surface border border-border rounded p-3">
          <p className="text-2xl font-semibold">{nbFormateurs}</p>
          <p className="text-xs text-muted mt-0.5">Formateurs</p>
        </div>
        <div className="bg-surface border border-border rounded p-3">
          <p className="text-2xl font-semibold">{nbArbitres}</p>
          <p className="text-xs text-muted mt-0.5">Arbitres</p>
        </div>
        <div className="bg-surface border border-border rounded p-3">
          <p className="text-2xl font-semibold">{nbActifs}</p>
          <p className="text-xs text-muted mt-0.5">QCM actifs</p>
        </div>
        <div className="bg-surface border border-border rounded p-3">
          <p className="text-2xl font-semibold">{nbNonRepondants}</p>
          <p className="text-xs text-muted mt-0.5">Non-répondants</p>
        </div>
      </div>

      <p className="text-sm font-medium mb-2">Tous les QCM de la plateforme</p>

      <input
        type="text"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder="Rechercher par titre ou par formateur…"
        className="w-full border border-border rounded px-3 py-2 mb-3 text-sm"
      />

      <div className="bg-surface border border-border rounded p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted">Filtrer par date</p>
          {filtresDateActifs && (
            <button
              type="button"
              onClick={reinitialiserFiltresDate}
              className="text-xs text-pitch-dark underline"
            >
              Réinitialiser
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <div>
            <p className="text-xs text-muted mb-1">Début du QCM — entre le</p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filtreDebutDu}
                onChange={(e) => setFiltreDebutDu(e.target.value)}
                className="flex-1 border border-border rounded px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-muted">et le</span>
              <input
                type="date"
                value={filtreDebutAu}
                onChange={(e) => setFiltreDebutAu(e.target.value)}
                className="flex-1 border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted mb-1">Fin du QCM — entre le</p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filtreFinDu}
                onChange={(e) => setFiltreFinDu(e.target.value)}
                className="flex-1 border border-border rounded px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-muted">et le</span>
              <input
                type="date"
                value={filtreFinAu}
                onChange={(e) => setFiltreFinAu(e.target.value)}
                className="flex-1 border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {quizzes.length === 0 && <p className="text-sm text-muted">Aucun QCM pour le moment.</p>}
      {quizzes.length > 0 && quizzesFiltres.length === 0 && (
        <p className="text-sm text-muted">Aucun QCM ne correspond à ces critères.</p>
      )}
      <ul className="flex flex-col gap-2">
        {quizzesFiltres.map((q) => {
          const statut = STATUT[q.computed_status];
          return (
            <li key={q.id}>
              <Link
                to={`/admin/qcm/${q.id}/resultats`}
                className="block bg-surface border border-border rounded p-3"
              >
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="text-sm font-medium">{q.title}</span>
                  <span className={`text-xs rounded px-2 py-0.5 shrink-0 ${statut.className}`}>
                    {statut.label}
                  </span>
                </div>
                <BadgesStructures structures={q.structures} className="mb-1.5" />
                <p className="text-xs text-muted">
                  {q.formateur_nom} · {q.repondus}/{q.cibles} répondus
                </p>
                <p className="text-xs text-muted">
                  Du {formatDateAffichage(q.period_start)} au {formatDateAffichage(q.period_end)}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </AppLayout>
  );
}
