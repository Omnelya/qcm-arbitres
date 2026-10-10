import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import FormateurNav from '../../components/FormateurNav';
import RappelRgpdFormateur from '../../components/RappelRgpdFormateur';
import { supabase } from '../../lib/supabaseClient';
import { BadgesStructures } from '../../components/BadgeStructure';
import { chargerStructuresDesQcm, variablesCouleur, type Structure } from '../../lib/structures';
import { useAuth } from '../../hooks/useAuth';

interface QuizRow {
  id: string;
  title: string;
  computed_status: 'draft' | 'a_venir' | 'actif' | 'expire';
  period_start: string;
  period_end: string;
  created_at: string;
  cibles: number;
  repondus: number;
  // Structure(s) des groupes ciblés
  structures: Structure[];
}

const STATUT: Record<QuizRow['computed_status'], { label: string; className: string }> = {
  draft: { label: 'Brouillon', className: 'bg-canvas text-muted' },
  a_venir: { label: 'À venir', className: 'bg-card-yellow-bg text-card-yellow' },
  actif: { label: 'Actif', className: 'bg-pitch-light text-pitch-dark' },
  expire: { label: 'Expiré', className: 'bg-card-red-bg text-card-red' },
};

// Ordre d'affichage : ce qui se passe maintenant en premier, ce qui est
// terminé en dernier — plutôt que l'ordre de création.
const PRIORITE_STATUT: Record<QuizRow['computed_status'], number> = {
  actif: 0,
  draft: 1,
  a_venir: 2,
  expire: 3,
};

