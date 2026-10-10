import { supabase } from './supabaseClient';

export interface Structure {
  id: string;
  name: string;
  // Couleur #RRGGBB choisie par l'administrateur
  color: string;
}

// Couleurs proposées à l'administrateur, bien distinctes entre elles. Les
// 10 premières sont dans le même ordre que la migration SQL qui colore les
// structures déjà existantes. Le texte posé dessus (boutons) passe
// automatiquement en blanc ou en noir selon la couleur (voir couleurTexteSur).
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
  { valeur: '#1A237E', nom: 'Indigo' },
  { valeur: '#0288D1', nom: 'Bleu ciel' },
  { valeur: '#00695C', nom: 'Sapin' },
  { valeur: '#F9A825', nom: 'Jaune' },
  { valeur: '#E91E63', nom: 'Rose' },
  { valeur: '#4A148C', nom: 'Aubergine' },
  { valeur: '#5D4037', nom: 'Chocolat' },
  { valeur: '#7F1D1D', nom: 'Bordeaux' },
  { valeur: '#607D8B', nom: 'Gris bleu' },
  { valeur: '#212121', nom: 'Noir' },
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

// --- Couleur des boutons selon la structure -------------------------------

function luminance(hex: string): number {
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

function contraste(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const BLANC = '#FFFFFF';
const ENCRE = '#1A1D1B';

// Texte blanc ou foncé, celui qui se lit le mieux sur cette couleur.
export function couleurTexteSur(fond: string): string {
  const l = luminance(couleurValide(fond));
  return contraste(l, 1) >= contraste(l, luminance(ENCRE)) ? BLANC : ENCRE;
}

// Style d'un bouton principal (Publier, Commencer...) aux couleurs des
// structures concernées : couleur pleine pour une structure, bandes
// verticales pour plusieurs. undefined = pas de structure, le bouton
// garde sa couleur habituelle.
export function styleBoutonStructures(
  structures: Pick<Structure, 'color'>[]
): { background: string; color: string; borderColor: string } | undefined {
  const couleurs = Array.from(new Set(structures.map((s) => couleurValide(s.color).toUpperCase())));
  if (couleurs.length === 0) return undefined;
  if (couleurs.length === 1) {
    return { background: couleurs[0], color: couleurTexteSur(couleurs[0]), borderColor: couleurs[0] };
  }
  const part = 100 / couleurs.length;
  const bandes = couleurs.map((c, i) => `${c} ${i * part}% ${(i + 1) * part}%`).join(', ');
  // Texte blanc seulement s'il se lit bien sur toutes les bandes.
  const texte = couleurs.every((c) => couleurTexteSur(c) === BLANC) ? BLANC : ENCRE;
  return { background: `linear-gradient(90deg, ${bandes})`, color: texte, borderColor: couleurs[0] };
}

// --- Couleur principale de l'application aux couleurs d'une structure ----

function versRgb(hex: string): [number, number, number] {
  const h = couleurValide(hex);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function melange(a: [number, number, number], b: [number, number, number], part: number) {
  return a.map((v, i) => Math.round(v * (1 - part) + b[i] * part)).join(' ');
}

// Variables CSS qui remplacent le vert de l'application (classes
// bg-pitch, text-pitch-dark, bg-pitch-light...) par la couleur donnée.
export function variablesCouleur(couleur: string): Record<string, string> {
  const rgb = versRgb(couleur);
  return {
    '--pitch-rgb': rgb.join(' '),
    // Version foncée, lisible sur la version claire (étiquettes).
    '--pitch-dark-rgb': melange(rgb, [0, 0, 0], 0.4),
    '--pitch-light-rgb': melange(rgb, [255, 255, 255], 0.88),
    '--sur-pitch': couleurTexteSur(couleur),
  };
}
