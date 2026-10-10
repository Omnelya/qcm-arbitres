import { useEffect, useState } from 'react';
import { chargerStructuresDesQcm, variablesCouleur, type Structure } from '../lib/structures';

// Structure(s) d'un QCM, déduites des groupes ciblés (liste vide si aucun
// groupe n'est encore choisi, ou si la mise à jour SQL n'est pas faite).
export function useStructuresQcm(quizId: string | undefined): Structure[] {
  const [structures, setStructures] = useState<Structure[]>([]);
  useEffect(() => {
    let actif = true;
    if (!quizId) return;
    chargerStructuresDesQcm([quizId]).then((parQcm) => {
      if (actif) setStructures(parQcm[quizId] ?? []);
    });
    return () => {
      actif = false;
    };
  }, [quizId]);
  return structures;
}

// Tant que l'écran est affiché, tous les éléments verts de l'application
// (boutons, onglets, étiquettes...) prennent la couleur de la structure du
// QCM. Plusieurs structures : celle qui vient en premier par ordre
// alphabétique. Aucune structure : le vert habituel.
export function useCouleurStructureEcran(structures: Structure[]): void {
  const couleur = structures.length > 0 ? structures[0].color : null;
  useEffect(() => {
    if (!couleur) return;
    const racine = document.documentElement;
    const variables = variablesCouleur(couleur);
    Object.entries(variables).forEach(([nom, valeur]) => racine.style.setProperty(nom, valeur));
    return () => {
      Object.keys(variables).forEach((nom) => racine.style.removeProperty(nom));
    };
  }, [couleur]);
}
