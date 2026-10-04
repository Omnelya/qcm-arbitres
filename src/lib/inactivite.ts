// Déconnexion automatique après une période d'inactivité.
//
// "Activité" = souris, clavier, toucher ou défilement. La date de la
// dernière activité est gardée dans le navigateur (localStorage) pour être
// commune à tous les onglets ouverts sur le site, et pour qu'un retour
// après fermeture du navigateur soit aussi considéré comme une inactivité.
import { useEffect } from 'react';

export const DELAI_INACTIVITE_MS = 5 * 60_000;
// Durée pendant laquelle un avertissement est affiché avant la déconnexion.
export const DELAI_AVERTISSEMENT_MS = 60_000;

const CLE_ACTIVITE = 'qcm-derniere-activite';
const CLE_MESSAGE = 'qcm-deconnexion-inactivite';

let derniereEnMemoire = Date.now();
let suspensions = 0;

export function signalerActivite(): void {
  derniereEnMemoire = Date.now();
  try {
    localStorage.setItem(CLE_ACTIVITE, String(derniereEnMemoire));
  } catch {
    // Stockage indisponible (navigation privée...) : la valeur en mémoire suffit.
  }
}

// Date de la dernière activité connue, tous onglets confondus.
// null = aucune activité enregistrée dans ce navigateur.
export function lireActiviteEnregistree(): number | null {
  try {
    const brut = localStorage.getItem(CLE_ACTIVITE);
    const valeur = brut ? Number(brut) : NaN;
    return Number.isFinite(valeur) ? valeur : null;
  } catch {
    return null;
  }
}

export function millisecondesRestantes(): number {
  const derniere = Math.max(derniereEnMemoire, lireActiviteEnregistree() ?? 0);
  return DELAI_INACTIVITE_MS - (Date.now() - derniere);
}

// Vrai si la dernière activité enregistrée dans ce navigateur est trop
// ancienne (utilisé à l'ouverture du site, avant toute activité).
export function activiteEnregistreePerimee(): boolean {
  const enregistree = lireActiviteEnregistree();
  return enregistree !== null && Date.now() - enregistree > DELAI_INACTIVITE_MS;
}

export function deconnexionSuspendue(): boolean {
  return suspensions > 0;
}

// Message affiché sur la page de connexion après une déconnexion automatique.
export function memoriserMessageDeconnexion(): void {
  try {
    sessionStorage.setItem(CLE_MESSAGE, '1');
  } catch {
    // Sans importance : seul le message d'explication ne s'affichera pas.
  }
}

export function consommerMessageDeconnexion(): boolean {
  try {
    const present = sessionStorage.getItem(CLE_MESSAGE) === '1';
    sessionStorage.removeItem(CLE_MESSAGE);
    return present;
  } catch {
    return false;
  }
}

// À utiliser dans un écran où la personne peut légitimement rester plus de
// 5 minutes sans toucher l'écran (QCM en cours, envoi d'une vidéo) : tant
// que `actif` est vrai, la déconnexion automatique est suspendue.
export function useSuspendreDeconnexionInactivite(actif: boolean): void {
  useEffect(() => {
    if (!actif) return;
    suspensions += 1;
    return () => {
      suspensions -= 1;
      signalerActivite();
    };
  }, [actif]);
}
