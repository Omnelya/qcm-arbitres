import { useNavigate } from 'react-router-dom';
import { useAuth, type AppRole } from '../hooks/useAuth';

const LABELS: Record<AppRole, string> = {
  admin: 'Administrateur',
  formateur: 'Formateur',
  arbitre: 'Arbitre',
};

// sombre : version pour l'encart vert foncé de la barre latérale.
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
          ? 'flex gap-1 bg-nuit-clair rounded p-1 w-full md:flex-col'
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
                ? 'flex-1 md:flex-none md:text-left bg-or text-nuit font-semibold'
                : 'flex-1 md:flex-none md:text-left text-nuit-craie/80 hover:bg-nuit/40'
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
