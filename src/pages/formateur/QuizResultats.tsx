import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import QuizTabs from '../../components/QuizTabs';
import { supabase } from '../../lib/supabaseClient';
import { useCouleurStructureEcran, useStructuresQcm } from '../../hooks/useCouleurQcm';
import { logActivity } from '../../lib/activityLog';

interface LigneResultat {
  id: string;
  full_name: string;
  email: string;
  statut: 'non_repondu' | 'en_cours' | 'soumis';
  score: number | null;
  attemptId: string | null;
}

export default function QuizResultats() {
  const { id: quizId } = useParams();
  // Éléments verts de l'écran aux couleurs de la structure du QCM
  useCouleurStructureEcran(useStructuresQcm(quizId));
  const navigate = useNavigate();
  const location = useLocation();
  // Cet écran est accessible aussi bien par le formateur propriétaire que
  // par l'administrateur (mêmes données, même export) : on adapte les
  // liens internes et le retour selon le chemin par lequel on y est venu.
  const basePath = location.pathname.startsWith('/admin') ? '/admin' : '/formateur';

  const [titre, setTitre] = useState('');
  const [lignes, setLignes] = useState<LigneResultat[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [exportEnCours, setExportEnCours] = useState<'excel' | 'csv' | null>(null);

  async function charger() {
    if (!quizId) return;
    setLoading(true);
    setErreur(null);

    const { data: quiz, error: errQuiz } = await supabase
      .from('quizzes')
      .select('title')
      .eq('id', quizId)
      .single();
    if (errQuiz || !quiz) {
      setErreur('Impossible de charger ce QCM.');
      setLoading(false);
      return;
    }
    setTitre(quiz.title);

    const { data: quizGroups } = await supabase.from('quiz_groups').select('group_id').eq('quiz_id', quizId);
    const groupIds = (quizGroups ?? []).map((g) => g.group_id);

    let arbitreIds: string[] = [];
    if (groupIds.length > 0) {
      const { data: membres } = await supabase
        .from('group_members')
        .select('user_id')
        .in('group_id', groupIds);
      arbitreIds = Array.from(new Set((membres ?? []).map((m) => m.user_id)));
    }

    let profils: { id: string; full_name: string; email: string }[] = [];
    if (arbitreIds.length > 0) {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', arbitreIds)
        .order('full_name');
      profils = data ?? [];
    }

    const { data: tentatives } = await supabase
      .from('quiz_attempts')
      .select('id, user_id, status')
      .eq('quiz_id', quizId);

    // Notes toujours recalculées en direct plutôt que de faire confiance
    // à la valeur stockée (qui peut devenir périmée).
    const scoresEnDirect = await Promise.all(
      (tentatives ?? [])
        .filter((t) => t.status !== 'in_progress')
        .map(async (t) => {
          const { data } = await supabase.rpc('calculer_score_global', { p_attempt_id: t.id });
          return { attemptId: t.id, score: data as number | null };
        })
    );
    const scoreParTentative = Object.fromEntries(scoresEnDirect.map((s) => [s.attemptId, s.score]));

    const resultat: LigneResultat[] = profils.map((p) => {
      const tentative = tentatives?.find((t) => t.user_id === p.id);
      let statut: LigneResultat['statut'] = 'non_repondu';
      if (tentative) {
        statut = tentative.status === 'in_progress' ? 'en_cours' : 'soumis';
      }
      return {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        statut,
        score: tentative ? (scoreParTentative[tentative.id] ?? null) : null,
        attemptId: tentative?.id ?? null,
      };
    });

    setLignes(resultat);
    setLoading(false);
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  const repondus = lignes.filter((l) => l.statut === 'soumis');
  const scoreMoyen =
    repondus.length > 0
      ? repondus.reduce((s, l) => s + (l.score ?? 0), 0) / repondus.length
      : null;

  function formatPourcentage(n: number) {
    return Number.isInteger(n) ? `${n} %` : `${n.toFixed(1)} %`;
  }

  function donneesExport() {
    return lignes.map((l) => ({
      Nom: l.full_name,
      'E-mail': l.email,
      Statut: l.statut === 'soumis' ? 'Répondu' : l.statut === 'en_cours' ? 'En cours' : 'Non répondu',
      Score: l.score !== null ? formatPourcentage(l.score) : '',
    }));
  }

  function exporterCsv() {
    setExportEnCours('csv');
    try {
      const donnees = donneesExport();
      const entetes = Object.keys(donnees[0] ?? { Nom: '', 'E-mail': '', Statut: '', Score: '' });
      const lignesCsv = [
        entetes.join(';'),
        ...donnees.map((d) => entetes.map((e) => `"${String(d[e as keyof typeof d]).replace(/"/g, '""')}"`).join(';')),
      ];
      const blob = new Blob([lignesCsv.join('\n')], { type: 'text/csv;charset=utf-8;' });
      telecharger(blob, `${titre}.csv`);
    } catch {
      setErreur("L'export CSV a échoué. Réessaie dans un instant.");
    } finally {
      setExportEnCours(null);
    }
  }

  async function exporterExcel() {
    setExportEnCours('excel');
    try {
      const XLSX = await import('xlsx');
      const classeur = XLSX.utils.book_new();

      const feuilleSynthese = XLSX.utils.json_to_sheet(donneesExport());
      XLSX.utils.book_append_sheet(classeur, feuilleSynthese, 'Résultats');

      const repondants = lignes.filter((l) => l.statut === 'soumis' && l.attemptId);
      if (repondants.length > 0 && quizId) {
        const { data: questionsData } = await supabase
          .from('questions')
          .select('id, text, order_index')
          .eq('quiz_id', quizId)
          .order('order_index');

        const questionIds = (questionsData ?? []).map((q) => q.id);
        const { data: optionsData } =
          questionIds.length > 0
            ? await supabase.from('answer_options').select('id, question_id, text').in('question_id', questionIds)
            : { data: [] };

        const attemptIds = repondants.map((r) => r.attemptId as string);
        const { data: selectionsData } = await supabase
          .from('selected_answers')
          .select('attempt_id, option_id')
          .in('attempt_id', attemptIds);

        // Structures construites UNE SEULE FOIS : recherche instantanée
        // ensuite, au lieu de reparcourir toute la liste à chaque case
        // (question × arbitre × réponse), qui devenait très lent avec
        // beaucoup de questions et d'arbitres.
        const selectionsParClef = new Set(
          (selectionsData ?? []).map((s) => `${s.attempt_id}|${s.option_id}`)
        );
        const optionsParQuestion = new Map<string, { id: string; text: string }[]>();
        for (const o of optionsData ?? []) {
          if (!optionsParQuestion.has(o.question_id)) optionsParQuestion.set(o.question_id, []);
          optionsParQuestion.get(o.question_id)!.push(o);
        }
        for (const liste of optionsParQuestion.values()) {
          liste.sort((a, b) => a.id.localeCompare(b.id));
        }

        // Deux réponses d'une même question peuvent avoir exactement le
        // même texte (ex. données de test tapées rapidement). Comme le
        // texte sert de nom de colonne Excel, on numérote les doublons
        // pour ne jamais les faire s'écraser l'un l'autre.
        const entetesParOption = new Map<string, string>();
        for (const liste of optionsParQuestion.values()) {
          const occurrences = new Map<string, number>();
          for (const o of liste) {
            const n = (occurrences.get(o.text) ?? 0) + 1;
            occurrences.set(o.text, n);
            entetesParOption.set(o.id, n > 1 ? `${o.text} (${n})` : o.text);
          }
        }

        (questionsData ?? []).forEach((q, index) => {
          const optionsQuestion = optionsParQuestion.get(q.id) ?? [];

          const lignesFeuille = repondants.map((r) => {
            const ligne: Record<string, string> = { Arbitre: r.full_name };
            optionsQuestion.forEach((o) => {
              const entete = entetesParOption.get(o.id) ?? o.text;
              ligne[entete] = selectionsParClef.has(`${r.attemptId}|${o.id}`) ? 'X' : '';
            });
            return ligne;
          });

          const feuille = XLSX.utils.json_to_sheet(lignesFeuille);
          // Excel limite les noms de feuille à 31 caractères et interdit : \ / ? * [ ]
          const nomFeuille = `Q${index + 1} - ${q.text}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
          XLSX.utils.book_append_sheet(classeur, feuille, nomFeuille);
        });
      }

      XLSX.writeFile(classeur, `${titre}.xlsx`);
    } catch {
      setErreur("L'export Excel a échoué. Réessaie dans un instant.");
    } finally {
      setExportEnCours(null);
    }
  }

  function telecharger(blob: Blob, nomFichier: string) {
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nomFichier;
    lien.click();
    URL.revokeObjectURL(url);
  }

  async function supprimerDefinitivement() {
    if (!quizId) return;
    setSuppression(true);

    // Nettoyage des vidéos sur R2 d'abord ; un échec éventuel ne doit pas
    // empêcher la suppression du QCM lui-même (voir commentaire dans la
    // fonction serveur).
    await supabase.functions.invoke('delete-quiz-videos', { body: { quizId } });

    const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
    setSuppression(false);
    if (!error) {
      await logActivity(`a supprimé le QCM « ${titre} »`, 'quiz', quizId);
      navigate(basePath);
    } else {
      setErreur('La suppression a échoué. Réessaie dans un instant.');
    }
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
      {basePath === '/formateur' ? (
        quizId && <QuizTabs quizId={quizId} />
      ) : (
        <Link to="/admin" className="text-sm text-muted underline mb-3 inline-block">
          ← Vue d'ensemble
        </Link>
      )}
      <h1 className="text-lg font-semibold mb-1">{titre}</h1>
      <p className="text-sm text-muted mb-4">
        {repondus.length}/{lignes.length} répondus
        {scoreMoyen !== null && ` · Score moyen ${formatPourcentage(scoreMoyen)}`}
      </p>

      {erreur && <p className="text-sm text-card-red mb-4">{erreur}</p>}

      <div className="flex gap-2 mb-1">
        <button
          type="button"
          onClick={exporterExcel}
          disabled={lignes.length === 0 || exportEnCours !== null}
          className="flex-1 text-sm border border-border rounded py-1.5 disabled:opacity-50"
        >
          {exportEnCours === 'excel' ? 'Génération…' : 'Export Excel'}
        </button>
        <button
          type="button"
          onClick={exporterCsv}
          disabled={lignes.length === 0 || exportEnCours !== null}
          className="flex-1 text-sm border border-border rounded py-1.5 disabled:opacity-50"
        >
          {exportEnCours === 'csv' ? 'Génération…' : 'Export CSV'}
        </button>
      </div>

      {exportEnCours && (
        <div className="mb-2">
          <div className="h-1.5 bg-pitch rounded animate-pulse" />
          <p className="text-xs text-muted mt-1">
            Export {exportEnCours === 'excel' ? 'Excel' : 'CSV'} en cours…
          </p>
        </div>
      )}

      <p className="text-xs text-muted mb-6">
        Excel inclut le détail question par question (une feuille par question) ; le CSV ne
        contient que la synthèse des scores.
      </p>

      {lignes.length === 0 && (
        <p className="text-sm text-muted mb-6">
          Aucun arbitre ciblé pour l'instant (ce QCM n'a pas encore de groupe destinataire).
        </p>
      )}

      <ul className="mb-6">
        {lignes.map((l) =>
          l.statut === 'soumis' && l.attemptId ? (
            <li key={l.id} className="border-b border-border">
              <Link
                to={`${basePath}/qcm/${quizId}/resultats/${l.attemptId}`}
                className="flex items-center justify-between py-2.5"
              >
                <span className="text-sm">{l.full_name}</span>
                <span className="text-sm font-medium">{formatPourcentage(l.score ?? 0)}</span>
              </Link>
            </li>
          ) : (
            <li key={l.id} className="flex items-center justify-between py-2.5 border-b border-border">
              <span className={`text-sm ${l.statut === 'non_repondu' ? 'text-muted' : ''}`}>
                {l.full_name}
              </span>
              {l.statut === 'en_cours' && <span className="text-xs text-card-yellow">En cours</span>}
              {l.statut === 'non_repondu' && <span className="text-xs text-muted">{l.email}</span>}
            </li>
          )
        )}
      </ul>

      {!confirmationSuppression ? (
        <button
          type="button"
          onClick={() => setConfirmationSuppression(true)}
          className="w-full border border-border rounded py-2 text-sm text-card-red"
        >
          Supprimer ce QCM
        </button>
      ) : (
        <div className="border border-card-red rounded p-3">
          <p className="text-sm font-medium mb-3">
            Confirmer la suppression ? Cette action est définitive.
          </p>
          {lignes.some((l) => l.statut !== 'non_repondu') && (
            <p className="text-xs text-muted mb-3">
              Des réponses ont déjà été reçues — pense à exporter les résultats ci-dessus avant de
              continuer si tu veux les garder.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmationSuppression(false)}
              className="flex-1 border border-border rounded py-2 text-sm"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={supprimerDefinitivement}
              disabled={suppression}
              className="flex-1 bg-card-red text-white rounded py-2 text-sm disabled:opacity-60"
            >
              {suppression ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
