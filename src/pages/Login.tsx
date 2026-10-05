import { useState, type FormEvent, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { consommerMessageDeconnexion } from '../lib/inactivite';

export default function Login() {
  const { signIn, session, loading, roles } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [motDePasseDefini, setMotDePasseDefini] = useState(false);
  const [compteSupprime, setCompteSupprime] = useState(false);
  const [deconnecteInactivite, setDeconnecteInactivite] = useState(false);

  // Message d'explication après une déconnexion automatique.
  useEffect(() => {
    if (!loading && consommerMessageDeconnexion()) setDeconnecteInactivite(true);
  }, [loading]);

  // Une fois connecté ET les rôles chargés, on part automatiquement
  // vers le bon espace — sans dépendre d'un clic ou d'un délai fixe.
  useEffect(() => {
    if (!loading && session && roles.length > 0) {
      navigate(`/${roles[0]}`, { replace: true });
    }
  }, [loading, session, roles, navigate]);

  // Message affiché juste après une activation de compte ou une
  // réinitialisation de mot de passe (voir ActiverCompte.tsx), qui
  // redirige ici volontairement plutôt que de garder la personne connectée.
  useEffect(() => {
    const etat = location.state as { motDePasseDefini?: boolean; compteSupprime?: boolean } | null;
    if (etat?.motDePasseDefini) {
      setMotDePasseDefini(true);
      navigate(location.pathname, { replace: true, state: null });
    }
    if (etat?.compteSupprime) {
      setCompteSupprime(true);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">QCM Arbitres</h1>
        <p className="text-sm text-muted mb-6">Connecte-toi avec le compte créé par ton administrateur.</p>

        {motDePasseDefini && (
          <p className="text-sm text-pitch-dark bg-pitch-light rounded px-3 py-2 mb-4">
            Mot de passe défini avec succès. Connecte-toi pour continuer.
          </p>
        )}

        {compteSupprime && (
          <p className="text-sm text-pitch-dark bg-pitch-light rounded px-3 py-2 mb-4">
            Ton compte et tes données ont été supprimés.
          </p>
        )}

        {deconnecteInactivite && !motDePasseDefini && !compteSupprime && (
          <p className="text-sm text-card-yellow bg-card-yellow-bg rounded px-3 py-2 mb-4">
            Tu as été déconnecté après 5 minutes d'inactivité. Reconnecte-toi pour continuer.
          </p>
        )}

        <form onSubmit={handleSubmit} className="bg-surface border border-border rounded p-5">
          <label htmlFor="email" className="block text-sm text-muted mb-1">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-border rounded px-3 py-2 mb-4"
          />

          <label htmlFor="password" className="block text-sm text-muted mb-1">
            Mot de passe
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-border rounded px-3 py-2 mb-4"
          />

          {error && (
            <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-4">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-pitch text-white font-medium rounded py-2 disabled:opacity-60"
          >
            {submitting ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <Link to="/mot-de-passe-oublie" className="block text-center text-sm text-muted underline mt-4">
          Mot de passe oublié ?
        </Link>
        <Link to="/confidentialite" className="block text-center text-sm text-muted underline mt-2">
          Confidentialité et données personnelles
        </Link>
      </div>
    </div>
  );
}
