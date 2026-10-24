import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AppLayout from '../../components/AppLayout';
import QuizTabs from '../../components/QuizTabs';
import PiocherBanque, { type BanqueInfo } from '../../components/PiocherBanque';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabaseClient';
import { useCouleurStructureEcran, useStructuresQcm } from '../../hooks/useCouleurQcm';
import { useSuspendreDeconnexionInactivite } from '../../lib/inactivite';
import { extraireErreurFonction } from '../../lib/functionsError';
import { avecRetriesTimeout } from '../../lib/retryTimeout';
import { memorisee, memoriser, oublier } from '../../lib/dernierePage';

type QuestionType = 'video' | 'image' | 'text';

interface AnswerOption {
  id: string;
  text: string;
  is_correct: boolean;
}

interface QuestionRow {
  id: string;
  type: QuestionType;
  text: string;
  media_url: string | null;
  explanation: string | null;
  options: AnswerOption[];
}

// Une question en cours d'envoi en arrière-plan (média + enregistrement),
// pendant que le formateur peut déjà passer à la question suivante.
interface EnvoiEnCours {
  id: string;
  type: QuestionType;
  texte: string;
  explication: string;
  options: AnswerOption[];
  fichier: File;
  progression: number;
  statut: 'envoi' | 'enregistrement' | 'erreur';
  erreur?: string;
  ordreIndex: number;
}

// Ce qui est retenu de la question en cours de saisie (nouvelle ou modifiée), pour la retrouver
// exactement là où on l'a laissée après un rechargement ou un changement de page.
interface Brouillon {
  type: QuestionType;
  texte: string;
  explication: string;
  options: AnswerOption[];
  editId: string | null;
  haut: number;
}

type Panneau = 'choix' | 'question' | 'banque' | null;

const TYPE_LABELS: Record<QuestionType, string> = {
  video: 'Vidéo',
  image: 'Image',
  text: 'Texte',
};

function nouvelleOption(): AnswerOption {
  return { id: crypto.randomUUID(), text: '', is_correct: false };
}

// Une carte de question déplaçable par sa poignée « burger » (souris, doigt ou clavier).
function LigneTriable({
  id,
  className,
  actif,
  etiquette,
  enfant,
}: {
  id: string;
  className: string;
  actif: boolean;
  etiquette: string;
  enfant: (poignee: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !actif,
  });
  const poignee = actif ? (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={etiquette}
      {...attributes}
      {...listeners}
      className="touch-none shrink-0 -ml-1 p-1.5 text-muted cursor-grab active:cursor-grabbing rounded hover:bg-canvas"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  ) : null;
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.7 : 1,
      }}
      className={className}
    >
      {enfant(poignee)}
    </li>
  );
}

