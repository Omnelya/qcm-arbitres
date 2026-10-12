import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import AdminNav from './AdminNav';
import { useAuth } from '../hooks/useAuth';
import RoleSwitcher from './RoleSwitcher';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { pathname } = useLocation();

  // Espace administrateur : barre latérale « tableau de marque » (maquette A).
  if (pathname.startsWith('/admin')) {
    return (
      <div className="min-h-screen md:flex bg-terrain font-admin zone-admin">
        <aside className="bg-nuit text-nuit-craie md:w-56 md:shrink-0 md:h-screen md:sticky md:top-0 flex flex-col gap-3 md:gap-5 p-3 md:p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-display font-bold text-2xl leading-none">
              QCM Arbitres
              <span className="block font-admin font-normal text-xs opacity-70 mt-1">Administration</span>
            </p>
            <button onClick={() => signOut()} className="md:hidden text-sm underline opacity-80 min-h-0">
              Déconnexion
            </button>
          </div>
          <AdminNav />
          <div className="hidden md:flex md:mt-auto flex-col gap-2 text-sm">
            <RoleSwitcher />
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
          <div className="md:hidden flex items-center justify-between gap-3 px-4 pt-3">
            <RoleSwitcher />
            <Link to="/mon-profil" className="text-sm text-muted underline ml-auto">
              Mon profil
            </Link>
          </div>
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
