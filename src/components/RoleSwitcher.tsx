import { useNavigate } from 'react-router-dom';
import { useAuth, type AppRole } from '../hooks/useAuth';

const LABELS: Record<AppRole, string> = {
  admin: 'Administrateur',
  formateur: 'Formateur',
  arbitre: 'Arbitre',
};

export default function RoleSwitcher() {
  const { roles, activeRole, setActiveRole } = useAuth();
  const navigate = useNavigate();

  if (roles.length === 0) return null;

  // Rôle unique : simple étiquette, pas besoin de bascule cliquable.
  if (roles.length === 1) {
    return <span className="text-sm font-medium">{LABELS[roles[0]]}</span>;
  }

  function handleChange(role: AppRole) {
    setActiveRole(role);
    navigate(`/${role}`);
  }

  return (
    <div className="flex gap-1 bg-canvas border border-border rounded p-1 w-fit">
      {roles.map((role) => (
        <button
          key={role}
          onClick={() => handleChange(role)}
          className={
            'px-3 py-1.5 text-sm rounded ' +
            (activeRole === role ? 'bg-pitch text-white font-medium' : 'text-muted')
          }
        >
          {LABELS[role]}
        </button>
      ))}
    </div>
  );
}
