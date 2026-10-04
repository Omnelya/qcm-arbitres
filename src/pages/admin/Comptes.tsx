import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import AppLayout from '../../components/AppLayout';
import AdminNav from '../../components/AdminNav';
import { supabase } from '../../lib/supabaseClient';
import { extraireErreurFonction } from '../../lib/functionsError';
import { logActivity } from '../../lib/activityLog';
import { motDePasseValide, MESSAGE_REGLES_MOT_DE_PASSE } from '../../lib/motDePasse';
import ReglesMotDePasse from '../../components/ReglesMotDePasse';
import type { AppRole } from '../../hooks/useAuth';

interface PersonneAvecRoles {
  id: string;
  full_name: string;
  email: string;
  // Date d'ajout du compte
  created_at: string;
  roles: AppRole[];
  // Identifiants des structures auxquelles la personne appartient
  structures: string[];
  // undefined = information indisponible ; null = jamais connecté
  derniereConnexion?: string | null;
}

function texteDerniereConnexion(d: string | null): string {
  if (!d) return 'Jamais connecté';
  const date = new Date(d);
  const jour = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const heure = date
    .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    .replace(':', 'h');
  return `Dernière connexion : ${jour} à ${heure}`;
}

interface LigneImport {
  full_name: string;
  email: string;
  roles: AppRole[];
  // Identifiants des structures à attribuer à la création du compte
  structures: string[];
}

interface StructureRow {
  id: string;
  name: string;
}

interface InviteQueueRow {
  id: string;
  full_name: string;
  email: string;
  roles: AppRole[];
  status: 'en_attente' | 'en_cours' | 'envoye' | 'echec';
  created_at: string;
  sent_at: string | null;
  erreur: string | null;
}

const TOUS_LES_ROLES: AppRole[] = ['admin', 'formateur', 'arbitre'];

const LIBELLES_TRI = {
  'nom-az': 'Nom (A → Z)',
  'nom-za': 'Nom (Z → A)',
  'connexion-recente': 'Dernière connexion (la plus récente d\'abord)',
  'connexion-ancienne': 'Dernière connexion (la plus ancienne d\'abord)',
  'jamais-connecte': 'Jamais connectés d\'abord',
  'ajout-recent': 'Date d\'ajout (les plus récents d\'abord)',
  'ajout-ancien': 'Date d\'ajout (les plus anciens d\'abord)',
  role: 'Rôle (administrateur, formateur, arbitre)',
  structure: 'Structure (A → Z)',
} as const;
type Tri = keyof typeof LIBELLES_TRI;

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
const LABELS: Record<AppRole, string> = {
  admin: 'Administrateur',
  formateur: 'Formateur',
  arbitre: 'Arbitre',
};
const STATUT_FILE: Record<InviteQueueRow['status'], { label: string; className: string }> = {
  en_attente: { label: 'En attente', className: 'bg-card-yellow-bg text-card-yellow' },
  en_cours: { label: 'Envoi en cours…', className: 'bg-card-yellow-bg text-card-yellow' },
  envoye: { label: 'Envoyée', className: 'bg-pitch-light text-pitch-dark' },
  echec: { label: 'Échec', className: 'bg-card-red-bg text-card-red' },
};