export default function QuizQuestions() {
  const { id: quizId } = useParams();
  // Éléments verts de l'écran aux couleurs de la structure du QCM
  useCouleurStructureEcran(useStructuresQcm(quizId));

  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [statutQcm, setStatutQcm] = useState<'draft' | 'published' | null>(null);
  const { roles, session } = useAuth();
  const userId = session?.user.id;
  const estAdmin = roles.includes('admin');
  const [proposerBanque, setProposerBanque] = useState<string | null>(null); // id de la question modifiée
  const [majBanqueEnCours, setMajBanqueEnCours] = useState(false);
  const [erreurBanque, setErreurBanque] = useState<string | null>(null);
  const [infoBanque, setInfoBanque] = useState<string | null>(null);

  // Fenêtre ouverte (retenue : on la retrouve ouverte après un rechargement)
  const clePanneau = `panneau:${quizId}`;
  const [panneau, setPanneau] = useState<Panneau>(() => {
    const p = userId ? memorisee<Panneau>(clePanneau, userId) : null;
    return p === 'question' || p === 'banque' ? p : null;
  });
  const [banques, setBanques] = useState<BanqueInfo[]>([]);

  useEffect(() => {
    if (!userId) return;
    if (panneau === 'question' || panneau === 'banque') memoriser(clePanneau, userId, panneau);
    else if (panneau === null) oublier(clePanneau);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panneau]);

  useEffect(() => {
    supabase.rpc('banque_liste').then(({ data, error }) => {
      if (!error && data) setBanques(data as BanqueInfo[]);
    });
  }, []);

  async function mettreAJourBanque() {
    if (!proposerBanque) return;
    setMajBanqueEnCours(true);
    setErreurBanque(null);
    const { error } = await supabase.rpc('banque_mettre_a_jour', { p_question: proposerBanque });
    setMajBanqueEnCours(false);
    if (error) {
      setErreurBanque('La mise à jour de la banque a échoué. Réessaie dans un instant.');
      return;
    }
    setProposerBanque(null);
    setInfoBanque('La banque de questions a été mise à jour.');
  }
  const [loading, setLoading] = useState(true);
  const [erreurListe, setErreurListe] = useState<string | null>(null);

  const [questionEnEditionId, setQuestionEnEditionId] = useState<string | null>(null);
  const [type, setType] = useState<QuestionType>('text');
  const [texte, setTexte] = useState('');
  const [explication, setExplication] = useState('');
  const [options, setOptions] = useState<AnswerOption[]>([nouvelleOption(), nouvelleOption()]);
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [mediaKeyExistant, setMediaKeyExistant] = useState<string | null>(null);
  const [chargementApercu, setChargementApercu] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);

  const [envoisEnCours, setEnvoisEnCours] = useState<EnvoiEnCours[]>([]);
  // Un envoi de vidéo peut durer plus de 5 minutes : pas de déconnexion
  // automatique tant qu'il n'est pas terminé.
  useSuspendreDeconnexionInactivite(envoisEnCours.length > 0);
  const [questionsDepliees, setQuestionsDepliees] = useState<Set<string>>(new Set());
  const [mediaUrlsApercu, setMediaUrlsApercu] = useState<Record<string, string>>({});
  const [chargementMediaApercu, setChargementMediaApercu] = useState<string | null>(null);

  async function charger() {
    if (!quizId) return;
    setLoading(true);
    setErreurListe(null);

    const [{ data, error }, { data: quiz }] = await Promise.all([
      supabase.rpc('get_editor_questions', { p_quiz_id: quizId }),
      supabase.from('quizzes').select('status').eq('id', quizId).single(),
    ]);
    setStatutQcm(quiz?.status ?? null);

    if (error) {
      setErreurListe('Impossible de charger les questions. Réessaie dans un instant.');
    } else {
      setQuestions((data ?? []) as unknown as QuestionRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  // Brouillon de la question en cours (nouvelle ou modifiée), gardé dans le navigateur au fil de la
  // saisie : un onglet rechargé ou quitté ne fait plus perdre le texte. Retenu jusqu'à la
  // déconnexion, 24 h au maximum. shortcut: local à l'appareil, sans fichier vidéo/image ;
  // passer à la base si un brouillon multi-appareils est demandé.
  const cleBrouillon = `brouillon:${quizId}`;
  const [brouillonPret, setBrouillonPret] = useState(false);
  const [brouillonRestaure, setBrouillonRestaure] = useState(false);
  const zoneForm = useRef<HTMLDivElement>(null);
  const hautForm = useRef(0);
  const hautFormARestaurer = useRef<number | null>(null);

  useEffect(() => {
    setBrouillonPret(false);
    const b = userId ? memorisee<Brouillon>(cleBrouillon, userId) : null;
    if (b && typeof b.texte === 'string' && Array.isArray(b.options) && b.options.length >= 2) {
      setType(b.type === 'video' || b.type === 'image' ? b.type : 'text');
      setTexte(b.texte);
      setExplication(typeof b.explication === 'string' ? b.explication : '');
      setOptions(
        b.options.map((o: Partial<AnswerOption>) => ({
          id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
          text: String(o.text ?? ''),
          is_correct: !!o.is_correct,
        }))
      );
      setQuestionEnEditionId(typeof b.editId === 'string' ? b.editId : null);
      hautForm.current = typeof b.haut === 'number' ? b.haut : 0;
      hautFormARestaurer.current = hautForm.current;
      setBrouillonRestaure(true);
    }
    setBrouillonPret(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  function sauverBrouillon() {
    if (!brouillonPret || !userId) return;
    const vide = !texte.trim() && !explication.trim() && options.every((o) => !o.text.trim());
    if (vide && !questionEnEditionId) oublier(cleBrouillon);
    else
      memoriser(cleBrouillon, userId, {
        type,
        texte,
        explication,
        options,
        editId: questionEnEditionId,
        haut: hautForm.current,
      } satisfies Brouillon);
  }

  useEffect(() => {
    sauverBrouillon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brouillonPret, questionEnEditionId, type, texte, explication, options]);

  // retour sur la fenêtre de la question : on retrouve la position de défilement
  useEffect(() => {
    if (panneau === 'question' && hautFormARestaurer.current != null && zoneForm.current) {
      zoneForm.current.scrollTop = hautFormARestaurer.current;
      hautFormARestaurer.current = null;
    }
  }, [panneau]);

  // Question en cours de modification retrouvée après un rechargement : on la raccroche à la liste
  // (fichier actuel) ou on l'abandonne si elle n'existe plus.
  useEffect(() => {
    if (loading || !questionEnEditionId) return;
    const q = questions.find((x) => x.id === questionEnEditionId);
    if (!q) {
      reinitialiserFormulaire();
      setPanneau(null);
      return;
    }
    if (mediaKeyExistant === null && type !== 'text' && !fichier && q.media_url && q.type === type) {
      setMediaKeyExistant(q.media_url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, questions, questionEnEditionId]);

  function choisirFichier(f: File | null) {
    setFichier(f);
    setApercu(f ? URL.createObjectURL(f) : null);
  }

  function modifierOption(id: string, champs: Partial<AnswerOption>) {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...champs } : o)));
  }

  function ajouterOption() {
    setOptions((prev) => [...prev, nouvelleOption()]);
  }

  function retirerOption(id: string) {
    setOptions((prev) => (prev.length > 2 ? prev.filter((o) => o.id !== id) : prev));
  }

  function reinitialiserFormulaire() {
    setBrouillonRestaure(false);
    setQuestionEnEditionId(null);
    setType('text');
    setTexte('');
    setExplication('');
    setOptions([nouvelleOption(), nouvelleOption()]);
    setMediaKeyExistant(null);
    choisirFichier(null);
    hautForm.current = 0;
  }

  function ouvrirNouvelle() {
    setErreurForm(null);
    if (questionEnEditionId) reinitialiserFormulaire();
    setPanneau('question');
  }

  // Fermer la fenêtre : une nouvelle question en cours reste en brouillon, une modification est abandonnée.
  function fermerQuestion() {
    if (questionEnEditionId) reinitialiserFormulaire();
    setPanneau(null);
  }

  async function commencerEdition(q: QuestionRow) {
    setErreurForm(null);
    setBrouillonRestaure(false);
    hautForm.current = 0;
    setQuestionEnEditionId(q.id);
    setType(q.type);
    setTexte(q.text);
    setExplication(q.explanation ?? '');
    setOptions(
      q.options.length > 0
        ? q.options.map((o) => ({ id: o.id, text: o.text, is_correct: o.is_correct }))
        : [nouvelleOption(), nouvelleOption()]
    );
    setFichier(null);
    setApercu(null);
    setMediaKeyExistant(q.media_url);
    setPanneau('question');

    if (q.media_url === '__deleted__') {
      setErreurForm(
        'La vidéo/image originale a été supprimée automatiquement (durée de conservation dépassée). Choisis-en une nouvelle pour la remplacer.'
      );
    } else if (q.media_url) {
      setChargementApercu(true);
      const { data, error } = await supabase.functions.invoke('r2-upload-url', {
        body: { action: 'read', key: q.media_url },
      });
      if (error || !data?.readUrl) {
        setErreurForm(await extraireErreurFonction(error, data));
      } else {
        setApercu(data.readUrl);
      }
      setChargementApercu(false);
    }
  }

  // Envoie UN fichier donné vers R2, en rapportant sa progression via le
  // callback fourni. Ne lit plus rien depuis l'état du formulaire : ainsi,
  // le formulaire peut être réutilisé pour une autre question pendant que
  // cet envoi continue en arrière-plan.
  async function televerserMedia(f: File, onProgress: (p: number) => void): Promise<string> {
    const extension = f.name.split('.').pop() ?? 'bin';

    const { data, error } = await supabase.functions.invoke('r2-upload-url', {
      body: { action: 'upload', fileType: f.type, fileExtension: extension, fileSize: f.size },
    });
    if (error || !data?.uploadUrl) {
      throw new Error(await extraireErreurFonction(error, data));
    }

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', data.uploadUrl);
      xhr.setRequestHeader('Content-Type', f.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error("L'envoi du fichier vers le stockage a échoué."));
      };
      xhr.onerror = () => reject(new Error("L'envoi du fichier vers le stockage a échoué."));
      xhr.send(f);
    });

    return data.key as string;
  }

  // Enregistre la question (et ses réponses) en base, en UN SEUL appel
  // au serveur (au lieu de 2 ou 3 séparés), pour réduire le temps total.
  async function enregistrerQuestionEnBase(
    mediaKey: string | null,
    t: QuestionType,
    txt: string,
    expl: string,
    opts: AnswerOption[],
    idExistant: string | null,
    ordreIndex: number
  ) {
    const { error } = await avecRetriesTimeout(() =>
      supabase.rpc('enregistrer_question', {
        p_quiz_id: quizId,
        p_question_id: idExistant,
        p_type: t,
        p_media_url: mediaKey,
        p_text: txt,
        p_explanation: expl || null,
        p_order_index: ordreIndex,
        p_options: opts.map((o) => ({ text: o.text, is_correct: o.is_correct })),
      })
    );
    if (error) {
      throw new Error(
        idExistant ? 'La modification de la question a échoué. Réessaie dans un instant.' : "L'enregistrement de la question a échoué. Réessaie dans un instant."
      );
    }
  }

  // Envoie le média et enregistre la question en tâche de fond, sans
  // bloquer la page (la fenêtre de saisie est déjà fermée).
  async function lancerEnvoiEnArrierePlan(job: EnvoiEnCours) {
    try {
      const mediaKey = await televerserMedia(job.fichier, (p) => {
        setEnvoisEnCours((prev) => prev.map((j) => (j.id === job.id ? { ...j, progression: p } : j)));
      });
      setEnvoisEnCours((prev) => prev.map((j) => (j.id === job.id ? { ...j, statut: 'enregistrement' } : j)));
      await enregistrerQuestionEnBase(mediaKey, job.type, job.texte, job.explication, job.options, null, job.ordreIndex);
      setEnvoisEnCours((prev) => prev.filter((j) => j.id !== job.id));
      await charger();
    } catch (err) {
      setEnvoisEnCours((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? { ...j, statut: 'erreur', erreur: err instanceof Error ? err.message : 'Une erreur est survenue.' }
            : j
        )
      );
    }
  }

  function retirerEnvoiEnErreur(jobId: string) {
    setEnvoisEnCours((prev) => prev.filter((j) => j.id !== jobId));
  }

  async function afficherMediaApercu(q: QuestionRow) {
    if (!q.media_url || q.media_url === '__deleted__' || mediaUrlsApercu[q.id]) return;
    setChargementMediaApercu(q.id);
    const { data } = await supabase.functions.invoke('r2-upload-url', {
      body: { action: 'read', key: q.media_url },
    });
    if (data?.readUrl) {
      setMediaUrlsApercu((prev) => ({ ...prev, [q.id]: data.readUrl }));
    }
    setChargementMediaApercu(null);
  }

  async function enregistrerQuestion(e: FormEvent) {
    e.preventDefault();
    setErreurForm(null);
    setInfoBanque(null);

    if (!quizId) return;
    if (type !== 'text' && !fichier && !mediaKeyExistant) {
      setErreurForm('Ajoute un fichier avant d’enregistrer.');
      return;
    }
    const optionsRemplies = options.filter((o) => o.text.trim() !== '');
    if (optionsRemplies.length < 2) {
      setErreurForm('Ajoute au moins deux propositions de réponse.');
      return;
    }
    if (!optionsRemplies.some((o) => o.is_correct)) {
      setErreurForm('Coche au moins une bonne réponse.');
      return;
    }

    // Modification d'une question existante : on garde un enregistrement
    // classique (immédiat), plus simple pour ce cas moins fréquent.
    if (questionEnEditionId) {
      setEnregistrement(true);
      try {
        let mediaKey: string | null = type === 'text' ? null : mediaKeyExistant;
        if (fichier) {
          mediaKey = await televerserMedia(fichier, () => {});
        }
        const questionModifiee = questionEnEditionId;
        await enregistrerQuestionEnBase(mediaKey, type, texte, explication, optionsRemplies, questionModifiee, 0);
        reinitialiserFormulaire();
        setPanneau(null);
        await charger();
        // Administrateur : si la question vient de la banque et diffère d'elle, on propose de mettre la banque à jour.
        if (estAdmin) {
          const { data: differe } = await supabase.rpc('banque_difference', { p_question: questionModifiee });
          if (differe === true) {
            setErreurBanque(null);
            setProposerBanque(questionModifiee);
          }
        }
      } catch (err) {
        setErreurForm(err instanceof Error ? err.message : 'Une erreur est survenue.');
      } finally {
        setEnregistrement(false);
      }
      return;
    }

    // Nouvelle question avec un fichier : envoi en arrière-plan, la
    // fenêtre se ferme immédiatement.
    if (fichier) {
      const job: EnvoiEnCours = {
        id: crypto.randomUUID(),
        type,
        texte,
        explication,
        options: optionsRemplies,
        fichier,
        progression: 0,
        statut: 'envoi',
        ordreIndex: questions.length + envoisEnCours.length,
      };
      setEnvoisEnCours((prev) => [...prev, job]);
      reinitialiserFormulaire();
      setPanneau(null);
      lancerEnvoiEnArrierePlan(job);
      return;
    }

    // Nouvelle question texte, sans média : rapide, reste immédiat.
    setEnregistrement(true);
    try {
      await enregistrerQuestionEnBase(null, type, texte, explication, optionsRemplies, null, questions.length + envoisEnCours.length);
      reinitialiserFormulaire();
      setPanneau(null);
      await charger();
    } catch (err) {
      setErreurForm(err instanceof Error ? err.message : 'Une erreur est survenue.');
    } finally {
      setEnregistrement(false);
    }
  }

  async function supprimerQuestion(questionId: string) {
    await supabase.from('questions').delete().eq('id', questionId);
    if (questionEnEditionId === questionId) reinitialiserFormulaire();
    await charger();
  }

  // Glisser-déposer : souris, doigt (poignée « burger ») ou clavier.
  const capteurs = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function apresDeplacement(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id || !quizId) return;
    const ancien = questions.findIndex((q) => q.id === active.id);
    const nouveau = questions.findIndex((q) => q.id === over.id);
    if (ancien < 0 || nouveau < 0) return;
    const suite = arrayMove(questions, ancien, nouveau);
    setQuestions(suite);
    const { error } = await supabase.rpc('reordonner_questions', { p_quiz: quizId, p_ordre: suite.map((q) => q.id) });
    if (error) {
      setErreurListe('Le nouvel ordre n’a pas pu être enregistré. Réessaie dans un instant.');
      await charger();
    }
  }

  const brouillonOuvert = statutQcm !== 'published';

  return (
    <AppLayout>
      {quizId && <QuizTabs quizId={quizId} />}
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-lg font-semibold">Questions</h1>
        {brouillonOuvert && (
          <button
            type="button"
            onClick={() => setPanneau('choix')}
            className="shrink-0 bg-pitch text-white text-sm font-semibold rounded-xl px-3 py-2"
          >
            + Ajouter une question
          </button>
        )}
      </div>

      {infoBanque && <p className="text-sm text-pitch mb-4">{infoBanque}</p>}
      {loading && <p className="text-sm text-muted">Chargement…</p>}
      {erreurListe && <p className="text-sm text-card-red mb-4">{erreurListe}</p>}

      {envoisEnCours.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          {envoisEnCours.map((j) => (
            <div key={j.id} className="bg-surface border border-border rounded p-3">
              <p className="text-sm font-medium mb-1 truncate">{j.texte || '(sans texte)'}</p>
              {j.statut === 'erreur' ? (
                <>
                  <p className="text-xs text-card-red mb-2">{j.erreur}</p>
                  <button
                    type="button"
                    onClick={() => retirerEnvoiEnErreur(j.id)}
                    className="text-xs border border-border rounded px-2 py-1"
                  >
                    Ignorer
                  </button>
                </>
              ) : (
                <>
                  <div className="h-1.5 bg-canvas rounded overflow-hidden">
                    <div className="h-full bg-pitch transition-all" style={{ width: `${j.progression}%` }} />
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {j.statut === 'envoi' ? `Envoi en cours… ${j.progression}%` : 'Enregistrement…'}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && questions.length === 0 && brouillonOuvert && (
        <p className="text-sm text-muted mb-6">Aucune question pour le moment. Utilise « Ajouter une question » en haut à droite.</p>
      )}

      {!loading && questions.length > 0 && (
        <>
          <button
            type="button"
            onClick={() =>
              setQuestionsDepliees((prev) =>
                prev.size === questions.length ? new Set() : new Set(questions.map((q) => q.id))
              )
            }
            className="text-xs text-muted underline mb-2"
          >
            {questionsDepliees.size === questions.length ? 'Tout replier' : 'Tout déplier'}
          </button>

          <DndContext sensors={capteurs} collisionDetection={closestCenter} onDragEnd={apresDeplacement}>
            <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-2 mb-6">
                {questions.map((q, i) => (
                  <LigneTriable
                    key={q.id}
                    id={q.id}
                    actif={brouillonOuvert}
                    etiquette={`Déplacer la question ${i + 1}`}
                    className={
                      'bg-surface border rounded p-3 ' + (questionEnEditionId === q.id ? 'border-pitch' : 'border-border')
                    }
                    enfant={(poignee) => (
                      <div className="flex items-start gap-2">
                        {poignee}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs text-muted mb-1">
                                Question {i + 1} · {TYPE_LABELS[q.type]}
                              </p>
                              <p className="text-sm font-medium">{q.text}</p>
                              <p className="text-xs text-muted mt-1">
                                {q.options.filter((o) => o.is_correct).length} bonne(s) réponse(s) sur {q.options.length}
                              </p>
                            </div>
                            {brouillonOuvert && (
                              <div className="flex gap-3 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => commencerEdition(q)}
                                  className="text-xs text-pitch font-medium"
                                >
                                  Modifier
                                </button>
                                <button
                                  type="button"
                                  onClick={() => supprimerQuestion(q.id)}
                                  className="text-xs text-card-red"
                                >
                                  Supprimer
                                </button>
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setQuestionsDepliees((prev) => {
                                const suivant = new Set(prev);
                                suivant.has(q.id) ? suivant.delete(q.id) : suivant.add(q.id);
                                return suivant;
                              })
                            }
                            className="text-xs text-muted underline mt-2"
                          >
                            {questionsDepliees.has(q.id) ? 'Masquer les réponses' : 'Voir les réponses'}
                          </button>

                          {questionsDepliees.has(q.id) && (
                            <div className="mt-2 pt-2 border-t border-border">
                              {q.type !== 'text' && q.media_url && q.media_url !== '__deleted__' && (
                                <div className="mb-2">
                                  {mediaUrlsApercu[q.id] ? (
                                    q.type === 'video' ? (
                                      <video src={mediaUrlsApercu[q.id]} controls className="w-full rounded max-h-40" />
                                    ) : (
                                      <img src={mediaUrlsApercu[q.id]} alt="" className="w-full rounded max-h-40 object-contain" />
                                    )
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => afficherMediaApercu(q)}
                                      disabled={chargementMediaApercu === q.id}
                                      className="text-xs border border-border rounded px-3 py-1.5"
                                    >
                                      {chargementMediaApercu === q.id
                                        ? 'Chargement…'
                                        : q.type === 'video'
                                          ? 'Revoir la vidéo'
                                          : "Revoir l'image"}
                                    </button>
                                  )}
                                </div>
                              )}
                              <div className="flex flex-col gap-1.5">
                                {q.options.map((o) => (
                                  <div
                                    key={o.id}
                                    className={
                                      'flex items-center gap-2 border rounded px-3 py-2 text-sm ' +
                                      (o.is_correct ? 'border-pitch bg-pitch-light' : 'border-border')
                                    }
                                  >
                                    <input type="checkbox" checked={o.is_correct} disabled readOnly />
                                    <span className="flex-1">{o.text}</span>
                                  </div>
                                ))}
                              </div>
                              {q.explanation && <p className="text-xs text-muted mt-2">Explication : {q.explanation}</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}

      {statutQcm === 'published' && (
        <p className="text-sm text-card-yellow bg-card-yellow-bg rounded px-3 py-2">
          Ce QCM est publié : les questions ne peuvent plus être modifiées.
        </p>
      )}

      {/* Choix : écrire une question ou piocher dans la banque */}
      {panneau === 'choix' && brouillonOuvert && (
        <div className="fixed inset-0 z-50 bg-ink/45 flex items-center justify-center p-4" onClick={() => setPanneau(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titre-choix"
            className="bg-surface rounded-2xl shadow-carte-haute w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="titre-choix" className="font-bold mb-3">
              Ajouter une question
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                autoFocus
                onClick={ouvrirNouvelle}
                className="bg-pitch text-white rounded-xl py-2.5 text-sm font-semibold"
              >
                Écrire une question
              </button>
              {banques.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPanneau('banque')}
                  className="bg-canvas rounded-xl py-2.5 text-sm font-semibold"
                >
                  Piocher dans la banque de questions
                </button>
              )}
              <button type="button" onClick={() => setPanneau(null)} className="text-sm text-muted underline mt-1">
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Piocher dans la banque */}
      {quizId && brouillonOuvert && (
        <PiocherBanque
          quizId={quizId}
          banques={banques}
          ouvert={panneau === 'banque'}
          onFermer={() => setPanneau(null)}
          onAjoute={charger}
        />
      )}

      {/* Saisie d'une question (nouvelle ou modifiée) */}
      {panneau === 'question' && brouillonOuvert && (
        <div className="fixed inset-0 z-50 bg-ink/45 flex items-end sm:items-center justify-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titre-question"
            className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-carte-haute w-full max-w-2xl max-h-[92vh] flex flex-col"
          >
            <div className="p-4 border-b border-border flex items-center justify-between gap-3">
              <p id="titre-question" className="font-bold">
                {questionEnEditionId ? 'Modifier la question' : 'Nouvelle question'}
              </p>
              <button type="button" onClick={fermerQuestion} className="text-sm text-muted underline">
                {questionEnEditionId ? 'Annuler' : 'Fermer'}
              </button>
            </div>

            <form onSubmit={enregistrerQuestion} className="flex flex-col min-h-0 flex-1">
              <div
                ref={zoneForm}
                className="p-4 overflow-y-auto flex-1"
                onScroll={(e) => {
                  hautForm.current = e.currentTarget.scrollTop;
                  sauverBrouillon();
                }}
              >
                {brouillonRestaure && (
                  <p className="text-xs text-muted bg-canvas rounded-lg px-3 py-2 mb-3">
                    {questionEnEditionId
                      ? 'Modifications retrouvées : tu reprends là où tu t’étais arrêté. Si tu avais choisi une nouvelle vidéo ou image, choisis-la de nouveau.'
                      : 'Brouillon retrouvé : ta question en cours a été restaurée. Si elle contenait une vidéo ou une image, choisis-la de nouveau.'}
                  </p>
                )}

                <div className="flex gap-2 mb-4">
                  {(['video', 'image', 'text'] as QuestionType[]).map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => {
                        setType(t);
                        choisirFichier(null);
                        setMediaKeyExistant(null);
                      }}
                      className={
                        'flex-1 text-sm rounded py-1.5 border ' +
                        (type === t ? 'bg-pitch text-white border-pitch' : 'border-border text-muted')
                      }
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>

                {type !== 'text' && (
                  <div className="mb-4">
                    <label className="block text-sm text-muted mb-1">
                      {type === 'video' ? 'Vidéo' : 'Image'}
                      {mediaKeyExistant && !fichier && ' (fichier actuel conservé si tu n’en choisis pas un nouveau)'}
                    </label>
                    <input
                      type="file"
                      accept={type === 'video' ? 'video/*' : 'image/*'}
                      onChange={(e) => choisirFichier(e.target.files?.[0] ?? null)}
                      className="w-full text-sm"
                    />
                    {chargementApercu && <p className="text-xs text-muted mt-2">Chargement de l’aperçu…</p>}
                    {apercu && type === 'image' && <img src={apercu} alt="Aperçu" className="mt-2 rounded max-h-40" />}
                    {apercu && type === 'video' && <video src={apercu} controls className="mt-2 rounded max-h-40 w-full" />}
                    {fichier && !questionEnEditionId && (
                      <p className="text-xs text-muted mt-2">
                        L'envoi se fera en arrière-plan : la fenêtre se fermera dès l'enregistrement et la progression s'affichera sur la page.
                      </p>
                    )}
                  </div>
                )}

                <label className="block text-sm text-muted mb-1">Question</label>
                <textarea
                  required
                  value={texte}
                  onChange={(e) => setTexte(e.target.value)}
                  className="w-full border border-border rounded px-3 py-2 mb-4 min-h-[3rem]"
                />

                <label className="block text-sm text-muted mb-2">Réponses — coche la ou les bonnes</label>
                <div className="flex flex-col gap-2 mb-2">
                  {options.map((o) => (
                    <div key={o.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={o.is_correct}
                        onChange={(e) => modifierOption(o.id, { is_correct: e.target.checked })}
                      />
                      <input
                        type="text"
                        value={o.text}
                        onChange={(e) => modifierOption(o.id, { text: e.target.value })}
                        className="flex-1 border border-border rounded px-3 py-1.5 text-sm"
                      />
                      <button type="button" onClick={() => retirerOption(o.id)} className="text-xs text-muted">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={ajouterOption} className="text-sm text-muted mb-4">
                  + Ajouter une réponse
                </button>

                <p className="text-xs text-muted mb-1">
                  L'arbitre pourra cocher autant de cases que de bonnes réponses cochées ci-dessus.
                </p>

                <label className="block text-sm text-muted mb-1 mt-3">Explication (optionnelle)</label>
                <textarea
                  value={explication}
                  onChange={(e) => setExplication(e.target.value)}
                  className="w-full border border-border rounded px-3 py-2 mb-2 min-h-[2.5rem]"
                />
              </div>

              <div className="p-4 border-t border-border">
                {erreurForm && (
                  <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-3">
                    {erreurForm}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={enregistrement}
                  className="w-full bg-pitch text-white font-medium rounded py-2 disabled:opacity-60"
                >
                  {enregistrement
                    ? 'Enregistrement…'
                    : questionEnEditionId
                      ? 'Enregistrer les modifications'
                      : 'Enregistrer la question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {proposerBanque && (
        <div className="fixed inset-0 z-50 bg-ink/45 flex items-center justify-center p-4" onClick={() => !majBanqueEnCours && setProposerBanque(null)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="titre-maj-banque"
            className="bg-surface rounded-2xl shadow-carte-haute w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="titre-maj-banque" className="font-bold mb-1">
              Mettre à jour la banque ?
            </p>
            <p className="text-sm text-muted mb-4">
              Cette question vient de la banque de questions et tu l’as modifiée. Veux-tu appliquer ces modifications
              (énoncé, réponses, explication) à la banque ? Les autres QCM déjà créés ne changent pas.
            </p>
            {erreurBanque && <p className="text-sm text-card-red mb-3">{erreurBanque}</p>}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={mettreAJourBanque}
                disabled={majBanqueEnCours}
                className="bg-pitch text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
              >
                {majBanqueEnCours ? 'Patiente…' : 'Oui, mettre à jour la banque'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setProposerBanque(null)}
                disabled={majBanqueEnCours}
                className="bg-canvas rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
              >
                Non, garder dans ce QCM seulement
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
