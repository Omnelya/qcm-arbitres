import { NavLink } from 'react-router-dom';

export interface LienMenu {
  to: string;
  label: string;
  end?: boolean;
}

// Menu de chaque espace (admin, formateur, arbitre) : vertical dans la barre
// latérale sur ordinateur, horizontal (défilant) en haut de l'écran sur téléphone.
export default function MenuEspace({ liens, titre }: { liens: LienMenu[]; titre: string }) {
  return (
    <nav aria-label={titre} className="flex md:flex-col gap-1 overflow-x-auto w-full">
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
