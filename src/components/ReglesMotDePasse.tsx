import { verifierMotDePasse } from '../lib/motDePasse';

// Checklist affichée sous le champ mot de passe, mise à jour en direct
// pendant la saisie : plus clair qu'un seul message d'erreur générique
// au moment de valider, surtout pour un public peu technique.
export default function ReglesMotDePasse({ motDePasse }: { motDePasse: string }) {
  const regles = verifierMotDePasse(motDePasse);
  const items: { ok: boolean; label: string }[] = [
    { ok: regles.longueur, label: '8 caractères minimum' },
    { ok: regles.majuscule, label: 'Une majuscule' },
    { ok: regles.minuscule, label: 'Une minuscule' },
    { ok: regles.chiffre, label: 'Un chiffre' },
    { ok: regles.special, label: 'Un caractère spécial (ex. ! ? # -)' },
  ];

  return (
    <ul className="text-xs mb-3 flex flex-col gap-0.5">
      {items.map((item) => (
        <li key={item.label} className={item.ok ? 'text-pitch-dark' : 'text-muted'}>
          {item.ok ? '✓' : '○'} {item.label}
        </li>
      ))}
    </ul>
  );
}
