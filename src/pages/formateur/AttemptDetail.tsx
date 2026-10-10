import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
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

// Même code couleur que côté arbitre : la case reflète toujours
// exactement ce qui a été coché, jamais forcée pour indiquer une bonne
// réponse manquée.
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

export default function AttemptDetail() {
  const { id: quizId, attemptId } = useParams();
  // Éléments verts de l'écran aux couleurs de la structure du QCM
  useCouleurStructureEcran(useStructuresQcm(quizId));
  const location = useLocation();
  const basePath = location.pathname.startsWith('/admin') ? '/admin' : '/formateur';
  const [nomArbitre, setNomArbitre] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [questions, setQuestions] = useState<QuestionGroupee[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [chargementMedia, setChargementMedia] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    async function charger() {
      if (!attemptId) return;
      setLoading(true);
      setErreur(null);

      const { data: attempt } = await supabase
        .from('quiz_attempts')
        .select('user_id')
        .eq('id', attemptId)
        .single();

      const { data: scoreEnDirect } = await supabase.rpc('calculer_score_global', {
        p_attempt_id: attemptId,
      });
      setScore(scoreEnDirect ?? null);

      if (attempt?.user_id) {
        const { data: profil } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', attempt.user_id)
          .single();
        setNomArbitre(profil?.full_name ?? '');
      }

      const { data: detail, error } = await supabase.rpc('get_attempt_details_for_formateur', {
        p_attempt_id: attemptId,
      });
      if (error) {
        setErreur("Impossible de charger le détail des réponses.");
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
      setLoading(false);
    }
    charger();
  }, [attemptId]);

  async function afficherMedia(question: QuestionGroupee) {
    if (!question.media_url || mediaUrls[question.id]) return;
    setChargementMedia(question.id);
    const { data } = await supabase.functions.invoke('r2-upload-url', {
      body: { action: 'read', key: question.media_url },
    });
    if (data?.readUrl) {
      setMediaUrls((prev) => ({ ...prev, [question.id]: data.readUrl }));
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
      <Link to={`${basePath}/qcm/${quizId}/resultats`} className="text-sm text-muted underline mb-3 inline-block">
        ← Résultats
      </Link>
      <h1 className="text-lg font-semibold mb-1">{nomArbitre}</h1>

      <div className="bg-surface border border-border rounded p-5 text-center mb-6">
        <p className="text-sm text-muted mb-1">Score</p>
        <p className="text-3xl font-semibold">{score !== null ? formatPourcentage(score) : '—'}</p>
      </div>

      {erreur && <p className="text-sm text-card-red mb-4">{erreur}</p>}

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
    </AppLayout>
  );
}
