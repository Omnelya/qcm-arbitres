import { useNavigate } from 'react-router-dom';
import { useAuth, type AppRole } from '../hooks/useAuth';

const LABELS: Record<AppRole, string> = {
  admin: 'Administrateur',
  formateur: 'Formateur',
  arbitre: 'Arbitre',
};

// sombre : version de l'en-tête (pastilles arrondies, maquette v3).
export default function RoleSwitcher({ sombre = false }: { sombre?: boolean }) {
  const { roles, activeRole, setActiveRole } = useAuth();
  const navigate = useNavigate();

  if (roles.length === 0) return null;

  // Rôle unique : simple étiquette, pas besoin de bascule cliquable.
  if (roles.length === 1) {
    return sombre ? null : <span className="text-sm font-medium">{LABELS[roles[0]]}</span>;
  }

  function handleChange(role: AppRole) {
    setActiveRole(role);
    navigate(`/${role}`);
  }

  return (
    <div
      role="group"
      aria-label="Choisir mon profil"
      className={
        sombre
          ? 'flex gap-1 bg-canvas rounded-full p-1 w-full md:w-auto'
          : 'flex gap-1 bg-canvas border border-border rounded p-1 w-fit'
      }
    >
      {roles.map((role) => (
        <button
          key={role}
          onClick={() => handleChange(role)}
          aria-pressed={activeRole === role}
          className={
            'px-3 py-1.5 text-sm rounded min-h-0 ' +
            (sombre
              ? activeRole === role
                ? 'flex-1 md:flex-none rounded-full px-4 bg-surface text-ink font-semibold shadow-carte'
                : 'flex-1 md:flex-none rounded-full px-4 text-muted font-semibold'
              : activeRole === role
                ? 'bg-pitch text-white font-medium'
                : 'text-muted')
          }
        >
          {LABELS[role]}
        </button>
      ))}
    </div>
  );
}
