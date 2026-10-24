import { NavLink } from 'react-router-dom';

export type IconeMenu = 'accueil' | 'qcm' | 'groupes' | 'historique' | 'comptes' | 'structures' | 'banque' | 'journal' | 'reglages' | 'profil' | 'support';

export interface LienMenu {
  to: string;
  label: string;
  icone: IconeMenu;
  end?: boolean;
}

// Pictogrammes du menu (traits simples, couleur du texte)
const ICONES: Record<IconeMenu, JSX.Element> = {
  accueil: <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" />,
  qcm: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  groupes: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 19c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5M15 15.5c2.5 0 4.5 1 5.5 3.5" /></>,
  historique: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  comptes: <><circle cx="12" cy="9" r="3.5" /><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" /></>,
  structures: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
  banque: <><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" /></>,
  journal: <><path d="M6 4h12v16H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  reglages: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  profil: <><circle cx="12" cy="9" r="3.5" /><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" /></>,
  support: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4M8 20h8M8 9l3 2-3 2" /></>,
};

// Menu de chaque espace : barre d'onglets fixée en bas de l'écran sur
// téléphone, rangée d'onglets dans l'en-tête sur ordinateur.
export default function MenuEspace({ liens, titre }: { liens: LienMenu[]; titre: string }) {
  return (
    <nav
      aria-label={titre}
      className="fixed md:static bottom-0 inset-x-0 z-20 bg-surface md:bg-transparent shadow-[0_-1px_0_#E2E7E3] md:shadow-none px-2 md:px-0 pt-1.5 md:pt-0 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] md:pb-0 flex md:gap-1"
    >
      {liens.map((lien) => (
        <NavLink
          key={lien.to}
          to={lien.to}
          end={lien.end}
          className={({ isActive }) =>
            'flex-1 md:flex-none flex flex-col md:flex-row items-center gap-0.5 md:gap-2 rounded-xl px-1 md:px-3 py-1.5 md:py-2 text-xs md:text-sm font-semibold whitespace-nowrap ' +
            (isActive ? 'bg-pitch-light text-pitch' : 'text-muted hover:bg-canvas')
          }
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-[22px] h-[22px] md:w-[18px] md:h-[18px]"
            aria-hidden="true"
          >
            {ICONES[lien.icone]}
          </svg>
          {lien.label}
        </NavLink>
      ))}
    </nav>
  );
}
