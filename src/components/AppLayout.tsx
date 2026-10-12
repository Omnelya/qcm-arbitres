import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import MenuEspace, { type LienMenu } from './MenuEspace';
import type { AppRole } from '../hooks/useAuth';
import { useAuth } from '../hooks/useAuth';
import RoleSwitcher from './RoleSwitcher';

// Menu et sous-titre de chaque espace
const ESPACES: Record<AppRole, { sousTitre: string; menu: string; liens: LienMenu[] }> = {
  admin: {
    sousTitre: 'Administration',
    menu: 'Menu administrateur',
    liens: [
      { to: '/admin', label: "Vue d'ensemble", end: true },
      { to: '/admin/comptes', label: 'Comptes' },
      { to: '/admin/structures', label: 'Structures' },
      { to: '/admin/journal', label: 'Journal' },
      { to: '/admin/reglages', label: 'Réglages' },
    ],
  },
  formateur: {
    sousTitre: 'Espace formateur',
    menu: 'Menu formateur',
    liens: [
      { to: '/formateur', label: 'Mes QCM', end: true },
      { to: '/formateur/groupes', label: 'Mes groupes' },
    ],
  },
  arbitre: {
    sousTitre: 'Espace arbitre',
    menu: 'Menu arbitre',
    liens: [
      { to: '/arbitre', label: 'Mes QCM', end: true },
      { to: '/arbitre/historique', label: 'Historique' },
    ],
  },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  const { profile, signOut, activeRole } = useAuth();
  const { pathname } = useLocation();

  // Barre latérale « tableau de marque » (maquette A) pour les trois
  // espaces. Les pages communes (Mon profil...) prennent l'espace du rôle actif.
  const roleDuChemin = (['admin', 'formateur', 'arbitre'] as AppRole[]).find((r) => pathname.startsWith(`/${r}`));
  const espace = roleDuChemin ?? activeRole;
  if (espace) {
    const { sousTitre, menu, liens } = ESPACES[espace];
    return (
      <div className="min-h-screen md:flex bg-terrain font-admin zone-app">
        <aside className="bg-nuit text-nuit-craie md:w-56 md:shrink-0 md:h-screen md:sticky md:top-0 flex flex-col gap-3 md:gap-5 p-3 md:p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-display font-bold text-2xl leading-none">
              QCM Arbitres
              <span className="block font-admin font-normal text-xs opacity-70 mt-1">{sousTitre}</span>
            </p>
            <span className="md:hidden flex gap-3 text-sm">
              <Link to="/mon-profil" className="underline opacity-80">
                Mon profil
              </Link>
              <button onClick={() => signOut()} className="underline opacity-80 min-h-0">
                Déconnexion
              </button>
            </span>
          </div>
          {/* Choix du profil (rôle), dans l'encart vert en haut */}
          <RoleSwitcher sombre />
          <MenuEspace liens={liens} titre={menu} />
          <div className="hidden md:flex md:mt-auto flex-col gap-2 text-sm">
            <span className="opacity-70">{profile?.full_name}</span>
            <Link to="/mon-profil" className="underline opacity-80">
              Mon profil
            </Link>
            <button onClick={() => signOut()} className="underline opacity-80 text-left min-h-0">
              Déconnexion
            </button>
          </div>
        </aside>
        <div className="flex-1 min-w-0">
          <main className="max-w-5xl px-4 md:px-8 py-6">{children}</main>
          <footer className="max-w-5xl px-4 md:px-8 pb-6">
            <Link to="/confidentialite" className="text-xs text-muted underline">
              Confidentialité
            </Link>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between gap-3">
        <RoleSwitcher />
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-sm text-muted hidden sm:inline">{profile?.full_name}</span>
          <Link to="/mon-profil" className="text-sm text-muted underline">
            Mon profil
          </Link>
          <button onClick={() => signOut()} className="text-sm text-muted underline">
            Déconnexion
          </button>
        </div>
      </header>
      <main className="max-w-md mx-auto px-4 py-6">{children}</main>
      <footer className="max-w-md mx-auto px-4 pb-6 text-center">
        <Link to="/confidentialite" className="text-xs text-muted underline">
          Confidentialité
        </Link>
      </footer>
    </div>
  );
}