function formatDate(d: string) {
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function trierQuizzes(liste: QuizRow[]): QuizRow[] {
  return [...liste].sort((a, b) => {
    const diffPriorite = PRIORITE_STATUT[a.computed_status] - PRIORITE_STATUT[b.computed_status];
    if (diffPriorite !== 0) return diffPriorite;

    // À l'intérieur d'un même statut : le plus pertinent en premier.
    switch (a.computed_status) {
      case 'actif':
        // Celui qui se termine le plus tôt est le plus urgent à surveiller.
        return new Date(a.period_end).getTime() - new Date(b.period_end).getTime();
      case 'a_venir':
        // Celui qui démarre le plus tôt en premier.
        return new Date(a.period_start).getTime() - new Date(b.period_start).getTime();
      case 'draft':
        // Le brouillon le plus récemment créé en premier.
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'expire':
        // Le plus récemment expiré en premier (encore pertinent).
        return new Date(b.period_end).getTime() - new Date(a.period_end).getTime();
      default:
        return 0;
    }
  });
}

export default function FormateurDashboard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);
  const [rappelRgpdOuvert, setRappelRgpdOuvert] = useState(false);

  useEffect(() => {
    async function charger() {
      if (!session) return;
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('quizzes_with_computed_status')
        .select('id, title, computed_status, period_start, period_end, created_at')
        .eq('formateur_id', session.user.id);

      if (error) {
        setError('Impossible de charger tes QCM. Réessaie dans un instant.');
        setLoading(false);
        return;
      }

      const liste = (data ?? []) as Omit<QuizRow, 'cibles' | 'repondus' | 'structures'>[];
      const quizIds = liste.map((q) => q.id);

      let cibleParQuiz: Record<string, number> = {};
      let reponduParQuiz: Record<string, number> = {};
      const structuresParQuiz = await chargerStructuresDesQcm(liste.map((q) => q.id));

      if (quizIds.length > 0) {
        const [{ data: quizGroups }, { data: attempts }] = await Promise.all([
          supabase.from('quiz_groups').select('quiz_id, group_id').in('quiz_id', quizIds),
          supabase.from('quiz_attempts').select('quiz_id, user_id, status').in('quiz_id', quizIds),
        ]);

        const groupIds = Array.from(new Set((quizGroups ?? []).map((qg) => qg.group_id)));
        const { data: groupMembers } =
          groupIds.length > 0
            ? await supabase.from('group_members').select('group_id, user_id').in('group_id', groupIds)
            : { data: [] };

        for (const q of liste) {
          const gIds = (quizGroups ?? []).filter((qg) => qg.quiz_id === q.id).map((qg) => qg.group_id);
          const cibleIds = new Set(
            (groupMembers ?? []).filter((gm) => gIds.includes(gm.group_id)).map((gm) => gm.user_id)
          );
          const repondusIds = new Set(
            (attempts ?? [])
              .filter((a) => a.quiz_id === q.id && a.status !== 'in_progress' && cibleIds.has(a.user_id))
              .map((a) => a.user_id)
          );
          cibleParQuiz[q.id] = cibleIds.size;
          reponduParQuiz[q.id] = repondusIds.size;
        }
      }

      const listeComplete: QuizRow[] = liste.map((q) => ({
        ...q,
        cibles: cibleParQuiz[q.id] ?? 0,
        repondus: reponduParQuiz[q.id] ?? 0,
        structures: structuresParQuiz[q.id] ?? [],
      }));

      setQuizzes(trierQuizzes(listeComplete));
      setLoading(false);
    }
    charger();
  }, [session]);

  const [filtreStructure, setFiltreStructure] = useState<string | null>(null);
  // Structures présentes parmi mes QCM (pour le filtre)
  const structuresDesQcm = Array.from(
    new Map(quizzes.flatMap((q) => q.structures).map((s) => [s.id, s])).values()
  ).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const quizzesAffiches = filtreStructure
    ? quizzes.filter((q) => q.structures.some((s) => s.id === filtreStructure))
    : quizzes;

  async function creerNouveauQcm() {
    if (!session) return;
    setCreation(true);
    setError(null);

    const maintenant = new Date();
    const dansUneSemaine = new Date(maintenant.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('quizzes')
      .insert({
        formateur_id: session.user.id,
        title: 'Nouveau QCM',
        status: 'draft',
        time_limit_minutes: 20,
        show_score: true,
        show_correction: true,
        show_expected_count: true,
        period_start: maintenant.toISOString(),
        period_end: dansUneSemaine.toISOString(),
      })
      .select('id')
      .single();

    setCreation(false);
    if (error || !data) {
      setError('La création du QCM a échoué. Réessaie dans un instant.');
      return;
    }
    navigate(`/formateur/qcm/${data.id}`);
  }

  return (
    <AppLayout>
      {rappelRgpdOuvert && (
        <RappelRgpdFormateur
          onAnnuler={() => setRappelRgpdOuvert(false)}
          onConfirmer={() => {
            setRappelRgpdOuvert(false);
            creerNouveauQcm();
          }}
        />
      )}
      <FormateurNav />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Mes QCM</h1>
        <button
          type="button"
          onClick={() => setRappelRgpdOuvert(true)}
          disabled={creation}
          className="text-sm border border-border rounded px-3 py-1.5 disabled:opacity-60"
        >
          {creation ? 'Création…' : '+ Nouveau'}
        </button>
      </div>

      {loading && <p className="text-sm text-muted">Chargement…</p>}
      {error && <p className="text-sm text-card-red">{error}</p>}
      {!loading && !error && quizzes.length === 0 && (
        <p className="text-sm text-muted">Aucun QCM pour le moment.</p>
      )}

      {structuresDesQcm.length > 1 && (
        <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Filtrer par structure">
          <button
            type="button"
            onClick={() => setFiltreStructure(null)}
            aria-pressed={filtreStructure === null}
            className={`text-xs rounded px-2.5 py-1 border ${filtreStructure === null ? 'border-ink bg-surface font-medium' : 'border-border text-muted'}`}
          >
            Toutes
          </button>
          {structuresDesQcm.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setFiltreStructure(filtreStructure === s.id ? null : s.id)}
              aria-pressed={filtreStructure === s.id}
              className={`text-xs rounded px-2.5 py-1 border inline-flex items-center gap-1.5 ${filtreStructure === s.id ? 'font-medium' : 'text-muted'}`}
              style={{
                borderColor: filtreStructure === s.id ? s.color : undefined,
                backgroundColor: filtreStructure === s.id ? `${s.color}14` : undefined,
              }}
            >
              <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {quizzesAffiches.map((q) => {
          const statut = STATUT[q.computed_status];
          return (
            <li
              key={q.id}
              className="bg-surface border border-border rounded p-3"
              style={q.structures.length > 0 ? (variablesCouleur(q.structures[0].color) as CSSProperties) : undefined}
            >
              <Link to={`/formateur/qcm/${q.id}`} className="block mb-2">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="text-sm font-medium">{q.title}</span>
                  <span className={`text-xs rounded px-2 py-0.5 shrink-0 ${statut.className}`}>
                    {statut.label}
                  </span>
                </div>
                <BadgesStructures structures={q.structures} className="mb-1.5" />
                <p className="text-xs text-muted">
                  {formatDate(q.period_start)} → {formatDate(q.period_end)}
                  {q.computed_status !== 'draft' && ` · ${q.repondus}/${q.cibles} répondus`}
                </p>
              </Link>
              <Link
                to={`/formateur/qcm/${q.id}/resultats`}
                className="block text-center text-xs border border-border rounded py-1.5"
              >
                Voir les résultats
              </Link>
            </li>
          );
        })}
      </ul>
    </AppLayout>
  );
}
