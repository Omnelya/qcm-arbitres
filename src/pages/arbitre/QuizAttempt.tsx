import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import { supabase } from '../../lib/supabaseClient';
import { avecRetriesTimeout } from '../../lib/retryTimeout';
import { useAuth } from '../../hooks/useAuth';
import { useSuspendreDeconnexionInactivite } from '../../lib/inactivite';

// Marge silencieuse ajoutée au temps saisi par le formateur — voir la
// migration 20260925213000_marge_dix_secondes_qcm.sql pour le détail et
// le garde-fou côté serveur (doit rester la même valeur ici et là-bas).
const MARGE_DEMARRAGE_MS = 10_000;

interface QuestionExamen {
  id: string;
  type: 'video' | 'image' | 'text';
  media_url: string | null;
  text: string;
  order_index: number;
  max_selectable: number;
  options: { id: string; text: string }[];
}

export default function QuizAttempt() {
  // Pendant un QCM, l'arbitre peut réfléchir ou regarder une vidéo sans
  // toucher l'écran : pas de déconnexion automatique (le QCM a déjà sa
  // propre limite de temps).
  useSuspendreDeconnexionInactivite(true);
  const { id: quizId } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();

  const [titre, setTitre] = useState('');
  const [afficherNombreAttendu, setAfficherNombreAttendu] = useState(true);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [dateLimite, setDateLimite] = useState<number | null>(null);
  const [questions, setQuestions] = useState<QuestionExamen[]>([]);
  const [indexActuel, setIndexActuel] = useState(0);
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [erreurMedia, setErreurMedia] = useState<string | null>(null);
  const [tentativeMedia, setTentativeMedia] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurSelection, setErreurSelection] = useState<string | null>(null);
  const [tempsRestant, setTempsRestant] = useState(0);
  const [soumission, setSoumission] = useState(false);
  const [navigationEnCours, setNavigationEnCours] = useState(false);
  const [confirmationEnvoi, setConfirmationEnvoi] = useState(false);

  const soumettre = useCallback(
    async (id: string) => {
      setSoumission(true);
      setErreur(null);
      const questionEnCours = questions[indexActuel];
      if (questionEnCours) {
        const ok = await sauvegarderQuestion(questionEnCours.id);
        if (!ok) {
          setSoumission(false);
          return;
        }
      }
      const { error } = await avecRetriesTimeout(() =>
        supabase.rpc('submit_exam_attempt', { p_attempt_id: id })
      );
      if (error) {
        setSoumission(false);
        setErreur(
          "L'envoi de tes réponses a échoué. Vérifie ta connexion et réessaie — tes réponses déjà cochées sont conservées."
        );
        return;
      }
      navigate(`/arbitre/qcm/${quizId}/resultat/${id}`, { replace: true });
    },
    [navigate, quizId, attemptId, questions, indexActuel, selections]
  );

  useEffect(() => {
    async function charger() {
      if (!quizId || !session) return;
      setLoading(true);
      setErreur(null);

      const { data: quiz, error: errQuiz } = await supabase
        .from('quizzes')
        .select('title, time_limit_minutes, show_expected_count')
        .eq('id', quizId)
        .single();
      if (errQuiz || !quiz) {
        setErreur('Impossible de charger ce QCM.');
        setLoading(false);
        return;
      }
      setTitre(quiz.title);
      setAfficherNombreAttendu(quiz.show_expected_count);

      const { data: attempt, error: errAttempt } = await supabase
        .from('quiz_attempts')
        .select('id, status, started_at')
        .eq('quiz_id', quizId)
        .eq('user_id', session.user.id)
        .single();

      if (errAttempt || !attempt) {
        setErreur('Aucune tentative en cours pour ce QCM.');
        setLoading(false);
        return;
      }

      if (attempt.status !== 'in_progress') {
        navigate(`/arbitre/qcm/${quizId}/resultat/${attempt.id}`, { replace: true });
        return;
      }

      // Marge de 10s ajoutée au temps annoncé par le formateur (temps de
      // lecture du pop-up + chargement de la première question), à tenir
      // synchronisée avec la même marge côté serveur (submit_exam_attempt).
      const limite =
        new Date(attempt.started_at).getTime() + quiz.time_limit_minutes * 60_000 + MARGE_DEMARRAGE_MS;
      if (Date.now() >= limite) {
        await soumettre(attempt.id);
        return;
      }
      setAttemptId(attempt.id);
      setDateLimite(limite);

      const { data: questionsData, error: errQuestions } = await supabase.rpc('get_exam_questions', {
        p_quiz_id: quizId,
      });
      if (errQuestions || !questionsData) {
        setErreur("Impossible de charger les questions. Réessaie dans un instant.");
        setLoading(false);
        return;
      }
      setQuestions(questionsData as QuestionExamen[]);

      const { data: reponsesExistantes } = await supabase
        .from('selected_answers')
        .select('question_id, option_id')
        .eq('attempt_id', attempt.id);

      const initial: Record<string, Set<string>> = {};
      for (const r of reponsesExistantes ?? []) {
        if (!initial[r.question_id]) initial[r.question_id] = new Set();
        initial[r.question_id].add(r.option_id);
      }
      setSelections(initial);
      setLoading(false);
    }
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId, session]);

  // Minuteur : mise à jour chaque seconde, soumission automatique à zéro.
  useEffect(() => {
    if (!dateLimite || !attemptId || soumission) return;
    const tick = () => {
      const restant = Math.max(0, Math.round((dateLimite - Date.now()) / 1000));
      setTempsRestant(restant);
      if (restant <= 0) {
        soumettre(attemptId);
      }
    };
    tick();
    const intervalle = setInterval(tick, 1000);
    return () => clearInterval(intervalle);
  }, [dateLimite, attemptId, soumission, soumettre]);

  const questionActuelle = questions[indexActuel];

  useEffect(() => {
    async function chargerMedia() {
      if (!questionActuelle || questionActuelle.type === 'text' || !questionActuelle.media_url) return;
      if (mediaUrls[questionActuelle.id]) return;
      setErreurMedia(null);
      // Jusqu'à 3 essais : une coupure réseau ponctuelle ne doit pas
      // bloquer la question indéfiniment.
      let derniereErreur: string | null = null;
      for (let essai = 1; essai <= 3; essai++) {
        const { data, error } = await supabase.functions.invoke('r2-upload-url', {
          body: { action: 'read', key: questionActuelle.media_url },
        });
        if (data?.readUrl) {
          setMediaUrls((prev) => ({ ...prev, [questionActuelle.id]: data.readUrl }));
          return;
        }
        derniereErreur = data?.error ?? error?.message ?? 'Erreur inconnue.';
        if (essai < 3) await new Promise((r) => setTimeout(r, 800 * essai));
      }
      setErreurMedia(derniereErreur ?? "Le média n'a pas pu être chargé.");
    }
    chargerMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionActuelle, tentativeMedia]);

  function basculerOption(questionId: string, optionId: string, max: number) {
    const actuel = new Set(selections[questionId] ?? []);
    if (actuel.has(optionId)) {
      actuel.delete(optionId);
    } else {
      if (afficherNombreAttendu && actuel.size >= max) return; // limite atteinte, on ignore le clic
      actuel.add(optionId);
    }
    setSelections((prev) => ({ ...prev, [questionId]: actuel }));
  }

  // Enregistre les réponses cochées pour UNE question donnée. Appelée
  // uniquement en quittant la question (Précédent/Suivant) ou à la
  // soumission finale — plus à chaque case cochée, pour limiter
  // nettement le nombre de requêtes envoyées.
  async function sauvegarderQuestion(questionId: string) {
    if (!attemptId) return true;
    setErreurSelection(null);
    const choix = selections[questionId] ?? new Set<string>();

    const { error: errDelete } = await avecRetriesTimeout(() =>
      supabase.from('selected_answers').delete().eq('attempt_id', attemptId).eq('question_id', questionId)
    );
    if (errDelete) {
      setErreurSelection("Tes réponses n'ont pas pu être enregistrées. Réessaie dans un instant.");
      return false;
    }
    if (choix.size > 0) {
      const { error: errInsert } = await supabase
        .from('selected_answers')
        .insert(Array.from(choix).map((optionId) => ({ attempt_id: attemptId, question_id: questionId, option_id: optionId })));
      if (errInsert) {
        setErreurSelection("Tes réponses n'ont pas pu être enregistrées. Réessaie dans un instant.");
        return false;
      }
    }
    return true;
  }

  async function allerA(nouvelIndex: number) {
    if (!questionActuelle || navigationEnCours) return;
    setNavigationEnCours(true);
    const ok = await sauvegarderQuestion(questionActuelle.id);
    setNavigationEnCours(false);
    if (ok) setIndexActuel(nouvelIndex);
  }

  function formatTemps(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  if (loading) {
    return (
      <AppLayout>
        <p className="text-sm text-muted">Chargement…</p>
      </AppLayout>
    );
  }

  if (erreur) {
    return (
      <AppLayout>
        <p className="text-sm text-card-red mb-3">{erreur}</p>
        {attemptId && (
          <button
            type="button"
            onClick={() => soumettre(attemptId)}
            disabled={soumission}
            className="w-full bg-pitch text-white font-medium rounded py-2 text-sm disabled:opacity-60"
          >
            {soumission ? 'Envoi…' : "Réessayer l'envoi"}
          </button>
        )}
      </AppLayout>
    );
  }

  if (!questionActuelle) {
    return (
      <AppLayout>
        <p className="text-sm text-muted">Ce QCM ne contient aucune question pour l'instant.</p>
      </AppLayout>
    );
  }

  const choixActuels = selections[questionActuelle.id] ?? new Set<string>();
  const dernierQuestion = indexActuel === questions.length - 1;
  const tempsCritique = tempsRestant > 0 && tempsRestant <= 120;
  const questionsSansReponse = questions.filter((q) => (selections[q.id]?.size ?? 0) === 0);

  return (
    <AppLayout>
      <p className="text-xs text-muted mb-2">{titre}</p>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted">
          Question {indexActuel + 1} / {questions.length}
        </span>
        <div className={`flex items-baseline gap-1.5 ${tempsCritique ? 'text-card-red' : 'text-pitch-dark'}`}>
          <span className="text-3xl font-bold tabular-nums leading-none">{formatTemps(tempsRestant)}</span>
          <span className="text-xs font-medium">restantes</span>
        </div>
      </div>
      <div className="h-1 bg-canvas rounded overflow-hidden mb-3">
        <div
          className={`h-full ${tempsCritique ? 'bg-card-red' : 'bg-pitch'}`}
          style={{ width: `${((indexActuel + 1) / questions.length) * 100}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {questions.map((q, i) => {
          const repondue = (selections[q.id]?.size ?? 0) > 0;
          const estActuelle = i === indexActuel;
          let classe = 'border-border text-muted';
          if (estActuelle) classe = 'bg-pitch text-white border-pitch';
          else if (repondue) classe = 'bg-pitch-light text-pitch-dark border-pitch';
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => allerA(i)}
              disabled={navigationEnCours || estActuelle}
              className={`w-7 h-7 shrink-0 rounded-full border text-xs font-medium disabled:cursor-default ${classe}`}
              title={`Question ${i + 1}${repondue ? ' — répondue' : ' — sans réponse'}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {questionActuelle.type !== 'text' && (
        <div className="bg-canvas rounded aspect-video flex items-center justify-center mb-4 overflow-hidden">
          {mediaUrls[questionActuelle.id] ? (
            questionActuelle.type === 'video' ? (
              <video src={mediaUrls[questionActuelle.id]} controls preload="auto" className="w-full h-full" />
            ) : (
              <img src={mediaUrls[questionActuelle.id]} alt="" className="w-full h-full object-contain" />
            )
          ) : erreurMedia ? (
            <div className="flex flex-col items-center gap-2 px-4 text-center">
              <span className="text-xs text-card-red">Le média n'a pas pu être chargé. Vérifie ta connexion.</span>
              <button
                type="button"
                onClick={() => setTentativeMedia((n) => n + 1)}
                className="text-xs font-medium bg-pitch text-white rounded px-3 py-1.5"
              >
                Réessayer
              </button>
            </div>
          ) : (
            <span className="text-xs text-muted">Chargement du média…</span>
          )}
        </div>
      )}

      <p className="text-base font-medium mb-1">{questionActuelle.text}</p>
      {afficherNombreAttendu && (
        <p className="text-xs text-muted mb-4">
          Choisis jusqu'à {questionActuelle.max_selectable} réponse(s)
        </p>
      )}

      <div className="flex flex-col gap-2 mb-6">
        {erreurSelection && (
          <p className="text-xs text-card-red bg-card-red-bg rounded px-3 py-2">{erreurSelection}</p>
        )}
        {questionActuelle.options.map((o) => (
          <label
            key={o.id}
            className="flex items-center gap-3 border border-border rounded px-3 py-2.5 text-sm"
          >
            <input
              type="checkbox"
              checked={choixActuels.has(o.id)}
              onChange={() => basculerOption(questionActuelle.id, o.id, questionActuelle.max_selectable)}
            />
            {o.text}
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        {indexActuel > 0 && (
          <button
            type="button"
            onClick={() => allerA(indexActuel - 1)}
            disabled={navigationEnCours}
            className="flex-1 border border-border rounded py-2 text-sm disabled:opacity-60"
          >
            Précédent
          </button>
        )}
        {!dernierQuestion ? (
          <button
            type="button"
            onClick={() => allerA(indexActuel + 1)}
            disabled={navigationEnCours}
            className="flex-1 bg-pitch text-white font-medium rounded py-2 text-sm disabled:opacity-60"
          >
            Question suivante
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmationEnvoi(true)}
            disabled={soumission}
            className="flex-1 bg-pitch text-white font-medium rounded py-2 text-sm disabled:opacity-60"
          >
            {soumission ? 'Envoi…' : 'Terminer le QCM'}
          </button>
        )}
      </div>

      {confirmationEnvoi && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-border rounded-lg p-5 max-w-sm w-full">
            <p className="text-sm font-semibold mb-3">Terminer le QCM ?</p>
            {questionsSansReponse.length > 0 ? (
              <p className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-4">
                {questionsSansReponse.length} question(s) sans réponse :{' '}
                {questionsSansReponse.map((q) => questions.indexOf(q) + 1).join(', ')}.
              </p>
            ) : (
              <p className="text-sm text-muted mb-4">Toutes les questions ont une réponse.</p>
            )}
            <p className="text-xs text-muted mb-4">Cette action est définitive et ne pourra pas être annulée.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmationEnvoi(false)}
                disabled={soumission}
                className="flex-1 border border-border rounded py-2 text-sm disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => attemptId && soumettre(attemptId)}
                disabled={soumission}
                className="flex-1 bg-pitch text-white font-medium rounded py-2 text-sm disabled:opacity-60"
              >
                {soumission ? 'Envoi…' : 'Confirmer et envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
