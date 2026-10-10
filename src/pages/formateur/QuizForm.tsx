import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import AppLayout from '../../components/AppLayout';
import QuizTabs from '../../components/QuizTabs';
import { supabase } from '../../lib/supabaseClient';
import BadgeStructure from '../../components/BadgeStructure';
import { useCouleurStructureEcran } from '../../hooks/useCouleurQcm';
import { chargerStructures, styleBoutonStructures, type Structure } from '../../lib/structures';
import { logActivity } from '../../lib/activityLog';
import { avecRetriesTimeout } from '../../lib/retryTimeout';
import { useAuth } from '../../hooks/useAuth';

interface GroupRow {
  id: string;
  name: string;
  structure: Structure | null;
}

function traduireErreur(message?: string): string {
  if (message?.includes('quizzes_period_valid')) {
    return 'La date de fin doit être après (ou égale à) la date de début.';
  }
  return "L'enregistrement a échoué. Vérifie les champs et réessaie.";
}

// Convertit un instant ISO (venant de la base) vers le format attendu par
// <input type="datetime-local">, en heure locale du navigateur.
function versDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function QuizForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();

  const [confirmation, setConfirmation] = useState(false);
  const [popupPublication, setPopupPublication] = useState(false);
  const [popupGroupeManquant, setPopupGroupeManquant] = useState(false);

  const [titre, setTitre] = useState('');
  const [statut, setStatut] = useState<'draft' | 'published' | null>(null);
  const [dureeMinutes, setDureeMinutes] = useState(20);
  const [afficherScore, setAfficherScore] = useState(true);
  const [afficherCorrection, setAfficherCorrection] = useState(true);
  const [afficherNombreAttendu, setAfficherNombreAttendu] = useState(true);
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [groupes, setGroupes] = useState<GroupRow[]>([]);
  const [groupesSelectionnes, setGroupesSelectionnes] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [duplication, setDuplication] = useState(false);

  const estPublie = statut === 'published';

  useEffect(() => {
    const etat = location.state as { justSaved?: boolean; justPublished?: boolean } | null;
    if (etat?.justPublished) {
      setPopupPublication(true);
      navigate(location.pathname, { replace: true, state: null });
    } else if (etat?.justSaved) {
      setConfirmation(true);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(false), 4000);
    return () => clearTimeout(t);
  }, [confirmation]);

  useEffect(() => {
    async function charger() {
      // Le nom de la structure est ajouté à côté du nom du groupe (si la
      // mise à jour SQL des structures a été exécutée dans Supabase).
      const { structures: structuresData, erreur: errStructures } = await chargerStructures();
      const { data: groupesBruts } = await supabase
        .from('groups')
        .select(errStructures ? 'id, name' : 'id, name, structure_id')
        .order('name');
      setGroupes(
        ((groupesBruts ?? []) as unknown as { id: string; name: string; structure_id?: string | null }[]).map((g) => {
          const structure = structuresData.find((s) => s.id === g.structure_id) ?? null;
          return { id: g.id, name: g.name, structure };
        })
      );

      if (id) {
        const { data: quiz, error } = await supabase
          .from('quizzes')
          .select('title, status, time_limit_minutes, show_score, show_correction, show_expected_count, period_start, period_end')
          .eq('id', id)
          .single();

        if (error || !quiz) {
          setErreur('Impossible de charger ce QCM.');
          setLoading(false);
          return;
        }

        setTitre(quiz.title);
        setStatut(quiz.status);
        setDureeMinutes(quiz.time_limit_minutes);
        setAfficherScore(quiz.show_score);
        setAfficherCorrection(quiz.show_correction);
        setAfficherNombreAttendu(quiz.show_expected_count);
        setDateDebut(versDatetimeLocal(quiz.period_start));
        setDateFin(versDatetimeLocal(quiz.period_end));

        const { data: qg } = await supabase.from('quiz_groups').select('group_id').eq('quiz_id', id);
        setGroupesSelectionnes(new Set((qg ?? []).map((r) => r.group_id)));
      }
      setLoading(false);
    }
    charger();
  }, [id]);

  function basculerGroupe(groupId: string) {
    setGroupesSelectionnes((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  async function enregistrer(nouveauStatut: 'draft' | 'published') {
    if (!session) return;
    setErreur(null);
    setEnregistrement(true);

    // Capturé avant toute modification : ne notifier les arbitres par mail
    // que lors du tout premier passage en "published", jamais lors d'une
    // republication après modification.
    const etaitDejaPublie = statut === 'published';

    const payload: Record<string, unknown> = {
      formateur_id: session.user.id,
      title: titre,
      time_limit_minutes: dureeMinutes,
      show_score: afficherScore,
      show_correction: afficherCorrection,
      show_expected_count: afficherNombreAttendu,
      period_start: new Date(dateDebut).toISOString(),
      period_end: new Date(dateFin).toISOString(),
      status: nouveauStatut,
    };
    if (nouveauStatut === 'published') {
      payload.published_at = new Date().toISOString();
    }

    const { error } = await supabase.from('quizzes').update(payload).eq('id', id);
    if (error) {
      setErreur(traduireErreur(error.message));
      setEnregistrement(false);
      return;
    }
    await logActivity(`a modifié le QCM « ${titre} »`, 'quiz', id);

    // Resynchronise les groupes cibles : on efface puis on réinsère,
    // plus simple et plus sûr qu'un diff précis pour un petit nombre de lignes.
    const { error: errDeleteGroupes } = await avecRetriesTimeout(() =>
      supabase.from('quiz_groups').delete().eq('quiz_id', id as string)
    );
    if (errDeleteGroupes) {
      setErreur("Impossible de mettre à jour les groupes ciblés. Réessaie dans un instant.");
      setEnregistrement(false);
      return;
    }
    if (groupesSelectionnes.size > 0) {
      await supabase
        .from('quiz_groups')
        .insert(Array.from(groupesSelectionnes).map((groupId) => ({ quiz_id: id, group_id: groupId })));
    }

    if (nouveauStatut === 'published' && !etaitDejaPublie) {
      // Envoi "fire and forget" : on n'attend pas la fin (l'envoi réel des
      // mails se poursuit côté serveur) et un échec ne doit pas empêcher la
      // publication, déjà effective à ce stade.
      supabase.functions.invoke('notify-quiz-published', { body: { quizId: id } }).catch(() => {});
    }

    setEnregistrement(false);
    if (nouveauStatut === 'published') {
      navigate(`/formateur/qcm/${id}`, { replace: true, state: { justPublished: true } });
    } else {
      navigate(`/formateur/qcm/${id}`, { replace: true, state: { justSaved: true } });
    }
  }

  function demanderPublication() {
    if (groupesSelectionnes.size === 0) {
      setPopupGroupeManquant(true);
      return;
    }
    enregistrer('published');
  }

  async function supprimerBrouillon() {
    if (!id) return;
    setSuppression(true);
    await supabase.functions.invoke('delete-quiz-videos', { body: { quizId: id } });
    const { error } = await supabase.from('quizzes').delete().eq('id', id);
    setSuppression(false);
    if (!error) {
      await logActivity(`a supprimé le brouillon « ${titre} »`, 'quiz', id);
      navigate('/formateur');
    } else {
      setErreur('La suppression a échoué. Réessaie dans un instant.');
    }
  }

  async function dupliquerQcm() {
    if (!id) return;
    setDuplication(true);
    setErreur(null);

    const { data: nouveauId, error } = await supabase.rpc('dupliquer_qcm', { p_quiz_id: id });
    if (error || !nouveauId) {
      setErreur('La duplication a échoué. Réessaie dans un instant.');
      setDuplication(false);
      return;
    }

    // Les vidéos/images de la copie pointent volontairement vers les
    // mêmes fichiers R2 que l'original (aucune requête Cloudflare
    // nécessaire à la duplication). Seule l'ajout d'un NOUVEAU média sur
    // la copie créera un fichier indépendant. La suppression est rendue
    // sûre séparément (elle ne supprime un fichier que si plus aucune
    // question, original ou copie, n'en a besoin).
    await logActivity(`a dupliqué le QCM « ${titre} »`, 'quiz', nouveauId);
    setDuplication(false);
    navigate(`/formateur/qcm/${nouveauId}`);
  }

  // Le bouton Publier prend la couleur de la structure des groupes cochés
  // (bandes de couleurs si plusieurs structures).
  const structuresCiblees = Array.from(
    new Map(
      groupes
        .filter((g) => groupesSelectionnes.has(g.id) && g.structure)
        .map((g) => [g.structure!.id, g.structure!])
    ).values()
  );
  const stylePublier = styleBoutonStructures(structuresCiblees);
  // Dès qu'un groupe est coché, tous les éléments verts de cet écran
  // prennent la couleur de sa structure.
  useCouleurStructureEcran(structuresCiblees);

  if (loading) {
    return (
      <AppLayout>
        <p className="text-sm text-muted">Chargement…</p>
      </AppLayout>
    );
  }


  return (
    <AppLayout>
      {popupPublication && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg p-5 max-w-sm w-full text-center">
            <p className="text-lg font-semibold mb-2">QCM publié ✓</p>
            <p className="text-sm text-muted mb-4">
              « {titre} » est maintenant publié. Il sera visible par les arbitres des groupes
              ciblés pendant la période choisie.
            </p>
            <button
              type="button"
              onClick={() => setPopupPublication(false)}
              className="w-full bg-pitch text-white font-medium rounded py-2 text-sm"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {popupGroupeManquant && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg p-5 max-w-sm w-full text-center">
            <p className="text-lg font-semibold mb-2">Aucun groupe sélectionné</p>
            <p className="text-sm text-muted mb-4">
              Sélectionne au moins un groupe destinataire avant de publier ce QCM : sans groupe,
              aucun arbitre ne pourra y accéder.
            </p>
            <button
              type="button"
              onClick={() => setPopupGroupeManquant(false)}
              className="w-full bg-pitch text-white font-medium rounded py-2 text-sm"
            >
              Compris
            </button>
          </div>
        </div>
      )}

      <Link to="/formateur" className="text-sm text-muted underline mb-3 inline-block">
        ← Mes QCM
      </Link>
      {id && <QuizTabs quizId={id} />}
      <h1 className="text-lg font-semibold mb-4">Paramètres du QCM</h1>

      {confirmation && (
        <p className="text-sm text-pitch-dark bg-pitch-light rounded px-3 py-2 mb-4">
          QCM enregistré avec succès.
        </p>
      )}

      {estPublie && (
        <p className="text-sm text-card-yellow bg-card-yellow-bg rounded px-3 py-2 mb-4">
          Ce QCM est publié : ses paramètres et ses questions ne peuvent plus être modifiés.
        </p>
      )}

      <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-3">
        Informations générales
      </label>

      <label className="block text-sm text-muted mb-1">Titre</label>
      <input
        type="text"
        value={titre}
        disabled={estPublie}
        onChange={(e) => setTitre(e.target.value)}
        className="w-full border border-border rounded px-3 py-2 mb-4 disabled:bg-canvas disabled:text-muted"
      />

      <label className="block text-sm text-muted mb-1">Limite de temps (minutes)</label>
      <input
        type="number"
        min={1}
        value={dureeMinutes}
        disabled={estPublie}
        onChange={(e) => setDureeMinutes(Number(e.target.value))}
        className="w-28 border border-border rounded px-3 py-2 mb-2 disabled:bg-canvas disabled:text-muted"
      />

      <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-3 mt-6 pt-4 border-t border-border">
        Période et diffusion
      </label>

      <label className="block text-sm text-muted mb-1">Période d'accessibilité (date et heure)</label>
      <div className="flex flex-col gap-3 mb-4">
        <div>
          <span className="text-xs text-muted">Du</span>
          <input
            type="datetime-local"
            value={dateDebut}
            disabled={estPublie}
            onChange={(e) => setDateDebut(e.target.value)}
            className="w-full border border-border rounded px-3 py-2 disabled:bg-canvas disabled:text-muted"
          />
        </div>
        <div>
          <span className="text-xs text-muted">Au</span>
          <input
            type="datetime-local"
            value={dateFin}
            disabled={estPublie}
            onChange={(e) => setDateFin(e.target.value)}
            className="w-full border border-border rounded px-3 py-2 disabled:bg-canvas disabled:text-muted"
          />
        </div>
      </div>

      <label className="block text-sm text-muted mb-2">Groupes destinataires</label>
      {groupes.length === 0 && (
        <p className="text-xs text-muted mb-2">
          Aucun groupe créé pour l'instant (prochaine étape à construire).
        </p>
      )}
      <div className="flex flex-col gap-1 mb-2">
        {groupes.map((g) => (
          <label key={g.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={groupesSelectionnes.has(g.id)}
              disabled={estPublie}
              onChange={() => basculerGroupe(g.id)}
            />
            {g.name}
            {g.structure && <BadgeStructure structure={g.structure} />}
          </label>
        ))}
      </div>

      <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1 mt-6 pt-4 border-t border-border">
        Ce que voit l'arbitre
      </label>

      <label className="flex items-center gap-2 text-sm mb-1 py-2">
        <input type="checkbox" checked={afficherScore} disabled={estPublie} onChange={(e) => setAfficherScore(e.target.checked)} />
        Afficher le score à l'arbitre
      </label>

      <label className="flex items-center gap-2 text-sm mb-1 py-2 border-t border-border">
        <input
          type="checkbox"
          checked={afficherCorrection}
          disabled={estPublie}
          onChange={(e) => setAfficherCorrection(e.target.checked)}
        />
        Afficher la correction détaillée à l'arbitre à l'issue de la période
      </label>

      <label className="flex items-center gap-2 text-sm mb-4 py-2 border-t border-border">
        <input
          type="checkbox"
          checked={afficherNombreAttendu}
          disabled={estPublie}
          onChange={(e) => setAfficherNombreAttendu(e.target.checked)}
        />
        Afficher à l'arbitre le nombre de réponses attendues (limite alors sa sélection à ce nombre)
      </label>

      <button
        type="button"
        onClick={dupliquerQcm}
        disabled={duplication}
        className="block w-full text-center border border-border rounded py-2 mb-3 text-sm disabled:opacity-60"
      >
        {duplication ? 'Duplication…' : 'Dupliquer ce QCM'}
      </button>

      {erreur && (
        <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-3">
          {erreur}
        </p>
      )}

      {!estPublie && (
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            disabled={enregistrement || !titre || !dateDebut || !dateFin}
            onClick={() => enregistrer('draft')}
            className="flex-1 border border-border rounded py-2 text-sm disabled:opacity-60"
          >
            Enregistrer le brouillon
          </button>
          <button
            type="button"
            disabled={enregistrement || !titre || !dateDebut || !dateFin}
            onClick={demanderPublication}
            className="flex-1 bg-pitch text-white font-medium rounded py-2 text-sm border border-pitch disabled:opacity-60"
            style={stylePublier}
            title={
              structuresCiblees.length > 0
                ? `Structure(s) : ${structuresCiblees.map((s) => s.name).join(', ')}`
                : undefined
            }
          >
            Publier
          </button>
        </div>
      )}

      {!estPublie && (
        <>
          {!confirmationSuppression ? (
            <button
              type="button"
              onClick={() => setConfirmationSuppression(true)}
              className="w-full border border-border rounded py-2 text-sm text-card-red"
            >
              Supprimer ce brouillon
            </button>
          ) : (
            <div className="border border-card-red rounded p-3">
              <p className="text-sm font-medium mb-3">Confirmer la suppression du brouillon ?</p>
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
                  onClick={supprimerBrouillon}
                  disabled={suppression}
                  className="flex-1 bg-card-red text-white rounded py-2 text-sm disabled:opacity-60"
                >
                  {suppression ? 'Suppression…' : 'Supprimer'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}
