import { NavLink } from 'react-router-dom';

const liens = [
  { to: '/admin', label: "Vue d'ensemble", end: true },
  { to: '/admin/comptes', label: 'Comptes' },
  { to: '/admin/structures', label: 'Structures' },
  { to: '/admin/journal', label: 'Journal' },
  { to: '/admin/reglages', label: 'Réglages' },
];

export default function AdminNav() {
  return (
    <nav className="flex gap-4 border-b border-border mb-5 text-sm overflow-x-auto">
      {liens.map((lien) => (
        <NavLink
          key={lien.to}
          to={lien.to}
          end={lien.end}
          className={({ isActive }) =>
            'pb-2 -mb-px border-b-2 whitespace-nowrap ' +
            (isActive ? 'border-pitch text-pitch font-medium' : 'border-transparent text-muted')
          }
        >
          {lien.label}
        </NavLink>
      ))}
    </nav>
  );
}
