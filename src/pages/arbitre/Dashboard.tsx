import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import ArbitreNav from '../../components/ArbitreNav';
import { supabase } from '../../lib/supabaseClient';
import { BadgesStructures } from '../../components/BadgeStructure';
import { chargerStructuresDesQcm, type Structure } from '../../lib/structures';
import { useAuth } from '../../hooks/useAuth';

interface QuizDispo {
  id: string;
  title: string;
  time_limit_minutes: number;
  period_end: string | null;
  attempt: { statut: 'a_commencer' | 'en_cours'; started_at: string | null };
  structures: Structure[];
}

function formatEcheance(d: string) {
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Nombre de jours restants avant l'échéance (peut être négatif si dépassée).
function joursRestants(d: string) {
  return (new Date(d).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}

export default function ArbitreAccueil() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizDispo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [demarrage, setDemarrage] = useState<string | null>(null);
  const [quizPourInstructions, setQuizPourInstructions] = useState<QuizDispo | null>(null);

  async function charger() {
    if (!session) return;
    setLoading(true);
    setErreur(null);

    // Appartenance réelle aux groupes ciblés, peu importe qui a créé le
    // QCM : couvre aussi bien l'exclusion d'un QCM créé par soi-même et
    // non ciblé, que le cas légitime où le créateur s'ajoute volontairement
    // à un groupe pour tester son propre QCM.
    const { data: quizzesData, error: err1 } = await supabase.rpc('get_arbitre_quizzes');

    if (err1) {
      setErreur('Impossible de charger tes QCM. Réessaie dans un instant.');
      setLoading(false);
      return;
    }

    const ids = (quizzesData ?? []).map((q: { id: string }) => q.id);

    const [{ data: attemptsData }, { data: periodsData }] = await Promise.all([
      supabase.from('quiz_attempts').select('quiz_id, status, started_at').eq('user_id', session.user.id),
      ids.length > 0
        ? supabase.from('quizzes').select('id, period_end').in('id', ids)
        : Promise.resolve({ data: [] as { id: string; period_end: string }[] }),
    ]);

    const structuresParQuiz = await chargerStructuresDesQcm(ids);
    const echeanceParId = Object.fromEntries((periodsData ?? []).map((p) => [p.id, p.period_end]));

    const liste: QuizDispo[] = [];
    for (const q of quizzesData ?? []) {
      const tentative = attemptsData?.find((a) => a.quiz_id === q.id);
      if (tentative && tentative.status !== 'in_progress') continue; // déjà soumis : disparaît
      liste.push({
        id: q.id,
        title: q.title,
        time_limit_minutes: q.time_limit_minutes,
        period_end: echeanceParId[q.id] ?? null,
        attempt: {
          statut: tentative ? 'en_cours' : 'a_commencer',
          started_at: tentative?.started_at ?? null,
        },
        structures: structuresParQuiz[q.id] ?? [],
      });
    }
    setQuizzes(liste);
    setLoading(false);
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function commencer(quizId: string) {
    if (!session) return;
    setDemarrage(quizId);
    const { error } = await supabase
      .from('quiz_attempts')
      .insert({ quiz_id: quizId, user_id: session.user.id, status: 'in_progress' });
    setDemarrage(null);
    if (error) {
      setQuizPourInstructions(null);
      setErreur('Le démarrage du QCM a échoué. Réessaie dans un instant.');
      return;
    }
    navigate(`/arbitre/qcm/${quizId}`);
  }

  if (loading) {
    return (
      <AppLayout>
        <p className="text-sm text-muted">Chargement…</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ArbitreNav />
      <h1 className="text-lg font-semibold mb-4">Mes QCM à faire</h1>
      {erreur && <p className="text-sm text-card-red mb-4">{erreur}</p>}

      {quizzes.length === 0 && (
        <p className="text-sm text-muted">Aucun QCM en attente pour le moment.</p>
      )}

      <ul className="flex flex-col gap-2">
        {quizzes.map((q) => {
          const urgent = q.period_end !== null && joursRestants(q.period_end) <= 2;
          return (
            <li key={q.id} className="bg-surface border border-border rounded p-3">
              <p className="text-sm font-medium mb-1">{q.title}</p>
              <BadgesStructures structures={q.structures} className="mb-1.5" />
              <p className="text-xs text-muted mb-0.5">{q.time_limit_minutes} minutes</p>
              {q.period_end && (
                <p className={`text-xs mb-3 ${urgent ? 'text-card-red font-medium' : 'text-muted'}`}>
                  Jusqu'au {formatEcheance(q.period_end)}
                </p>
              )}
              {!q.period_end && <div className="mb-3" />}
              {q.attempt.statut === 'a_commencer' ? (
                <button
                  type="button"
                  onClick={() => setQuizPourInstructions(q)}
                  className="w-full bg-pitch text-white font-medium rounded py-2 text-sm disabled:opacity-60"
                >
                  Commencer
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate(`/arbitre/qcm/${q.id}`)}
                  className="w-full border border-pitch text-pitch font-medium rounded py-2 text-sm"
                >
                  Reprendre
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {quizPourInstructions && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-border rounded-lg p-5 max-w-sm w-full">
            <p className="text-sm font-semibold mb-3">{quizPourInstructions.title}</p>
            <ul className="text-sm text-muted flex flex-col gap-2 mb-5 list-disc pl-4">
              <li>Durée : {quizPourInstructions.time_limit_minutes} minutes, décompte automatique dès le démarrage.</li>
              <li>À la fin du temps imparti, le QCM est envoyé automatiquement avec les réponses déjà cochées.</li>
              <li>Une fois validé, l'envoi est définitif.</li>
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setQuizPourInstructions(null)}
                disabled={demarrage === quizPourInstructions.id}
                className="flex-1 border border-border rounded py-2 text-sm disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => commencer(quizPourInstructions.id)}
                disabled={demarrage === quizPourInstructions.id}
                className="flex-1 bg-pitch text-white font-medium rounded py-2 text-sm disabled:opacity-60"
              >
                {demarrage === quizPourInstructions.id ? 'Démarrage…' : 'Commencer maintenant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
