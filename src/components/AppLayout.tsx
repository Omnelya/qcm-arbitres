import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import RoleSwitcher from './RoleSwitcher';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();

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
