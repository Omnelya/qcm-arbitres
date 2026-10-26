import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

// Réinitialisation de mot de passe en libre-service, sans intervention de
// l'administrateur. Le même message s'affiche que l'e-mail saisi
// corresponde ou non à un compte existant, pour ne jamais révéler quelles
// adresses sont enregistrées dans l'application (Supabase applique déjà
// ce principe côté serveur : resetPasswordForEmail ne renvoie pas
// d'erreur différente selon que le compte existe ou non).
export default function MotDePasseOublie() {
  const [email, setEmail] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [envoye, setEnvoye] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnvoi(true);

    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}activer-mon-compte`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setEnvoi(false);

    if (error) {
      setErreur(
        error.message.toLowerCase().includes('rate limit')
          ? 'Trop de demandes ont été envoyées récemment. Réessayez dans quelques minutes.'
          : "L'envoi a échoué. Réessayez dans un instant."
      );
      return;
    }
    setEnvoye(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Mot de passe oublié</h1>
        <p className="text-sm text-muted mb-6">
          Saisissez votre e-mail : si un compte existe, un lien pour choisir un nouveau mot de passe vous
          sera envoyé.
        </p>

        {envoye ? (
          <div className="bg-surface border border-border rounded p-5 text-sm">
            <p className="mb-4">
              Si un compte existe avec cette adresse, un e-mail vient d'être envoyé. Vérifiez votre
              boîte de réception (et vos indésirables).
            </p>
            <Link to="/login" className="text-pitch underline">
              ← Retour à la connexion
            </Link>
          </div>
        ) : (
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

            {erreur && (
              <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-4">
                {erreur}
              </p>
            )}

            <button
              type="submit"
              disabled={envoi}
              className="w-full bg-pitch text-white font-medium rounded py-2 disabled:opacity-60"
            >
              {envoi ? 'Envoi…' : 'Envoyer le lien'}
            </button>

            <Link to="/login" className="block text-center text-sm text-muted underline mt-4">
              ← Retour à la connexion
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
