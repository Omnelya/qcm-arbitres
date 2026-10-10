import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import { supabase } from '../../lib/supabaseClient';
import { useCouleurStructureEcran, useStructuresQcm } from '../../hooks/useCouleurQcm';

interface LigneDetail {
  question_id: string;
  question_type: 'video' | 'image' | 'text';
  media_url: string | null;
  question_text: string;
  explanation: string | null;
  question_score: number;
  option_id: string;
  option_text: string;
  is_correct: boolean;
  was_selected: boolean;
}
interface OptionAffichee {
  id: string;
  text: string;
  is_correct: boolean;
  was_selected: boolean;
}
interface QuestionGroupee {
  id: string;
  type: 'video' | 'image' | 'text';
  media_url: string | null;
  text: string;
  explanation: string | null;
  score: number;
  options: OptionAffichee[];
}

function formatPourcentage(n: number) {
  return Number.isInteger(n) ? `${n} %` : `${n.toFixed(1)} %`;
}
function formatDate(d: string) {
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Code couleur + mention textuelle d'une réponse :
// bonne réponse cochée -> vert "Correct" ; bonne réponse oubliée ->
// jaune "Manquante" ; mauvaise réponse cochée -> rouge "Incorrect" ;
// le reste -> neutre, sans mention.
function statutOption(o: OptionAffichee): { classe: string; label: string | null; couleurTexte: string } {
  if (o.is_correct && o.was_selected) {
    return { classe: 'border-pitch bg-pitch-light', label: 'Correct', couleurTexte: 'text-pitch-dark' };
  }
  if (o.is_correct && !o.was_selected) {
    return { classe: 'border-card-yellow bg-card-yellow-bg', label: 'Manquante', couleurTexte: 'text-card-yellow' };
  }
  if (!o.is_correct && o.was_selected) {
    return { classe: 'border-card-red bg-card-red-bg', label: 'Incorrect', couleurTexte: 'text-card-red' };
  }
  return { classe: 'border-border', label: null, couleurTexte: 'text-muted' };
}

export default function QuizAttemptResult() {
  const { id: quizId, attemptId } = useParams();
  // Couleurs de l'écran aux couleurs de la structure du QCM
  useCouleurStructureEcran(useStructuresQcm(quizId));
  const [titre, setTitre] = useState('');
  const [showScore, setShowScore] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [periodeFin, setPeriodeFin] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [questions, setQuestions] = useState<QuestionGroupee[]>([]);
  const [correctionIndisponible, setCorrectionIndisponible] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [chargementMedia, setChargementMedia] = useState<string | null>(null);
  const [erreurMedia, setErreurMedia] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function charger() {
      if (!quizId || !attemptId) return;
      setLoading(true);

      const { data: quiz } = await supabase
        .from('quizzes')
        .select('title, show_score, show_correction, period_end')
        .eq('id', quizId)
        .single();
      setTitre(quiz?.title ?? '');
      setShowScore(quiz?.show_score ?? false);
      setShowCorrection(quiz?.show_correction ?? false);
      setPeriodeFin(quiz?.period_end ?? null);

      const { data: scoreEnDirect } = await supabase.rpc('calculer_score_global', {
        p_attempt_id: attemptId,
      });
      setScore(scoreEnDirect ?? null);

      if (quiz?.show_correction) {
        const { data: detail, error } = await supabase.rpc('get_exam_results', {
          p_attempt_id: attemptId,
        });
        if (error) {
          setCorrectionIndisponible(error.message);
        } else {
          const parQuestion = new Map<string, LigneDetail[]>();
          for (const ligne of (detail ?? []) as LigneDetail[]) {
            if (!parQuestion.has(ligne.question_id)) parQuestion.set(ligne.question_id, []);
            parQuestion.get(ligne.question_id)!.push(ligne);
          }
          const groupees: QuestionGroupee[] = Array.from(parQuestion.entries()).map(([id, lignes]) => ({
            id,
            type: lignes[0].question_type,
            media_url: lignes[0].media_url,
            text: lignes[0].question_text,
            explanation: lignes[0].explanation,
            score: lignes[0].question_score,
            options: lignes.map((l) => ({
              id: l.option_id,
              text: l.option_text,
              is_correct: l.is_correct,
              was_selected: l.was_selected,
            })),
          }));
          setQuestions(groupees);
        }
      }
      setLoading(false);
    }
    charger();
  }, [quizId, attemptId]);

  async function afficherMedia(question: QuestionGroupee) {
    if (!question.media_url || mediaUrls[question.id]) return;
    setChargementMedia(question.id);
    setErreurMedia(null);
    const { data } = await supabase.functions.invoke('r2-upload-url', {
      body: { action: 'read', key: question.media_url },
    });
    if (data?.readUrl) {
      setMediaUrls((prev) => ({ ...prev, [question.id]: data.readUrl }));
    } else {
      setErreurMedia(question.id);
    }
    setChargementMedia(null);
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
      <div className="text-center mb-5">
        <p className="text-lg font-semibold mb-1">QCM terminé</p>
        <p className="text-sm text-muted">{titre}</p>
      </div>

      {showScore && (
        <div className="bg-surface border border-border rounded p-5 text-center mb-6">
          <p className="text-sm text-muted mb-1">Ton score</p>
          <p className="text-3xl font-semibold">{score !== null ? formatPourcentage(score) : '—'}</p>
        </div>
      )}

      {!showScore && (
        <div className="bg-surface border border-border rounded p-5 text-center mb-6">
          <p className="text-sm">Ta réponse a bien été enregistrée et soumise.</p>
        </div>
      )}

      {showCorrection && (
        <>
          <p className="text-sm text-muted mb-2">Correction détaillée</p>

          {correctionIndisponible ? (
            <p className="text-sm text-muted bg-surface border border-border rounded px-3 py-3">
              {correctionIndisponible}
              {periodeFin && correctionIndisponible.includes('après la fin') && (
                <> ({formatDate(periodeFin)})</>
              )}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {questions.map((q) => (
                <li key={q.id} className="border border-border rounded p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-medium">{q.text}</p>
                    <span className="text-xs font-medium shrink-0">{formatPourcentage(q.score)}</span>
                  </div>

                  {q.type !== 'text' && q.media_url && (
                    <div className="mb-3">
                      {mediaUrls[q.id] ? (
                        q.type === 'video' ? (
                          <video src={mediaUrls[q.id]} controls className="w-full rounded max-h-48" />
                        ) : (
                          <img src={mediaUrls[q.id]} alt="" className="w-full rounded max-h-48 object-contain" />
                        )
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => afficherMedia(q)}
                            disabled={chargementMedia === q.id}
                            className="text-xs border border-border rounded px-3 py-1.5"
                          >
                            {chargementMedia === q.id
                              ? 'Chargement…'
                              : q.type === 'video'
                                ? 'Revoir la vidéo'
                                : "Revoir l'image"}
                          </button>
                          {erreurMedia === q.id && (
                            <span className="text-xs text-card-red">Échec du chargement, réessaie.</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5 mb-2">
                    {q.options.map((o) => {
                      const statut = statutOption(o);
                      return (
                        <div
                          key={o.id}
                          className={`flex items-center gap-2 border rounded px-3 py-2 text-sm ${statut.classe}`}
                        >
                          <input type="checkbox" checked={o.was_selected} disabled readOnly />
                          <span className="flex-1">{o.text}</span>
                          {statut.label && (
                            <span className={`text-xs font-medium shrink-0 ${statut.couleurTexte}`}>
                              {statut.label}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {q.explanation && <p className="text-xs text-muted">Explication : {q.explanation}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Link
        to="/arbitre"
        className="block w-full text-center border border-border rounded py-2 text-sm mt-6"
      >
        Retour à mes QCM
      </Link>
    </AppLayout>
  );
}
