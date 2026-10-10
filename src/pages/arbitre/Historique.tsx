import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import ArbitreNav from '../../components/ArbitreNav';
import { supabase } from '../../lib/supabaseClient';
import { BadgesStructures } from '../../components/BadgeStructure';
import { chargerStructuresDesQcm, type Structure } from '../../lib/structures';
import { useAuth } from '../../hooks/useAuth';

interface LigneHistorique {
  attempt_id: string;
  quiz_id: string;
  titre: string;
  submitted_at: string;
  score: number | null;
  structures: Structure[];
}

const OPTIONS_NOMBRE_QCM = [3, 5, 10] as const;

function formatDateCourte(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

// Petit graphique d'évolution en SVG "fait main" (pas de librairie de
// graphiques) : léger, sans dépendance supplémentaire ni image à générer.
function GraphiqueEvolution({ lignes }: { lignes: LigneHistorique[] }) {
  const [nombre, setNombre] = useState<(typeof OPTIONS_NOMBRE_QCM)[number]>(5);

  // lignes est trié du plus récent au plus ancien : on prend les N plus
  // récents avec une note connue, puis on remet dans l'ordre chronologique
  // (ancien -> récent) pour une lecture naturelle de gauche à droite.
  const donnees = lignes
    .filter((l): l is LigneHistorique & { score: number } => l.score !== null)
    .slice(0, nombre)
    .slice()
    .reverse();

  const largeur = 300;
  const hauteur = 170;
  const gaucheAxe = 30;
  const droiteMarge = 10;
  const hautMarge = 12;
  const basAxe = 100;
  const n = donnees.length;

  const x = (i: number) =>
    n <= 1 ? (gaucheAxe + (largeur - droiteMarge)) / 2 : gaucheAxe + (i / (n - 1)) * (largeur - droiteMarge - gaucheAxe);
  const y = (score: number) => basAxe - (score / 100) * (basAxe - hautMarge);

  const points = donnees.map((d, i) => ({ x: x(i), y: y(d.score), d }));
  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const labelsInclines = n > 5;

  return (
    <div className="bg-surface border border-border rounded p-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium">Évolution des notes</p>
        <div className="flex gap-1">
          {OPTIONS_NOMBRE_QCM.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setNombre(opt)}
              className={`text-xs rounded px-2 py-1 border ${
                nombre === opt ? 'bg-pitch text-white border-pitch' : 'border-border text-muted'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {n === 0 ? (
        <p className="text-xs text-muted">Pas encore de QCM noté à afficher.</p>
      ) : (
        <svg
          viewBox={`0 0 ${largeur} ${hauteur}`}
          className="w-full h-auto"
          role="img"
          aria-label="Évolution des notes dans le temps"
        >
          {[0, 25, 50, 75, 100].map((pct) => (
            <g key={pct}>
              <line
                x1={gaucheAxe}
                x2={largeur - droiteMarge}
                y1={y(pct)}
                y2={y(pct)}
                stroke="#E3E1DB"
                strokeWidth={1}
              />
              <text x={gaucheAxe - 4} y={y(pct) + 3} textAnchor="end" fontSize={8} fill="#6B6B64">
                {pct}%
              </text>
            </g>
          ))}

          {points.length > 1 && <polyline points={polyline} fill="none" stroke="#1F6F4A" strokeWidth={2} />}

          {points.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={3.5} fill="#1F6F4A" />
              <text
                x={p.x}
                y={labelsInclines ? basAxe + 10 : basAxe + 14}
                textAnchor={labelsInclines ? 'end' : 'middle'}
                fontSize={8}
                fill="#6B6B64"
                transform={labelsInclines ? `rotate(-40 ${p.x} ${basAxe + 10})` : undefined}
              >
                {formatDateCourte(p.d.submitted_at)}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export default function Historique() {
  const { session } = useAuth();
  const [lignes, setLignes] = useState<LigneHistorique[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [retentionJours, setRetentionJours] = useState<number | null>(null);

  useEffect(() => {
    async function charger() {
      if (!session) return;
      setLoading(true);
      setErreur(null);

      const [{ data: attempts, error: err1 }, { data: reglage }] = await Promise.all([
        supabase
          .from('quiz_attempts')
          .select('id, quiz_id, submitted_at')
          .eq('user_id', session.user.id)
          .in('status', ['submitted', 'auto_submitted'])
          .order('submitted_at', { ascending: false }),
        supabase.from('app_settings').select('value').eq('key', 'arbitre_retention_days').maybeSingle(),
      ]);

      if (err1) {
        setErreur('Impossible de charger ton historique. Réessaie dans un instant.');
        setLoading(false);
        return;
      }
      setRetentionJours(reglage ? Number(reglage.value) : null);

      // Notes toujours recalculées en direct plutôt que de faire confiance
      // à la valeur stockée (qui peut devenir périmée).
      const scoresEnDirect = await Promise.all(
        (attempts ?? []).map(async (a) => {
          const { data } = await supabase.rpc('calculer_score_global', { p_attempt_id: a.id });
          return { attemptId: a.id, score: data as number | null };
        })
      );
      const scoreParTentative = Object.fromEntries(scoresEnDirect.map((s) => [s.attemptId, s.score]));

      const quizIds = Array.from(new Set((attempts ?? []).map((a) => a.quiz_id)));
      let titres: Record<string, string> = {};
      if (quizIds.length > 0) {
        const { data: quizzesData } = await supabase.from('quizzes').select('id, title').in('id', quizIds);
        titres = Object.fromEntries((quizzesData ?? []).map((q) => [q.id, q.title]));
      }

      const structuresParQuiz = await chargerStructuresDesQcm(quizIds);

      setLignes(
        (attempts ?? []).map((a) => ({
          structures: structuresParQuiz[a.quiz_id] ?? [],
          attempt_id: a.id,
          quiz_id: a.quiz_id,
          titre: titres[a.quiz_id] ?? 'QCM',
          submitted_at: a.submitted_at,
          score: scoreParTentative[a.id] ?? null,
        }))
      );
      setLoading(false);
    }
    charger();
  }, [session]);

  if (loading) {
    return (
      <AppLayout>
        <ArbitreNav />
        <p className="text-sm text-muted">Chargement…</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ArbitreNav />
      <h1 className="text-lg font-semibold mb-1">Historique</h1>
      {retentionJours !== null && (
        <p className="text-xs text-muted mb-4">
          Consultable pendant {retentionJours} jours après chaque QCM.
        </p>
      )}

      {erreur && <p className="text-sm text-card-red mb-4">{erreur}</p>}
      {lignes.length === 0 && <p className="text-sm text-muted">Aucun QCM répondu pour le moment.</p>}

      {lignes.length > 0 && <GraphiqueEvolution lignes={lignes} />}

      <ul>
        {lignes.map((l) => (
          <li key={l.attempt_id} className="border-b border-border py-3">
            <Link
              to={`/arbitre/qcm/${l.quiz_id}/resultat/${l.attempt_id}`}
              className="flex items-center justify-between"
            >
              <div>
                <p className="text-sm">{l.titre}</p>
                <BadgesStructures structures={l.structures} className="my-1" />
                <p className="text-xs text-muted">
                  Répondu le {new Date(l.submitted_at).toLocaleDateString('fr-FR')}
                </p>
              </div>
              {l.score !== null && (
                <span className="text-sm font-medium">
                  {Number.isInteger(l.score) ? l.score : l.score.toFixed(1)} %
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </AppLayout>
  );
}
