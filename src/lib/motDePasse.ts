// Politique de mot de passe : 8 caractères minimum, au moins une
// majuscule, une minuscule, un chiffre et un caractère spécial.
//
// Le jeu de caractères spéciaux reconnu ici correspond exactement à
// celui accepté par Supabase Auth quand la même règle est activée côté
// serveur (Authentication > Providers > Email > Password Requirements) :
// !@#$%^&*()_+-=[]{};':"|<>?,./`~
// Garder les deux alignés évite qu'un mot de passe validé ici soit
// ensuite refusé par le serveur pour un caractère non reconnu.
const CARACTERES_SPECIAUX = /[!@#$%^&*()_+=[\]{};':"|<>?,./`~-]/;

export interface ReglesMotDePasse {
  longueur: boolean;
  majuscule: boolean;
  minuscule: boolean;
  chiffre: boolean;
  special: boolean;
}

export function verifierMotDePasse(motDePasse: string): ReglesMotDePasse {
  return {
    longueur: motDePasse.length >= 8,
    majuscule: /\p{Lu}/u.test(motDePasse),
    minuscule: /\p{Ll}/u.test(motDePasse),
    chiffre: /\p{N}/u.test(motDePasse),
    special: CARACTERES_SPECIAUX.test(motDePasse),
  };
}

export function motDePasseValide(motDePasse: string): boolean {
  const r = verifierMotDePasse(motDePasse);
  return r.longueur && r.majuscule && r.minuscule && r.chiffre && r.special;
}

export const MESSAGE_REGLES_MOT_DE_PASSE =
  'Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.';
