import { supabase } from './supabaseClient';

export interface Structure {
  id: string;
  name: string;
  // Couleur #RRGGBB choisie par l'administrateur
  color: string;
}

// Couleurs proposées à l'administrateur : bien distinctes entre elles et
// assez foncées pour rester lisibles sur fond clair. Même ordre que la
// migration SQL qui colore les structures déjà existantes.
export const PALETTE_STRUCTURES = [
  { valeur: '#1F6F4A', nom: 'Vert' },
  { valeur: '#2563A6', nom: 'Bleu' },
  { valeur: '#C0392B', nom: 'Rouge' },
  { valeur: '#B7791F', nom: 'Ocre' },
  { valeur: '#7B3FA0', nom: 'Violet' },
  { valeur: '#0F8A8A', nom: 'Turquoise' },
  { valeur: '#C2185B', nom: 'Framboise' },
  { valeur: '#5D6D2E', nom: 'Olive' },
  { valeur: '#D35400', nom: 'Orange' },
  { valeur: '#34495E', nom: 'Ardoise' },
];

export const COULEUR_PAR_DEFAUT = PALETTE_STRUCTURES[0].valeur;

export function couleurValide(c: string | null | undefined): string {
  return c && /^#[0-9A-Fa-f]{6}$/.test(c) ? c : COULEUR_PAR_DEFAUT;
}

// Première couleur de la palette pas encore utilisée (pour une nouvelle
// structure), ou la suivante dans l'ordre si toutes sont prises.
export function prochaineCouleur(existantes: string[]): string {
  const prises = new Set(existantes.map((c) => c.toUpperCase()));
  const libre = PALETTE_STRUCTURES.find((p) => !prises.has(p.valeur.toUpperCase()));
  return libre ? libre.valeur : PALETTE_STRUCTURES[existantes.length % PALETTE_STRUCTURES.length].valeur;
}

// Charge les structures visibles. Si la mise à jour SQL des couleurs n'a
// pas encore été exécutée dans Supabase, on recharge sans la couleur (une
// couleur par défaut est alors utilisée). `erreur` = vrai si les
// structures elles-mêmes sont indisponibles ; `couleurs` = vrai si les
// couleurs sont enregistrées en base (donc modifiables).
export async function chargerStructures(): Promise<{
  structures: Structure[];
  erreur: boolean;
  couleurs: boolean;
}> {
  const avecCouleur = await supabase.from('structures').select('id, name, color').order('name');
  if (!avecCouleur.error) {
    return {
      structures: (avecCouleur.data ?? []).map((s) => ({ ...s, color: couleurValide(s.color) })),
      erreur: false,
      couleurs: true,
    };
  }
  const sansCouleur = await supabase.from('structures').select('id, name').order('name');
  if (sansCouleur.error) return { structures: [], erreur: true, couleurs: false };
  return {
    structures: (sansCouleur.data ?? []).map((s) => ({ ...s, color: COULEUR_PAR_DEFAUT })),
    erreur: false,
    couleurs: false,
  };
}

// Structure(s) de chaque QCM (déduites des groupes ciblés), par QCM.
// Renvoie un objet vide si la fonction n'est pas encore installée.
export async function chargerStructuresDesQcm(quizIds: string[]): Promise<Record<string, Structure[]>> {
  if (quizIds.length === 0) return {};
  const { data, error } = await supabase.rpc('structures_des_qcm', { p_quiz_ids: quizIds });
  if (error || !Array.isArray(data)) return {};
  const parQcm: Record<string, Structure[]> = {};
  for (const ligne of data as { quiz_id: string; structure_id: string; name: string; color: string }[]) {
    (parQcm[ligne.quiz_id] ??= []).push({
      id: ligne.structure_id,
      name: ligne.name,
      color: couleurValide(ligne.color),
    });
  }
  return parQcm;
}
