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
  roles: AppRole[];
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
    ] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
      supabase.from('user_roles').select('user_id, role'),
      supabase.rpc('admin_dernieres_connexions'),
    ]);
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
      roles: (roleRows ?? [])
        .filter((r) => r.user_id === p.id)
        .map((r) => r.role as AppRole),
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

  function ouvrirPanneau(p: PersonneAvecRoles) {
    const memePersonne = ouvert === p.id;
    setOuvert(memePersonne ? null : p.id);
    setNomEdite(p.full_name);
    setNouveauMotDePasse('');
    setErreurMdp(null);
    setSuccesMdp(false);
    setConfirmationSuppression(null);
    setAvertissementSuppression(null);
    setErreurSuppression(null);
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

  function reinitialiserFormulaireCreation() {
    setNomComplet('');
    setEmail('');
    setRolesCreation([]);
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

    if (methodeCreation === 'lien') {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { action: 'generate-invite-link', email, full_name: nomComplet, roles: rolesCreation },
      });
      setCreation(false);

      if (error || data?.error) {
        setErreurCreation(await extraireErreurFonction(error, data));
        return;
      }
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
      setErreurCreation(await extraireErreurFonction(error, data));
      return;
    }
    if (data?.queued === 0) {
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
      ['Nom complet', 'E-mail', 'Rôle'],
      ['Jean Dupont', 'jean.dupont@exemple.fr', 'arbitre'],
    ]);
    const feuilleInstructions = XLSX.utils.aoa_to_sheet([
      ['Instructions'],
      ['Une ligne par personne à créer.'],
      ['Colonne "Rôle" : exactement admin, formateur ou arbitre (un seul par ligne).'],
      ["Un 2e rôle pourra être ajouté ensuite depuis la fiche du compte, une fois créé."],
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
      emailsVus.add(emailLigne);
      personnesValides.push({ full_name: nom, email: emailLigne, roles: [role as AppRole] });
    });

    setErreursImport(erreurs);
    setApercuImport(personnesValides);
  }

  async function confirmerImport() {
    if (!apercuImport || apercuImport.length === 0) return;
    setImportant(true);
    setMessageImport(null);

    const { data, error } = await supabase.functions.invoke('create-user', {
      body: { action: 'queue-invite', people: apercuImport },
    });
    setImportant(false);

    if (error || data?.error) {
      const messageErreur = await extraireErreurFonction(error, data);
      setErreursImport((prev) => [...prev, messageErreur]);
      return;
    }

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

  const personnesFiltrees = personnes.filter((p) => {
    const texte = recherche.trim().toLowerCase();
    if (!texte) return true;
    return p.full_name.toLowerCase().includes(texte) || p.email.toLowerCase().includes(texte);
  });

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
      {personnes.length > 0 && personnesFiltrees.length === 0 && (
        <p className="text-sm text-muted">Aucun compte ne correspond à cette recherche.</p>
      )}

      <ul>
        {personnesFiltrees.map((p) => (
          <li key={p.id} className="border-b border-border py-3">
            <button
              type="button"
              className="w-full flex items-start gap-3 text-left"
              onClick={() => ouvrirPanneau(p)}
              aria-expanded={ouvert === p.id}
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
                </span>
              </span>
            </button>

            {ouvert === p.id && (
              <div className="mt-3 pl-12 flex flex-col gap-4">
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

                <div>
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

                <div className="pt-3 border-t border-border">
                  {confirmationSuppression !== p.id ? (
                    <button
                      type="button"
                      onClick={() => demanderConfirmationSuppression(p)}
                      className="w-full text-xs border border-border rounded py-1.5 text-card-red"
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
                          className="flex-1 border border-border rounded py-1.5 text-xs"
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
            )}
          </li>
        ))}
      </ul>

      {!loading && !error && personnes.length === 0 && (
        <p className="text-sm text-muted">Aucun compte pour le moment.</p>
      )}
    </AppLayout>
  );
}
