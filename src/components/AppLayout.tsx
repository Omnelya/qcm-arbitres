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
      { to: '/admin', label: 'Accueil', icone: 'accueil', end: true },
      { to: '/admin/comptes', label: 'Comptes', icone: 'comptes' },
      { to: '/admin/structures', label: 'Structures', icone: 'structures' },
      { to: '/admin/journal', label: 'Journal', icone: 'journal' },
      { to: '/admin/reglages', label: 'Réglages', icone: 'reglages' },
    ],
  },
  formateur: {
    sousTitre: 'Espace formateur',
    menu: 'Menu formateur',
    liens: [
      { to: '/formateur', label: 'Mes QCM', icone: 'qcm', end: true },
      { to: '/formateur/groupes', label: 'Mes groupes', icone: 'groupes' },
      { to: '/mon-profil', label: 'Profil', icone: 'profil' },
    ],
  },
  arbitre: {
    sousTitre: 'Espace arbitre',
    menu: 'Menu arbitre',
    liens: [
      { to: '/arbitre', label: 'Mes QCM', icone: 'accueil', end: true },
      { to: '/arbitre/historique', label: 'Historique', icone: 'historique' },
      { to: '/mon-profil', label: 'Profil', icone: 'profil' },
    ],
  },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  const { profile, signOut, activeRole } = useAuth();
  const { pathname } = useLocation();

  // Maquette v3 : en-tête blanc, choix du profil, contenu en cartes, menu en
  // bas de l'écran sur téléphone. Les pages communes (Mon profil...) prennent
  // l'espace du rôle actif.
  const roleDuChemin = (['admin', 'formateur', 'arbitre'] as AppRole[]).find((r) => pathname.startsWith(`/${r}`));
  const espace = roleDuChemin ?? activeRole;
  if (espace) {
    const { sousTitre, menu, liens } = ESPACES[espace];
    const initiales = (profile?.full_name ?? '')
      .split(' ')
      .filter(Boolean)
      .map((m) => m[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return (
      <div className="min-h-screen bg-canvas zone-app pb-24 md:pb-0">
        <header className="bg-surface shadow-[0_1px_0_#E2E7E3] sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-pitch grid place-items-center shrink-0" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="8" fill="none" stroke="#fff" strokeWidth="1.8" />
                <path d="M3.5 7.5 Q10 4.5 16.5 7.5 M3.5 12.5 Q10 15.5 16.5 12.5" fill="none" stroke="#fff" strokeWidth="1.5" />
              </svg>
            </span>
            <p className="flex-1 min-w-0 leading-tight">
              <span className="block font-bold">QCM Arbitres</span>
              <span className="block text-xs text-muted">{sousTitre}</span>
            </p>
            <Link
              to="/mon-profil"
              aria-label="Mon profil"
              title={profile?.full_name}
              className="w-9 h-9 rounded-full bg-ambre-doux text-ambre-fonce grid place-items-center text-[13px] font-bold shrink-0"
            >
              {initiales || '?'}
            </Link>
            <button
              type="button"
              onClick={() => signOut()}
              aria-label="Déconnexion"
              title="Déconnexion"
              className="w-9 h-9 min-h-0 rounded-full grid place-items-center text-muted hover:bg-canvas shrink-0"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
          <div className="max-w-3xl mx-auto px-4 pb-3 flex flex-col md:flex-row md:flex-wrap md:items-center gap-2">
            <RoleSwitcher sombre />
            <div className="hidden md:block md:ml-auto">
              <MenuEspace liens={liens} titre={menu} />
            </div>
          </div>
        </header>
        <div className="md:hidden">
          <MenuEspace liens={liens} titre={menu} />
        </div>
        <main className="max-w-3xl mx-auto px-4 py-5">{children}</main>
        <footer className="max-w-3xl mx-auto px-4 pb-6">
          <Link to="/confidentialite" className="text-xs text-muted underline">
            Confidentialité
          </Link>
        </footer>
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
