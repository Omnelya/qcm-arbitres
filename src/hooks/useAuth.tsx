import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export type AppRole = 'admin' | 'formateur' | 'arbitre';

interface Profile {
  id: string;
  email: string;
  full_name: string;
}

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  activeRole: AppRole | null;
  setActiveRole: (role: AppRole) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [activeRole, setActiveRole] = useState<AppRole | null>(null);

  async function loadProfileAndRoles(userId: string) {
    const [{ data: profileData }, { data: roleRows }] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name').eq('id', userId).single(),
      supabase.from('user_roles').select('role').eq('user_id', userId),
    ]);

    setProfile(profileData ?? null);
    const roleList = (roleRows ?? []).map((r) => r.role as AppRole);
    setRoles(roleList);
    // Un compte multi-rôle démarre sur le premier rôle disponible ;
    // la personne pourra basculer ensuite via le sélecteur de rôle.
    setActiveRole((current) => current ?? roleList[0] ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        loadProfileAndRoles(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        setLoading(true);
        loadProfileAndRoles(newSession.user.id).finally(() => setLoading(false));
      } else {
        setProfile(null);
        setRoles([]);
        setActiveRole(null);
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? traduireErreur(error.message) : null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ loading, session, profile, roles, activeRole, setActiveRole, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé à l’intérieur de <AuthProvider>');
  return ctx;
}

// Les messages d'erreur de Supabase sont en anglais : on les traduit pour
// rester cohérent avec une application pensée pour un public non-technique.
function traduireErreur(message: string): string {
  if (message.includes('Invalid login credentials')) {
    return 'E-mail ou mot de passe incorrect.';
  }
  return "Une erreur est survenue lors de la connexion. Réessaie dans un instant.";
}
