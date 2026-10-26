import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import QuizTabs from '../../components/QuizTabs';
import { supabase } from '../../lib/supabaseClient';
import { extraireErreurFonction } from '../../lib/functionsError';
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
  const [exportEnCours, setExportEnCours] = useState<'excel' | 'csv' | 'pptx' | null>(null);
  // --- Relance par e-mail des arbitres qui n'ont pas répondu ---
  const [periode, setPeriode] = useState<{ statut: string; debut: string; fin: string } | null>(null);
  const [derniereRelance, setDerniereRelance] = useState<{ sent_at: string; recipients: number } | null>(null);
  const [confirmationRelance, setConfirmationRelance] = useState(false);
  const [relanceEnCours, setRelanceEnCours] = useState(false);
  const [messageRelance, setMessageRelance] = useState<{ ok: boolean; texte: string } | null>(null);
  const [relancesDisponibles, setRelancesDisponibles] = useState(false);
  // Arbitres cochés pour la relance (tous par défaut, décochables un à un)
  const [selectionRelance, setSelectionRelance] = useState<Set<string>>(new Set());

  async function charger() {
    if (!quizId) return;
    setLoading(true);
    setErreur(null);

    const { data: quiz, error: errQuiz } = await supabase
      .from('quizzes')
      .select('title, status, period_start, period_end')
      .eq('id', quizId)
      .single();
    if (errQuiz || !quiz) {
      setErreur('Impossible de charger ce QCM.');
      setLoading(false);
      return;
    }
    setTitre(quiz.title);
    setPeriode({ statut: quiz.status, debut: quiz.period_start, fin: quiz.period_end });
    // Dernière relance (table absente tant que la mise à jour SQL n'est pas faite)
    const { data: relances, error: errRelances } = await supabase
      .from('quiz_relances')
      .select('sent_at, recipients')
      .eq('quiz_id', quizId)
      .order('sent_at', { ascending: false })
      .limit(1);
    setDerniereRelance(relances?.[0] ?? null);
    // Le bouton n'apparaît qu'une fois la mise à jour SQL faite : c'est la
    // dernière étape de l'installation, après la mise à jour de la fonction
    // d'envoi des mails (sinon l'ancienne fonction enverrait le mail de
    // publication à TOUS les arbitres).
    setRelancesDisponibles(!errRelances);

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
  const aRelancer = lignes.filter((l) => l.statut !== 'soumis');
  const maintenant = Date.now();
  const qcmEnCours =
    periode !== null &&
    periode.statut === 'published' &&
    maintenant >= new Date(periode.debut).getTime() &&
    maintenant < new Date(periode.fin).getTime();

  async function envoyerRelance() {
    if (!quizId) return;
    setRelanceEnCours(true);
    setMessageRelance(null);
    const { data, error } = await supabase.functions.invoke('notify-quiz-published', {
      body: { quizId, relance: true, userIds: Array.from(selectionRelance) },
    });
    setRelanceEnCours(false);
    setConfirmationRelance(false);
    if (error || data?.error) {
      setMessageRelance({ ok: false, texte: await extraireErreurFonction(error, data) });
      return;
    }
    if (!data?.started) {
      setMessageRelance({ ok: true, texte: data?.message ?? 'Aucun e-mail à envoyer.' });
      return;
    }
    setMessageRelance({
      ok: true,
      texte: `Relance en cours d'envoi à ${data.recipients} arbitre(s) (environ 2 secondes par e-mail).`,
    });
    setDerniereRelance({ sent_at: new Date().toISOString(), recipients: data.recipients });
    await logActivity(`a relancé ${data.recipients} arbitre(s) pour le QCM « ${titre} »`, 'quiz', quizId);
  }
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
      setErreur("L'export CSV a échoué. Réessayez dans un instant.");
    } finally {
      setExportEnCours(null);
    }
  }

  async function exporterExcel() {
    setExportEnCours('excel');
    try {
      // fork de xlsx qui sait écrire les styles (retour à la ligne, gras) ; même fonctionnement
      const module = await import('xlsx-js-style');
      const XLSX = module.default ?? module;
      const classeur = XLSX.utils.book_new();

      const feuilleSynthese = XLSX.utils.json_to_sheet(donneesExport());
      XLSX.utils.book_append_sheet(classeur, feuilleSynthese, 'Résultats');

      const repondants = lignes.filter((l) => l.statut === 'soumis' && l.attemptId);
      if (repondants.length > 0 && quizId) {
        // Questions + réponses possibles (avec la bonne réponse) : la lecture directe de la table des
        // réponses est restreinte, on passe par la fonction réservée au formateur/administrateur.
        const { data: questionsData, error: errQuestions } = await supabase.rpc('get_editor_questions', { p_quiz_id: quizId });
        if (errQuestions) throw errQuestions;
        const questions = (questionsData ?? []) as unknown as {
          id: string;
          text: string;
          options: { id: string; text: string; is_correct: boolean }[];
        }[];

        const { data: selectionsData, error: errSel } = await supabase
          .from('selected_answers')
          .select('attempt_id, option_id')
          .in('attempt_id', repondants.map((r) => r.attemptId as string));
        if (errSel) throw errSel;
        const cochees = new Set((selectionsData ?? []).map((s) => `${s.attempt_id}|${s.option_id}`));

        // Une feuille par question : ligne 1 = énoncé (fusionné), ligne 2 = « Nom Prénom » + réponses
        // possibles + « Note », puis une ligne par arbitre (y compris ceux qui n'ont pas répondu).
        questions.forEach((q, index) => {
          const opts = q.options.map((o) => ({ ...o, text: o.text.trim() }));
          const enonce = q.text.replace(/\r\n?/g, '\n').trim();
          const nbCol = opts.length + 2;
          const lignesFeuille: (string | number | null)[][] = [
            [enonce, ...Array(nbCol - 1).fill(null)],
            ['Nom Prénom', ...opts.map((o) => o.text), 'Note'],
          ];
          const attendu = opts.filter((o) => o.is_correct).length;
          for (const l of lignes) {
            const aRepondu = l.statut === 'soumis' && !!l.attemptId;
            const coches = aRepondu ? opts.filter((o) => cochees.has(`${l.attemptId}|${o.id}`)) : [];
            // même formule que la note du QCM : bonnes cochées / bonnes attendues, 0 si trop de cases cochées
            const bonnes = coches.filter((o) => o.is_correct).length;
            const note = !aRepondu ? null : attendu === 0 || coches.length > attendu ? 0 : Math.round((bonnes / attendu) * 10000) / 100;
            lignesFeuille.push([l.full_name, ...opts.map((o) => (coches.includes(o) ? 'X' : '')), note]);
          }
          const feuille = XLSX.utils.aoa_to_sheet(lignesFeuille);
          feuille['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: nbCol - 1 } }];
          feuille['!cols'] = [{ wch: 28 }, ...opts.map(() => ({ wch: 24 })), { wch: 10 }];
          const largeurTotale = 28 + 24 * opts.length + 10;
          // lignes à l'écran : chaque retour à la ligne de l'énoncé compte, plus les lignes trop longues
          const lignesEnonce = enonce.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / (largeurTotale * 0.85))), 0);
          const lignesEntete = Math.max(1, ...opts.map((o) => Math.ceil(o.text.length / 20)));
          feuille['!rows'] = [{ hpt: 18 * lignesEnonce + 6 }, { hpt: 16 * lignesEntete + 6 }];
          const haut = { wrapText: true, vertical: 'center', horizontal: 'left' };
          const centre = { wrapText: true, vertical: 'center', horizontal: 'center' };
          const fond = { fgColor: { rgb: 'E8F0EC' } };
          const cEnonce = feuille[XLSX.utils.encode_cell({ r: 0, c: 0 })];
          if (cEnonce) cEnonce.s = { font: { bold: true, sz: 12 }, alignment: centre, fill: fond };
          for (let c = 0; c < nbCol; c++) {
            const cEntete = feuille[XLSX.utils.encode_cell({ r: 1, c })];
            if (cEntete) cEntete.s = { font: { bold: true }, alignment: c === 0 ? haut : centre, fill: fond };
          }
          for (let r = 2; r < lignesFeuille.length; r++) {
            for (let c = 1; c < nbCol; c++) {
              const cc = feuille[XLSX.utils.encode_cell({ r, c })];
              if (cc) cc.s = { alignment: { vertical: 'center', horizontal: 'center' }, ...(opts[c - 1]?.is_correct ? { fill: fond } : {}) };
            }
            const cellule = feuille[XLSX.utils.encode_cell({ r, c: nbCol - 1 })];
            if (cellule && cellule.t === 'n') cellule.z = '0.##" %"';
          }
          // Excel limite les noms de feuille à 31 caractères et interdit : \ / ? * [ ]
          const nomFeuille = `Q${index + 1} - ${enonce.replace(/\s+/g, " ")}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
          XLSX.utils.book_append_sheet(classeur, feuille, nomFeuille);
        });
      }

      XLSX.writeFile(classeur, `${titre}.xlsx`);
    } catch {
      setErreur("L'export Excel a échoué. Réessayez dans un instant.");
    } finally {
      setExportEnCours(null);
    }
  }

  // Correction à projeter (visio, formation) : PowerPoint généré dans le navigateur.
  async function exporterPowerPoint() {
    if (!quizId) return;
    setExportEnCours('pptx');
    try {
      const { data, error } = await supabase.rpc('get_editor_questions', { p_quiz_id: quizId });
      if (error) throw error;
      const { genererPowerPoint } = await import('../../lib/exportPowerPoint');
      await genererPowerPoint(
        { titre, nbRepondus: repondus.length, nbArbitres: lignes.length, moyenne: scoreMoyen },
        (data ?? []) as unknown as Parameters<typeof genererPowerPoint>[1],
        `${titre} - Correction.pptx`
      );
    } catch {
      setErreur("L'export PowerPoint a échoué. Réessayez dans un instant.");
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
      setErreur('La suppression a échoué. Réessayez dans un instant.');
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

      {relancesDisponibles && qcmEnCours && (aRelancer.length > 0 || messageRelance) && (
        <div className="bg-surface border border-border rounded p-3 mb-4">
          {!confirmationRelance ? (
            aRelancer.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMessageRelance(null);
                  setSelectionRelance(new Set(aRelancer.map((l) => l.id)));
                  setConfirmationRelance(true);
                }}
                className="w-full bg-pitch text-white font-medium rounded py-2 text-sm"
              >
                Relancer par e-mail les {aRelancer.length} arbitre(s) qui n'ont pas répondu
              </button>
            )
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm">Décochez les arbitres à ne pas relancer :</p>
                <button
                  type="button"
                  onClick={() =>
                    setSelectionRelance(
                      selectionRelance.size === aRelancer.length ? new Set() : new Set(aRelancer.map((l) => l.id))
                    )
                  }
                  className="text-xs text-muted underline shrink-0 min-h-0"
                >
                  {selectionRelance.size === aRelancer.length ? 'Tout décocher' : 'Tout cocher'}
                </button>
              </div>
              <ul className="flex flex-col gap-1.5 mb-3 max-h-60 overflow-y-auto">
                {aRelancer.map((l) => (
                  <li key={l.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectionRelance.has(l.id)}
                        onChange={() =>
                          setSelectionRelance((prev) => {
                            const next = new Set(prev);
                            if (next.has(l.id)) next.delete(l.id);
                            else next.add(l.id);
                            return next;
                          })
                        }
                      />
                      <span className="flex-1 min-w-0">{l.full_name}</span>
                      <span className="text-xs text-muted shrink-0">
                        {l.statut === 'en_cours' ? 'commencé, pas terminé' : 'pas commencé'}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmationRelance(false)}
                  disabled={relanceEnCours}
                  className="flex-1 border border-border rounded py-2 text-sm disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={envoyerRelance}
                  disabled={relanceEnCours || selectionRelance.size === 0}
                  className="flex-1 bg-pitch text-white font-medium rounded py-2 text-sm disabled:opacity-60"
                >
                  {relanceEnCours ? 'Envoi…' : `Relancer ${selectionRelance.size} arbitre(s)`}
                </button>
              </div>
            </div>
          )}
          {messageRelance && (
            <p className={`text-xs mt-2 ${messageRelance.ok ? 'text-pitch-dark' : 'text-card-red'}`}>
              {messageRelance.texte}
            </p>
          )}
          {derniereRelance && (
            <p className="text-xs text-muted mt-2">
              Dernière relance le{' '}
              {new Date(derniereRelance.sent_at).toLocaleString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              ({derniereRelance.recipients} arbitre(s))
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-1">
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
        <button
          type="button"
          onClick={exporterPowerPoint}
          disabled={lignes.length === 0 || exportEnCours !== null}
          className="flex-1 text-sm border border-border rounded py-1.5 disabled:opacity-50"
        >
          {exportEnCours === 'pptx' ? 'Génération…' : 'Correction PowerPoint'}
        </button>
      </div>

      {exportEnCours && (
        <div className="mb-2">
          <div className="h-1.5 bg-pitch rounded animate-pulse" />
          <p className="text-xs text-muted mt-1">
            Export {exportEnCours === 'excel' ? 'Excel' : exportEnCours === 'pptx' ? 'PowerPoint' : 'CSV'} en cours…
          </p>
        </div>
      )}

      <p className="text-xs text-muted mb-6">
        Excel inclut le détail question par question (une feuille par question) ; le CSV ne
        contient que la synthèse des scores. La correction PowerPoint sert à projeter la correction (une paire de diapositives par question).
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
              Des réponses ont déjà été reçues — pensez à exporter les résultats ci-dessus avant de
              continuer si vous voulez les garder.
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
