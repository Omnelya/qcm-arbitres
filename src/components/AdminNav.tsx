import { NavLink } from 'react-router-dom';

const liens = [
  { to: '/admin', label: "Vue d'ensemble", end: true },
  { to: '/admin/comptes', label: 'Comptes' },
  { to: '/admin/structures', label: 'Structures' },
  { to: '/admin/journal', label: 'Journal' },
  { to: '/admin/reglages', label: 'Réglages' },
];

// Menu de l'espace administrateur : vertical dans la barre latérale sur
// ordinateur, horizontal (défilant) en haut de l'écran sur téléphone.
export default function AdminNav() {
  return (
    <nav aria-label="Menu administrateur" className="flex md:flex-col gap-1 overflow-x-auto w-full">
      {liens.map((lien) => (
        <NavLink
          key={lien.to}
          to={lien.to}
          end={lien.end}
          className={({ isActive }) =>
            'px-3 py-2 rounded-md text-sm whitespace-nowrap ' +
            (isActive
              ? 'bg-nuit-clair font-semibold text-white shadow-[inset_0_-3px_0_#E0A526] md:shadow-[inset_3px_0_0_#E0A526]'
              : 'text-nuit-craie/80 hover:bg-nuit-clair/60')
          }
        >
          {lien.label}
        </NavLink>
      ))}
    </nav>
  );
}
