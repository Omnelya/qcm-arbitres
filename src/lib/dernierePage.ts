// Mémorise le dernier onglet ouvert dans l'espace de la personne, pour le
// rouvrir en revenant sur l'application. Oublié à la déconnexion et après 24 h.
const CLE = 'qcm-derniere-page';
const DUREE_MS = 24 * 60 * 60 * 1000;

// Onglets du menu seulement : jamais un QCM en cours de passage ni une fiche de détail.
const MEMORISABLE = /^\/(?:admin(?:\/(?:comptes|structures|banque|journal|reglages))?|formateur(?:\/groupes)?|arbitre(?:\/historique)?)$/;

export function memoriserPage(userId: string, chemin: string): void {
  if (!MEMORISABLE.test(chemin)) return;
  try {
    localStorage.setItem(CLE, JSON.stringify({ userId, chemin, le: Date.now() }));
  } catch {
    // stockage indisponible (navigation privée…) : on ne retient simplement rien
  }
}

// Renvoie l'onglet à rouvrir, ou null (rien de retenu, trop ancien, autre personne, rôle retiré).
export function pageMemorisee(userId: string, roles: string[]): string | null {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return null;
    const { userId: u, chemin, le } = JSON.parse(brut) as { userId: string; chemin: string; le: number };
    if (u !== userId || Date.now() - le > DUREE_MS || !MEMORISABLE.test(chemin)) return null;
    return roles.includes(chemin.split('/')[1]) ? chemin : null;
  } catch {
    return null;
  }
}

export function oublierPage(): void {
  try {
    localStorage.removeItem(CLE);
    localStorage.removeItem(CLE_BANQUE);
    // toutes les mémoires « génériques » (brouillons de question, fenêtres ouvertes…)
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIXE)) localStorage.removeItem(k);
  } catch {
    // rien à faire
  }
}

// Mémoire générique : une valeur par clé, liée à la personne connectée, valable 24 h,
// effacée à la déconnexion (voir oublierPage).
const PREFIXE = 'qcm-memoire:';

export function memoriser(cle: string, userId: string, valeur: unknown): void {
  try {
    localStorage.setItem(PREFIXE + cle, JSON.stringify({ userId, valeur, le: Date.now() }));
  } catch {
    // stockage plein ou bloqué : on ne retient rien
  }
}

export function memorisee<T>(cle: string, userId: string): T | null {
  try {
    const brut = localStorage.getItem(PREFIXE + cle);
    if (!brut) return null;
    const { userId: u, valeur, le } = JSON.parse(brut) as { userId: string; valeur: T; le: number };
    return u === userId && Date.now() - le <= DUREE_MS ? valeur : null;
  } catch {
    return null;
  }
}

export function oublier(cle: string): void {
  try {
    localStorage.removeItem(PREFIXE + cle);
  } catch {
    // rien à faire
  }
}

// Position dans la page admin « Banque » (banque ouverte, page, recherche, filtre de thème).
const CLE_BANQUE = 'qcm-banque-position';

export interface PositionBanque {
  banqueId: string;
  page: number;
  filtreTheme: string;
  recherche: string;
  themeCible: string;
}

export function memoriserBanque(userId: string, position: PositionBanque): void {
  try {
    localStorage.setItem(CLE_BANQUE, JSON.stringify({ userId, position, le: Date.now() }));
  } catch {
    // stockage indisponible : on ne retient rien
  }
}

export function banqueMemorisee(userId: string): PositionBanque | null {
  try {
    const brut = localStorage.getItem(CLE_BANQUE);
    if (!brut) return null;
    const { userId: u, position, le } = JSON.parse(brut) as { userId: string; position: PositionBanque; le: number };
    return u === userId && Date.now() - le <= DUREE_MS ? position : null;
  } catch {
    return null;
  }
}

export function oublierBanque(): void {
  try {
    localStorage.removeItem(CLE_BANQUE);
  } catch {
    // rien à faire
  }
}
