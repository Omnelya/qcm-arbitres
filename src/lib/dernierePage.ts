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
  } catch {
    // rien à faire
  }
}