function formatDateHeure(d: string) {
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Comptes() {
  const [personnes, setPersonnes] = useState<PersonneAvecRoles[]>([]);
  const [recherche, setRecherche] = useState('');
  // --- Structures ---
  // structuresDisponibles = false tant que la mise à jour SQL des
  // structures n'a pas été exécutée dans Supabase : la page fonctionne
  // alors comme avant, sans rien afficher sur les structures.
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [structuresDisponibles, setStructuresDisponibles] = useState(false);
  const [filtreStructure, setFiltreStructure] = useState('toutes');
  const [filtreRole, setFiltreRole] = useState<'tous' | 'aucun' | AppRole>('tous');
  // Le tri choisi est mémorisé dans le navigateur d'une visite à l'autre.
  const [tri, setTri] = useState<Tri>(() => {
    try {
      const memorise = localStorage.getItem('qcm-comptes-tri');
      return memorise && memorise in LIBELLES_TRI ? (memorise as Tri) : 'nom-az';
    } catch {
      return 'nom-az';
    }
  });
  const [structuresCreation, setStructuresCreation] = useState<string[]>([]);
  const [erreurStructure, setErreurStructure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [nomEdite, setNomEdite] = useState('');
  const [enregistrementNom, setEnregistrementNom] = useState(false);
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState('');
  const [enregistrementMdp, setEnregistrementMdp] = useState(false);
  const [erreurMdp, setErreurMdp] = useState<string | null>(null);
  const [succesMdp, setSuccesMdp] = useState(false);
  const [confirmationSuppression, setConfirmationSuppression] = useState<string | null>(null);
  const [avertissementSuppression, setAvertissementSuppression] = useState<string | null>(null);
  const [suppression, setSuppression] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);
  const [genererLienEnCours, setGenererLienEnCours] = useState(false);
  const [lienActivationPanneau, setLienActivationPanneau] = useState<string | null>(null);
  const [erreurLienPanneau, setErreurLienPanneau] = useState<string | null>(null);
  const [lienPanneauCopie, setLienPanneauCopie] = useState(false);
  const [renvoiEmailEnCours, setRenvoiEmailEnCours] = useState(false);
  const [renvoiEmailConfirmation, setRenvoiEmailConfirmation] = useState<string | null>(null);
  const [erreurRenvoiEmail, setErreurRenvoiEmail] = useState<string | null>(null);

  // --- Création d'un compte (un par un) ---
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [nomComplet, setNomComplet] = useState('');
  const [email, setEmail] = useState('');
  const [rolesCreation, setRolesCreation] = useState<AppRole[]>([]);
  const [methodeCreation, setMethodeCreation] = useState<'email' | 'lien'>('email');
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [lienGenere, setLienGenere] = useState<string | null>(null);
  const [lienEstRenvoi, setLienEstRenvoi] = useState(false);
  const [lienCopie, setLienCopie] = useState(false);

  // --- Import Excel (plusieurs comptes d'un coup) ---
  const [importOuvert, setImportOuvert] = useState(false);
  const [apercuImport, setApercuImport] = useState<LigneImport[] | null>(null);
  const [erreursImport, setErreursImport] = useState<string[]>([]);
  const [important, setImportant] = useState(false);
  const [messageImport, setMessageImport] = useState<string | null>(null);

  // --- File d'attente des invitations ---
  const [fileAttente, setFileAttente] = useState<InviteQueueRow[]>([]);
  const [chargementFile, setChargementFile] = useState(true);
  const [annulationId, setAnnulationId] = useState<string | null>(null);
  const [fileAttenteOuverte, setFileAttenteOuverte] = useState(true);
  const [rechercheFile, setRechercheFile] = useState('');
  const [filtreStatutFile, setFiltreStatutFile] = useState<'tous' | InviteQueueRow['status']>('tous');

  async function charger() {
    setLoading(true);
    setError(null);

    const [
      { data: profils, error: err1 },
      { data: roleRows, error: err2 },
      { data: connexions },
      { data: structuresData, error: errStructures },
      { data: affectations },
    ] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, created_at').order('full_name'),
      supabase.from('user_roles').select('user_id, role'),
      supabase.rpc('admin_dernieres_connexions'),
      supabase.from('structures').select('id, name').order('name'),
      supabase.from('user_structures').select('user_id, structure_id'),
    ]);
    setStructuresDisponibles(!errStructures);
    setStructures(structuresData ?? []);
    // Si la fonction n'est pas disponible, on affiche simplement la liste
    // sans les dates de connexion plutôt que de bloquer la page.
    const connexionsParId: Record<string, string | null> = Object.fromEntries(
      ((connexions ?? []) as { user_id: string; last_sign_in_at: string | null }[]).map((c) => [
        c.user_id,
        c.last_sign_in_at,
      ])
    );
    const connexionsDisponibles = Array.isArray(connexions);

    if (err1 || err2) {
      setError('Impossible de charger la liste des comptes. Réessaie dans un instant.');
      setLoading(false);
      return;
    }

    const liste: PersonneAvecRoles[] = (profils ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      created_at: p.created_at,
      roles: (roleRows ?? [])
        .filter((r) => r.user_id === p.id)
        .map((r) => r.role as AppRole),
      structures: (affectations ?? []).filter((a) => a.user_id === p.id).map((a) => a.structure_id),
      derniereConnexion: connexionsDisponibles ? (connexionsParId[p.id] ?? null) : undefined,
    }));
    setPersonnes(liste);
    setLoading(false);
  }

  async function chargerFileAttente() {
    setChargementFile(true);
    const { data } = await supabase
      .from('invite_queue')
      .select('id, full_name, email, roles, status, created_at, sent_at, erreur')
      .order('created_at', { ascending: true });
    setFileAttente((data ?? []) as InviteQueueRow[]);
    setChargementFile(false);
  }

  useEffect(() => {
    charger();
    chargerFileAttente();
  }, []);

  // Fiche ouverte : la touche Échap la ferme, et la liste derrière ne
  // défile plus tant qu'elle est affichée.
  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(null);
    };
    document.addEventListener('keydown', surTouche);
    const defilementAvant = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', surTouche);
      document.body.style.overflow = defilementAvant;
    };
  }, [ouvert]);

  async function basculerRole(personneId: string, role: AppRole, actif: boolean) {
    setEnregistrement(true);
    if (actif) {
      await supabase.from('user_roles').delete().eq('user_id', personneId).eq('role', role);
    } else {
      await supabase.from('user_roles').insert({ user_id: personneId, role });
    }
    await charger();
    setEnregistrement(false);
  }

  async function basculerStructure(p: PersonneAvecRoles, structure: StructureRow, actif: boolean) {
    setEnregistrement(true);
    setErreurStructure(null);
    const { error: err } = actif
      ? await supabase.from('user_structures').delete().eq('user_id', p.id).eq('structure_id', structure.id)
      : await supabase.from('user_structures').insert({ user_id: p.id, structure_id: structure.id });
    if (err) {
      setErreurStructure("La modification de la structure a échoué. Réessaie dans un instant.");
    } else {
      await logActivity(
        actif
          ? `a retiré ${p.full_name} de la structure « ${structure.name} »`
          : `a ajouté ${p.full_name} à la structure « ${structure.name} »`,
        'profile',
        p.id
      );
    }
    await charger();
    setEnregistrement(false);
  }

  function nomStructure(id: string) {
    return structures.find((s) => s.id === id)?.name ?? '—';
  }

  // Les invitations sont envoyées en différé : le compte n'existe pas
  // encore au moment où l'admin choisit les structures. On les enregistre
  // donc "en attente" pour chaque e-mail ; la base de données les applique
  // automatiquement dès que le compte est créé.
  async function enregistrerStructuresEnAttente(lignes: { email: string; structures: string[] }[]) {
    if (!structuresDisponibles || lignes.length === 0) return;
    const emails = lignes.map((l) => l.email.trim().toLowerCase());
    await supabase.from('structures_en_attente').delete().in('email', emails);
    const aInserer = lignes.flatMap((l) =>
      l.structures.map((structure_id) => ({ email: l.email.trim().toLowerCase(), structure_id }))
    );
    if (aInserer.length > 0) {
      await supabase.from('structures_en_attente').insert(aInserer);
    }
  }

  async function annulerStructuresEnAttente(emails: string[]) {
    if (!structuresDisponibles || emails.length === 0) return;
    await supabase
      .from('structures_en_attente')
      .delete()
      .in('email', emails.map((e) => e.trim().toLowerCase()));
  }

  function ouvrirPanneau(p: PersonneAvecRoles) {
    setOuvert(p.id);
    setNomEdite(p.full_name);
    setNouveauMotDePasse('');
    setErreurMdp(null);
    setSuccesMdp(false);
    setConfirmationSuppression(null);
    setAvertissementSuppression(null);
    setErreurSuppression(null);
    setErreurStructure(null);
    setLienActivationPanneau(null);
    setErreurLienPanneau(null);
    setLienPanneauCopie(false);
    setRenvoiEmailConfirmation(null);
    setErreurRenvoiEmail(null);
  }

  async function enregistrerNom(personneId: string) {
    setEnregistrementNom(true);
    const { error } = await supabase.from('profiles').update({ full_name: nomEdite }).eq('id', personneId);
    setEnregistrementNom(false);
    if (!error) {
      await logActivity(`a modifié le nom de ${nomEdite}`, 'profile', personneId);
      await charger();
    }
  }

  async function reinitialiserMotDePasse(personneId: string, nomPersonne: string) {
    setErreurMdp(null);
    setSuccesMdp(false);
    if (!motDePasseValide(nouveauMotDePasse)) {
      setErreurMdp(MESSAGE_REGLES_MOT_DE_PASSE);
      return;
    }
    setEnregistrementMdp(true);
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: { action: 'update-password', userId: personneId, password: nouveauMotDePasse },
    });
    setEnregistrementMdp(false);

    if (error || data?.error) {
      setErreurMdp(await extraireErreurFonction(error, data));
      return;
    }
    setNouveauMotDePasse('');
    setSuccesMdp(true);
    await logActivity(`a réinitialisé le mot de passe de ${nomPersonne}`, 'profile', personneId);
  }

  async function genererLienActivationPanneau(p: PersonneAvecRoles) {
    setErreurLienPanneau(null);
    setLienActivationPanneau(null);
    setLienPanneauCopie(false);

    if (p.roles.length === 0) {
      setErreurLienPanneau('Attribue au moins un rôle avant de générer un lien.');
      return;
    }

    setGenererLienEnCours(true);
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: { action: 'generate-invite-link', email: p.email, full_name: p.full_name, roles: p.roles },
    });
    setGenererLienEnCours(false);

    if (error || data?.error) {
      setErreurLienPanneau(await extraireErreurFonction(error, data));
      return;
    }
    setLienActivationPanneau(data.link);
    await logActivity(`a généré un nouveau lien d'activation pour ${p.full_name}`, 'profile', p.id);
  }

  async function copierLienPanneau() {
    if (!lienActivationPanneau) return;
    await navigator.clipboard.writeText(lienActivationPanneau);
    setLienPanneauCopie(true);
  }

  async function renvoyerLienParEmail(p: PersonneAvecRoles) {
    setErreurRenvoiEmail(null);
    setRenvoiEmailConfirmation(null);

    if (p.roles.length === 0) {
      setErreurRenvoiEmail('Attribue au moins un rôle avant de renvoyer un lien.');
      return;
    }

    setRenvoiEmailEnCours(true);
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: {
        action: 'generate-invite-link',
        email: p.email,
        full_name: p.full_name,
        roles: p.roles,
        envoyerParEmail: true,
      },
    });
    setRenvoiEmailEnCours(false);

    if (error || data?.error) {
      setErreurRenvoiEmail(await extraireErreurFonction(error, data));
      return;
    }
    if (!data.envoye) {
      setErreurRenvoiEmail(
        data.erreurEnvoi ?? "L'envoi a échoué. Utilise plutôt « Générer un nouveau lien d'activation » pour le copier toi-même."
      );
      return;
    }
    setRenvoiEmailConfirmation(`Lien renvoyé par e-mail à ${p.email}.`);
    await logActivity(`a renvoyé le lien d'activation par e-mail à ${p.full_name}`, 'profile', p.id);
  }

  async function demanderConfirmationSuppression(p: PersonneAvecRoles) {
    setErreurSuppression(null);
    setAvertissementSuppression(null);

    if (p.roles.includes('formateur')) {
      const { count } = await supabase
        .from('quizzes')
        .select('id', { count: 'exact', head: true })
        .eq('formateur_id', p.id);
      if (count && count > 0) {
        setAvertissementSuppression(
          `Ce formateur a créé ${count} QCM. Les supprimer entraînera la perte définitive de leurs questions et de toutes les réponses des arbitres qui y ont déjà répondu.`
        );
      }
    }
    setConfirmationSuppression(p.id);
  }

  async function supprimerCompte(personneId: string, nomPersonne: string) {
    setSuppression(true);
    setErreurSuppression(null);
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: { action: 'delete', userId: personneId },
    });
    setSuppression(false);

    if (error || data?.error) {
      setErreurSuppression(await extraireErreurFonction(error, data));
      return;
    }
    setConfirmationSuppression(null);
    setOuvert(null);
    await logActivity(`a supprimé le compte de ${nomPersonne}`, 'profile', personneId);
    await charger();
  }

  function basculerRoleCreation(role: AppRole) {
    setRolesCreation((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  function basculerStructureCreation(id: string) {
    setStructuresCreation((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function reinitialiserFormulaireCreation() {
    setNomComplet('');
    setEmail('');
    setRolesCreation([]);
    setStructuresCreation([]);
    setMethodeCreation('email');
    setConfirmationEmail(null);
    setLienGenere(null);
    setLienEstRenvoi(false);
    setLienCopie(false);
  }

  async function creerCompte(e: FormEvent) {
    e.preventDefault();
    setErreurCreation(null);
    setConfirmationEmail(null);
    setLienGenere(null);

    if (rolesCreation.length === 0) {
      setErreurCreation('Sélectionne au moins un rôle.');
      return;
    }

    setCreation(true);
    await enregistrerStructuresEnAttente([{ email, structures: structuresCreation }]);

    if (methodeCreation === 'lien') {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { action: 'generate-invite-link', email, full_name: nomComplet, roles: rolesCreation },
      });
      setCreation(false);

      if (error || data?.error) {
        await annulerStructuresEnAttente([email]);
        setErreurCreation(await extraireErreurFonction(error, data));
        return;
      }
      // Compte déjà existant : ses structures se gèrent depuis sa fiche.
      if (data.renvoi) await annulerStructuresEnAttente([email]);
      setLienGenere(data.link);
      setLienEstRenvoi(Boolean(data.renvoi));
      await logActivity(
        data.renvoi
          ? `a renvoyé un lien d'activation à ${nomComplet}`
          : `a créé un lien d'activation pour ${nomComplet}`,
        'profile',
        data?.id
      );
      await charger();
      return;
    }

    // methodeCreation === 'email'
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: { action: 'queue-invite', people: [{ full_name: nomComplet, email, roles: rolesCreation }] },
    });
    setCreation(false);

    if (error || data?.error) {
      await annulerStructuresEnAttente([email]);
      setErreurCreation(await extraireErreurFonction(error, data));
      return;
    }
    if (data?.queued === 0) {
      await annulerStructuresEnAttente([email]);
      setErreurCreation(data?.erreurs?.[0]?.erreur ?? "La mise en file d'attente a échoué.");
      return;
    }
    setConfirmationEmail(
      data.dureeEstimeeSecondes <= 4
        ? "Invitation envoyée par e-mail à l'instant."
        : `Invitation en cours d'envoi par e-mail (avant ${formatDateHeure(new Date(Date.now() + data.dureeEstimeeSecondes * 1000).toISOString())}).`
    );
    await logActivity(`a mis en file d'attente l'invitation de ${nomComplet}`, 'profile');
    await chargerFileAttente();
  }

  async function copierLien() {
    if (!lienGenere) return;
    await navigator.clipboard.writeText(lienGenere);
    setLienCopie(true);
  }

  async function telechargerModele() {
    const XLSX = await import('xlsx');
    const feuilleComptes = XLSX.utils.aoa_to_sheet([
      ['Nom complet', 'E-mail', 'Rôle', 'Structure'],
      ['Jean Dupont', 'jean.dupont@exemple.fr', 'arbitre', structures[0]?.name ?? ''],
    ]);
    const feuilleInstructions = XLSX.utils.aoa_to_sheet([
      ['Instructions'],
      ['Une ligne par personne à créer.'],
      ['Colonne "Rôle" : exactement admin, formateur ou arbitre (un seul par ligne).'],
      ["Un 2e rôle pourra être ajouté ensuite depuis la fiche du compte, une fois créé."],
      [
        'Colonne "Structure" (facultative) : nom exact d\'une structure existante. Pour plusieurs structures, sépare les noms par un point-virgule (ex. Structure A;Structure B).',
      ],
      [
        structures.length > 0
          ? `Structures existantes : ${structures.map((s) => s.name).join(' ; ')}`
          : "Aucune structure n'existe pour le moment (onglet Structures).",
      ],
      ["Supprime la ligne d'exemple (Jean Dupont) avant de déposer le fichier."],
    ]);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuilleComptes, 'Comptes');
    XLSX.utils.book_append_sheet(classeur, feuilleInstructions, 'Instructions');
    XLSX.writeFile(classeur, 'modele-nouveaux-comptes.xlsx');
  }

  async function importerFichier(e: ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;

    setMessageImport(null);
    setErreursImport([]);
    setApercuImport(null);

    const XLSX = await import('xlsx');
    const buffer = await fichier.arrayBuffer();
    const classeur = XLSX.read(buffer, { type: 'array' });
    const feuille = classeur.Sheets[classeur.SheetNames[0]];
    const lignes = XLSX.utils.sheet_to_json<Record<string, unknown>>(feuille, { defval: '' });

    const personnesValides: LigneImport[] = [];
    const erreurs: string[] = [];
    const emailsVus = new Set<string>();

    lignes.forEach((ligne, i) => {
      const numeroLigne = i + 2; // +1 pour l'en-tête, +1 car i commence à 0
      const nom = String(ligne['Nom complet'] ?? '').trim();
      const emailLigne = String(ligne['E-mail'] ?? '').trim().toLowerCase();
      const role = String(ligne['Rôle'] ?? '').trim().toLowerCase();

      const nomsStructures = String(ligne['Structure'] ?? '')
        .split(';')
        .map((n) => n.trim())
        .filter(Boolean);

      if (!nom && !emailLigne && !role) return; // ligne vide, ignorée silencieusement

      if (!nom) {
        erreurs.push(`Ligne ${numeroLigne} : nom manquant.`);
        return;
      }
      if (!emailLigne || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLigne)) {
        erreurs.push(`Ligne ${numeroLigne} : e-mail invalide (${emailLigne || 'vide'}).`);
        return;
      }
      if (!TOUS_LES_ROLES.includes(role as AppRole)) {
        erreurs.push(`Ligne ${numeroLigne} : rôle "${role}" invalide (attendu : admin, formateur ou arbitre).`);
        return;
      }
      if (emailsVus.has(emailLigne)) {
        erreurs.push(`Ligne ${numeroLigne} : e-mail en double dans le fichier (${emailLigne}).`);
        return;
      }
      const idsStructures: string[] = [];
      for (const nomS of nomsStructures) {
        const trouvee = structures.find((s) => s.name.trim().toLowerCase() === nomS.toLowerCase());
        if (!trouvee) {
          erreurs.push(
            `Ligne ${numeroLigne} : structure "${nomS}" inconnue (crée-la d'abord dans l'onglet Structures, ou corrige le nom).`
          );
          return;
        }
        if (!idsStructures.includes(trouvee.id)) idsStructures.push(trouvee.id);
      }
      emailsVus.add(emailLigne);
      personnesValides.push({
        full_name: nom,
        email: emailLigne,
        roles: [role as AppRole],
        structures: idsStructures,
      });
    });

    setErreursImport(erreurs);
    setApercuImport(personnesValides);
  }

  async function confirmerImport() {
    if (!apercuImport || apercuImport.length === 0) return;
    setImportant(true);
    setMessageImport(null);
    await enregistrerStructuresEnAttente(apercuImport);

    const { data, error } = await supabase.functions.invoke('create-user', {
      body: {
        action: 'queue-invite',
        people: apercuImport.map((p) => ({ full_name: p.full_name, email: p.email, roles: p.roles })),
      },
    });
    setImportant(false);

    if (error || data?.error) {
      await annulerStructuresEnAttente(apercuImport.map((p) => p.email));
      const messageErreur = await extraireErreurFonction(error, data);
      setErreursImport((prev) => [...prev, messageErreur]);
      return;
    }

    // Lignes refusées par le serveur (compte déjà existant, doublon...) :
    // on n'y attache aucune structure en attente.
    await annulerStructuresEnAttente(
      (data?.erreurs ?? []).map((e: { email: string }) => e.email).filter(Boolean)
    );

    const erreursServeur = (data?.erreurs ?? []).map(
      (e: { ligne: number; email: string; erreur: string }) =>
        e.ligne > 0 ? `Ligne ${e.ligne + 1} : ${e.erreur}` : `${e.email} : ${e.erreur}`
    );

    setMessageImport(
      `${data.queued} invitation(s) en cours d'envoi par e-mail` +
        (data.dureeEstimeeSecondes > 4
          ? ` (avant ${formatDateHeure(new Date(Date.now() + data.dureeEstimeeSecondes * 1000).toISOString())}).`
          : '.') +
        (erreursServeur.length > 0 ? ` ${erreursServeur.length} ligne(s) ignorée(s), voir détail ci-dessous.` : '')
    );
    setErreursImport(erreursServeur);
    setApercuImport(null);
    await logActivity(`a importé ${data.queued} compte(s) via fichier Excel`, 'profile');
    await chargerFileAttente();
  }

  async function annulerInvitation(id: string) {
    setAnnulationId(id);
    await supabase.from('invite_queue').delete().eq('id', id);
    setAnnulationId(null);
    await chargerFileAttente();
  }

  function initiales(nom: string) {
    return nom
      .split(' ')
      .filter(Boolean)
      .map((mot) => mot[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function changerTri(valeur: Tri) {
    setTri(valeur);
    try {
      localStorage.setItem('qcm-comptes-tri', valeur);
    } catch {
      // Sans importance : le tri ne sera simplement pas mémorisé.
    }
  }

  const connexionsConnues = personnes.some((p) => p.derniereConnexion !== undefined);
  // Un tri devenu indisponible (ex. structures pas encore installées)
  // retombe sur l'ordre alphabétique.
  const triActif: Tri =
    (tri === 'structure' && !structuresDisponibles) ||
    (['connexion-recente', 'connexion-ancienne', 'jamais-connecte'].includes(tri) && !connexionsConnues)
      ? 'nom-az'
      : tri;

  function comparer(a: PersonneAvecRoles, b: PersonneAvecRoles): number {
    const parNom = a.full_name.localeCompare(b.full_name, 'fr', { sensitivity: 'base' });
    const temps = (d: string | null | undefined) => (d ? new Date(d).getTime() : null);
    const ca = temps(a.derniereConnexion);
    const cb = temps(b.derniereConnexion);
    switch (triActif) {
      case 'nom-za':
        return -parNom;
      case 'connexion-recente':
        // Les comptes jamais connectés vont à la fin.
        if (ca === null || cb === null) return ca === cb ? parNom : ca === null ? 1 : -1;
        return cb - ca || parNom;
      case 'connexion-ancienne':
        if (ca === null || cb === null) return ca === cb ? parNom : ca === null ? 1 : -1;
        return ca - cb || parNom;
      case 'jamais-connecte':
        if (ca === null || cb === null) return ca === cb ? parNom : ca === null ? -1 : 1;
        return ca - cb || parNom;
      case 'ajout-recent':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || parNom;
      case 'ajout-ancien':
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || parNom;
      case 'role': {
        const rang = (p: PersonneAvecRoles) => {
          const rangs = p.roles.map((r) => TOUS_LES_ROLES.indexOf(r));
          return rangs.length > 0 ? Math.min(...rangs) : TOUS_LES_ROLES.length;
        };
        return rang(a) - rang(b) || parNom;
      }
      case 'structure': {
        // Première structure de la personne par ordre alphabétique ; les
        // comptes sans structure vont à la fin.
        const premiere = (p: PersonneAvecRoles) =>
          p.structures.map(nomStructure).sort((x, y) => x.localeCompare(y, 'fr'))[0] ?? null;
        const sa = premiere(a);
        const sb = premiere(b);
        if (sa === null || sb === null) return sa === sb ? parNom : sa === null ? 1 : -1;
        return sa.localeCompare(sb, 'fr', { sensitivity: 'base' }) || parNom;
      }
      default:
        return parNom;
    }
  }

  const personnesFiltrees = personnes.filter((p) => {
    if (filtreRole === 'aucun' && p.roles.length > 0) return false;
    if (filtreRole !== 'tous' && filtreRole !== 'aucun' && !p.roles.includes(filtreRole)) return false;
    if (filtreStructure === 'aucune' && p.structures.length > 0) return false;
    if (filtreStructure !== 'toutes' && filtreStructure !== 'aucune' && !p.structures.includes(filtreStructure)) {
      return false;
    }
    const texte = recherche.trim().toLowerCase();
    if (!texte) return true;
    return p.full_name.toLowerCase().includes(texte) || p.email.toLowerCase().includes(texte);
  }).sort(comparer);

  // Personne dont la fiche est ouverte (fenêtre par-dessus la liste)
  const personneOuverte = personnes.find((x) => x.id === ouvert) ?? null;

  const fileAttenteFiltree = fileAttente.filter((f) => {
    if (filtreStatutFile !== 'tous' && f.status !== filtreStatutFile) return false;
    const texte = rechercheFile.trim().toLowerCase();
    if (!texte) return true;
    return f.full_name.toLowerCase().includes(texte) || f.email.toLowerCase().includes(texte);
  });

  return (
    <AppLayout>
      <AdminNav />
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-lg font-semibold">Comptes</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="text-sm border border-border rounded px-3 py-1.5"
            onClick={() => {
              setImportOuvert((v) => !v);
              setFormulaireOuvert(false);
            }}
          >
            Import Excel
          </button>
          <button
            type="button"
            className="text-sm border border-border rounded px-3 py-1.5"
            onClick={() => {
              setFormulaireOuvert((v) => !v);
              setImportOuvert(false);
              reinitialiserFormulaireCreation();
            }}
          >
            + Nouveau
          </button>
        </div>
      </div>

      {formulaireOuvert && (
        <form onSubmit={creerCompte} className="bg-surface border border-border rounded p-4 mb-4">
          <label className="block text-sm text-muted mb-1">Nom complet</label>
          <input
            type="text"
            required
            value={nomComplet}
            onChange={(e) => setNomComplet(e.target.value)}
            className="w-full border border-border rounded px-3 py-2 mb-3"
          />

          <label className="block text-sm text-muted mb-1">E-mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-border rounded px-3 py-2 mb-3"
          />

          <label className="block text-sm text-muted mb-1">Rôle(s)</label>
          <div className="flex flex-col gap-1.5 mb-3">
            {TOUS_LES_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rolesCreation.includes(role)}
                  onChange={() => basculerRoleCreation(role)}
                />
                {LABELS[role]}
              </label>
            ))}
          </div>

          {structuresDisponibles && (
            <>
              <label className="block text-sm text-muted mb-1">Structure(s)</label>
              <div className="flex flex-col gap-1.5 mb-3">
                {structures.length === 0 && (
                  <p className="text-xs text-muted">
                    Aucune structure pour le moment : crée-les dans l'onglet Structures.
                  </p>
                )}
                {structures.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={structuresCreation.includes(s.id)}
                      onChange={() => basculerStructureCreation(s.id)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </>
          )}

          <label className="block text-sm text-muted mb-1">Activation du compte</label>
          <div className="flex flex-col gap-1.5 mb-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="methode-creation"
                checked={methodeCreation === 'email'}
                onChange={() => setMethodeCreation('email')}
              />
              Envoyer une invitation par e-mail (la personne choisit son mot de passe)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="methode-creation"
                checked={methodeCreation === 'lien'}
                onChange={() => setMethodeCreation('lien')}
              />
              Générer un lien que je transmets moi-même
            </label>
          </div>

          {erreurCreation && (
            <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-3">
              {erreurCreation}
            </p>
          )}
          {confirmationEmail && (
            <p className="text-sm text-pitch-dark bg-pitch-light rounded px-3 py-2 mb-3">{confirmationEmail}</p>
          )}
          {lienGenere && (
            <div className="mb-3">
              <p className="text-sm text-pitch-dark bg-pitch-light rounded-t px-3 py-2">
                {lienEstRenvoi
                  ? 'Un compte existait déjà pour cet e-mail (invitation précédente) : voici un nouveau lien à transmettre.'
                  : 'Compte créé. Transmets ce lien à la personne concernée :'}
              </p>
              <div className="flex gap-2 border border-t-0 border-border rounded-b p-2">
                <input
                  type="text"
                  readOnly
                  value={lienGenere}
                  className="flex-1 text-xs border border-border rounded px-2 py-1.5 bg-canvas"
                  onFocus={(ev) => ev.target.select()}
                />
                <button
                  type="button"
                  onClick={copierLien}
                  className="text-xs border border-border rounded px-3 shrink-0"
                >
                  {lienCopie ? 'Copié !' : 'Copier'}
                </button>
              </div>
            </div>
          )}

          {!lienGenere && (
            <button
              type="submit"
              disabled={creation}
              className="w-full bg-pitch text-white font-medium rounded py-2 disabled:opacity-60"
            >
              {creation ? 'Création…' : 'Créer le compte'}
            </button>
          )}
        </form>
      )}

      {importOuvert && (
        <div className="bg-surface border border-border rounded p-4 mb-4">
          <p className="text-sm text-muted mb-3">
            Dépose un fichier Excel listant plusieurs comptes à créer d'un coup. Toutes les invitations sont
            envoyées automatiquement par e-mail, au fur et à mesure.
          </p>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={telechargerModele}
              className="flex-1 text-sm border border-border rounded py-2"
            >
              Télécharger le modèle
            </button>
            <label className="flex-1 text-sm border border-border rounded py-2 text-center cursor-pointer bg-pitch text-white font-medium">
              Déposer un fichier
              <input type="file" accept=".xlsx" onChange={importerFichier} className="hidden" />
            </label>
          </div>

          {erreursImport.length > 0 && (
            <div className="text-xs text-card-red bg-card-red-bg rounded px-3 py-2 mb-3 whitespace-pre-line">
              {erreursImport.join('\n')}
            </div>
          )}
          {messageImport && (
            <p className="text-sm text-pitch-dark bg-pitch-light rounded px-3 py-2 mb-3">{messageImport}</p>
          )}

          {apercuImport && apercuImport.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">{apercuImport.length} personne(s) prête(s) à importer</p>
              <ul className="text-xs text-muted flex flex-col gap-1 mb-3 max-h-40 overflow-y-auto">
                {apercuImport.map((p, i) => (
                  <li key={i}>
                    {p.full_name} — {p.email} — {LABELS[p.roles[0]]}
                    {p.structures.length > 0 && ` — ${p.structures.map(nomStructure).join(', ')}`}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={confirmerImport}
                disabled={important}
                className="w-full bg-pitch text-white font-medium rounded py-2 text-sm disabled:opacity-60"
              >
                {important ? 'Import…' : `Confirmer l'import de ${apercuImport.length} compte(s)`}
              </button>
            </div>
          )}
        </div>
      )}

      {!chargementFile && fileAttente.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-medium">File d'attente des invitations ({fileAttente.length})</p>
            <button
              type="button"
              onClick={() => setFileAttenteOuverte((v) => !v)}
              className="text-xs text-muted underline shrink-0"
            >
              {fileAttenteOuverte ? 'Masquer' : 'Afficher'}
            </button>
          </div>

          {fileAttenteOuverte && (
            <>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={rechercheFile}
                  onChange={(e) => setRechercheFile(e.target.value)}
                  placeholder="Rechercher par nom ou e-mail…"
                  className="flex-1 border border-border rounded px-3 py-1.5 text-sm"
                />
                <select
                  value={filtreStatutFile}
                  onChange={(e) => setFiltreStatutFile(e.target.value as 'tous' | InviteQueueRow['status'])}
                  className="border border-border rounded px-2 py-1.5 text-sm"
                >
                  <option value="tous">Tous les statuts</option>
                  <option value="en_attente">En attente</option>
                  <option value="en_cours">Envoi en cours</option>
                  <option value="envoye">Envoyée</option>
                  <option value="echec">Échec</option>
                </select>
              </div>

              {fileAttenteFiltree.length === 0 ? (
                <p className="text-xs text-muted">Aucune invitation ne correspond à ce filtre.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {fileAttenteFiltree.map((f) => {
                    const statut = STATUT_FILE[f.status];
                    return (
                      <li key={f.id} className="bg-surface border border-border rounded p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-medium">{f.full_name}</span>
                          <span className={`text-xs rounded px-2 py-0.5 shrink-0 ${statut.className}`}>
                            {statut.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted mb-1">
                          {f.email} · {f.roles.map((r) => LABELS[r]).join(', ')}
                        </p>
                        {f.erreur && <p className="text-xs text-card-red mb-1">{f.erreur}</p>}
                        {(f.status === 'en_attente' || f.status === 'envoye' || f.status === 'echec') && (
                          <button
                            type="button"
                            onClick={() => annulerInvitation(f.id)}
                            disabled={annulationId === f.id}
                            className="text-xs text-card-red underline disabled:opacity-60"
                          >
                            {annulationId === f.id
                              ? 'Suppression…'
                              : f.status === 'en_attente'
                                ? 'Annuler'
                                : 'Supprimer'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {loading && <p className="text-sm text-muted">Chargement…</p>}
      {error && <p className="text-sm text-card-red">{error}</p>}

      {!loading && !error && personnes.length > 0 && (
        <input
          type="text"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher par nom ou e-mail…"
          className="w-full border border-border rounded px-3 py-2 mb-3 text-sm"
        />
      )}
      {!loading && !error && personnes.length > 0 && (
        <>
          <div className="flex gap-2 mb-2">
            <select
              value={filtreRole}
              onChange={(e) => setFiltreRole(e.target.value as typeof filtreRole)}
              aria-label="Filtrer par rôle"
              className="flex-1 min-w-0 border border-border rounded px-3 py-2 text-sm"
            >
              <option value="tous">Tous les rôles</option>
              {TOUS_LES_ROLES.map((r) => (
                <option key={r} value={r}>
                  {LABELS[r]}
                </option>
              ))}
              <option value="aucun">Aucun rôle</option>
            </select>
            {structuresDisponibles && (
              <select
                value={filtreStructure}
                onChange={(e) => setFiltreStructure(e.target.value)}
                aria-label="Filtrer par structure"
                className="flex-1 min-w-0 border border-border rounded px-3 py-2 text-sm"
              >
                <option value="toutes">Toutes les structures</option>
                <option value="aucune">Sans structure</option>
                {structures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2 mb-1">
            <label htmlFor="tri-comptes" className="text-xs text-muted shrink-0">
              Trier par
            </label>
            <select
              id="tri-comptes"
              value={triActif}
              onChange={(e) => changerTri(e.target.value as Tri)}
              className="flex-1 min-w-0 border border-border rounded px-3 py-2 text-sm"
            >
              {(Object.keys(LIBELLES_TRI) as Tri[])
                .filter((t) => t !== 'structure' || structuresDisponibles)
                .filter(
                  (t) =>
                    connexionsConnues ||
                    !['connexion-recente', 'connexion-ancienne', 'jamais-connecte'].includes(t)
                )
                .map((t) => (
                  <option key={t} value={t}>
                    {LIBELLES_TRI[t]}
                  </option>
                ))}
            </select>
          </div>
          <p className="text-xs text-muted mb-1">
            {personnesFiltrees.length === personnes.length
              ? `${personnes.length} compte(s)`
              : `${personnesFiltrees.length} compte(s) sur ${personnes.length}`}
          </p>
        </>
      )}
      {personnes.length > 0 && personnesFiltrees.length === 0 && (
        <p className="text-sm text-muted mt-2">Aucun compte ne correspond à ces critères.</p>
      )}

      <ul>
        {personnesFiltrees.map((p) => (
          <li key={p.id} className="border-b border-border py-3">
            <button
              type="button"
              className="w-full flex items-start gap-3 text-left"
              onClick={() => ouvrirPanneau(p)}
              aria-haspopup="dialog"
            >
              <span className="w-9 h-9 rounded-full bg-pitch-light text-pitch-dark flex items-center justify-center text-sm font-medium shrink-0">
                {initiales(p.full_name)}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{p.full_name}</span>
                <span className="block text-xs text-muted">{p.email}</span>
                {p.derniereConnexion !== undefined && (
                  <span className="block text-xs text-muted">
                    {texteDerniereConnexion(p.derniereConnexion)}
                  </span>
                )}
                {(triActif === 'ajout-recent' || triActif === 'ajout-ancien') && (
                  <span className="block text-xs text-muted">Ajouté le {formatDate(p.created_at)}</span>
                )}
                <span className="block mb-1.5" />
                <span className="flex gap-1 flex-wrap">
                  {p.roles.length === 0 && (
                    <span className="text-xs text-muted">Aucun rôle attribué</span>
                  )}
                  {p.roles.map((r) => (
                    <span
                      key={r}
                      className="text-xs bg-pitch-light text-pitch-dark rounded px-2 py-0.5"
                    >
                      {LABELS[r]}
                    </span>
                  ))}
                  {p.structures.map((id) => (
                    <span key={id} className="text-xs border border-border text-muted rounded px-2 py-0.5">
                      {nomStructure(id)}
                    </span>
                  ))}
                  {structuresDisponibles &&
                    p.structures.length === 0 &&
                    (p.roles.includes('arbitre') || p.roles.includes('formateur')) && (
                    <span className="text-xs text-card-yellow bg-card-yellow-bg rounded px-2 py-0.5">
                      Sans structure
                    </span>
                  )}
                </span>
              </span>
              <span className="text-muted shrink-0" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>

      {personneOuverte &&
        ((p: PersonneAvecRoles) => (
          <div className="fixed inset-0 z-50 bg-ink/45 overflow-y-auto" onClick={() => setOuvert(null)}>
            <div className="min-h-full flex items-start justify-center p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`Fiche de ${p.full_name}`}
                className="bg-canvas rounded-[14px] w-full max-w-xl p-4 flex flex-col gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-full bg-pitch-light text-pitch-dark flex items-center justify-center text-sm font-medium shrink-0">
                    {initiales(p.full_name)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">{p.full_name}</span>
                    <span className="block text-xs text-muted break-all">{p.email}</span>
                    {p.derniereConnexion !== undefined && (
                      <span className="block text-xs text-muted">
                        {texteDerniereConnexion(p.derniereConnexion)}
                      </span>
                    )}
                    <span className="block text-xs text-muted">Compte ajouté le {formatDate(p.created_at)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setOuvert(null)}
                    aria-label="Fermer la fiche"
                    className="w-8 h-8 shrink-0 rounded-full border border-border bg-surface text-sm leading-none"
                  >
                    ✕
                  </button>
                </div>

                <div className="bg-surface border border-border rounded p-3 min-w-0">
                  <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-2.5">Identité</h3>
                  <label className="block text-xs text-muted mb-1">Nom complet</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={nomEdite}
                      onChange={(e) => setNomEdite(e.target.value)}
                      className="flex-1 border border-border rounded px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => enregistrerNom(p.id)}
                      disabled={enregistrementNom || !nomEdite.trim() || nomEdite === p.full_name}
                      className="text-xs border border-border rounded px-3 disabled:opacity-50"
                    >
                      {enregistrementNom ? '…' : 'Enregistrer'}
                    </button>
                  </div>
                </div>

                <div className={structuresDisponibles ? 'grid sm:grid-cols-2 gap-3' : ''}>
                <div className="bg-surface border border-border rounded p-3 min-w-0">
                  <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-2.5">Rôles</h3>
                <div className="flex flex-col gap-2">
                  {TOUS_LES_ROLES.map((role) => {
                    const actif = p.roles.includes(role);
                    return (
                      <label key={role} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={actif}
                          disabled={enregistrement}
                          onChange={() => basculerRole(p.id, role, actif)}
                        />
                        {LABELS[role]}
                      </label>
                    );
                  })}
                </div>
                </div>

                {structuresDisponibles && (
                  <div className="bg-surface border border-border rounded p-3 min-w-0">
                    <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-2.5">Structures</h3>
                    <div className="flex flex-col gap-2">
                      {structures.length === 0 && (
                        <p className="text-xs text-muted">
                          Aucune structure pour le moment : crée-les dans l'onglet Structures.
                        </p>
                      )}
                      {structures.map((s) => {
                        const actif = p.structures.includes(s.id);
                        return (
                          <label key={s.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={actif}
                              disabled={enregistrement}
                              onChange={() => basculerStructure(p, s, actif)}
                            />
                            {s.name}
                          </label>
                        );
                      })}
                    </div>
                    {erreurStructure && <p className="text-xs text-card-red mt-1">{erreurStructure}</p>}
                  </div>
                )}
                </div>

                <div className="bg-surface border border-border rounded p-3 min-w-0 flex flex-col gap-4">
                  <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted -mb-1.5">Accès au compte</h3>
                <div>
                  <label className="block text-xs text-muted mb-1">Réinitialiser le mot de passe</label>
                  <div className="flex gap-2 mb-1">
                    <input
                      type="text"
                      placeholder="Nouveau mot de passe"
                      value={nouveauMotDePasse}
                      onChange={(e) => setNouveauMotDePasse(e.target.value)}
                      className="flex-1 border border-border rounded px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => reinitialiserMotDePasse(p.id, p.full_name)}
                      disabled={enregistrementMdp || !nouveauMotDePasse}
                      className="text-xs border border-border rounded px-3 disabled:opacity-50"
                    >
                      {enregistrementMdp ? '…' : 'Réinitialiser'}
                    </button>
                  </div>
                  {erreurMdp && <p className="text-xs text-card-red">{erreurMdp}</p>}
                  {succesMdp && <p className="text-xs text-pitch-dark">Mot de passe mis à jour.</p>}
                  <ReglesMotDePasse motDePasse={nouveauMotDePasse} />
                  <p className="text-xs text-muted -mt-2">Transmets-le à la personne concernée.</p>
                </div>

                <div>
                  <label className="block text-xs text-muted mb-1">Lien d'activation</label>
                  <p className="text-xs text-muted mb-1.5">
                    Si la personne n'a pas reçu ou a perdu son lien pour choisir elle-même son mot de
                    passe, génère un nouveau lien à lui transmettre.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => genererLienActivationPanneau(p)}
                      disabled={genererLienEnCours}
                      className="text-xs border border-border rounded px-3 py-1.5 disabled:opacity-50"
                    >
                      {genererLienEnCours ? 'Génération…' : "Générer un nouveau lien d'activation"}
                    </button>
                    <button
                      type="button"
                      onClick={() => renvoyerLienParEmail(p)}
                      disabled={renvoiEmailEnCours}
                      className="text-xs border border-border rounded px-3 py-1.5 disabled:opacity-50"
                    >
                      {renvoiEmailEnCours ? 'Envoi…' : 'Renvoyer le lien par e-mail'}
                    </button>
                  </div>
                  {erreurLienPanneau && (
                    <p className="text-xs text-card-red mt-1.5">{erreurLienPanneau}</p>
                  )}
                  {erreurRenvoiEmail && (
                    <p className="text-xs text-card-red mt-1.5">{erreurRenvoiEmail}</p>
                  )}
                  {renvoiEmailConfirmation && (
                    <p className="text-xs text-pitch-dark mt-1.5">{renvoiEmailConfirmation}</p>
                  )}
                  {lienActivationPanneau && (
                    <div className="flex gap-2 mt-1.5">
                      <input
                        type="text"
                        readOnly
                        value={lienActivationPanneau}
                        className="flex-1 text-xs border border-border rounded px-2 py-1.5 bg-canvas"
                        onFocus={(ev) => ev.target.select()}
                      />
                      <button
                        type="button"
                        onClick={copierLienPanneau}
                        className="text-xs border border-border rounded px-3 shrink-0"
                      >
                        {lienPanneauCopie ? 'Copié !' : 'Copier'}
                      </button>
                    </div>
                  )}
                </div>
                </div>

                <div className="bg-card-red-bg rounded p-3">
                  <h3 className="text-[11px] uppercase tracking-wider font-semibold text-card-red mb-2.5">Zone sensible</h3>
                  {confirmationSuppression !== p.id ? (
                    <button
                      type="button"
                      onClick={() => demanderConfirmationSuppression(p)}
                      className="w-full text-xs border border-border bg-surface rounded py-1.5 text-card-red"
                    >
                      Supprimer ce compte
                    </button>
                  ) : (
                    <div>
                      {avertissementSuppression && (
                        <p className="text-xs text-card-red bg-card-red-bg rounded px-3 py-2 mb-2">
                          {avertissementSuppression}
                        </p>
                      )}
                      <p className="text-sm mb-2">Confirmer la suppression définitive de ce compte ?</p>
                      {erreurSuppression && (
                        <p className="text-xs text-card-red mb-2">{erreurSuppression}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmationSuppression(null)}
                          className="flex-1 border border-border bg-surface rounded py-1.5 text-xs"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => supprimerCompte(p.id, p.full_name)}
                          disabled={suppression}
                          className="flex-1 bg-card-red text-white rounded py-1.5 text-xs disabled:opacity-60"
                        >
                          {suppression ? 'Suppression…' : 'Supprimer définitivement'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))(personneOuverte)}

      {!loading && !error && personnes.length === 0 && (
        <p className="text-sm text-muted">Aucun compte pour le moment.</p>
      )}
    </AppLayout>
  );
}
