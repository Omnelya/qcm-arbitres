import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppLayout from '../components/AppLayout';
import { supabase } from '../lib/supabaseClient';
import { motDePasseValide, MESSAGE_REGLES_MOT_DE_PASSE } from '../lib/motDePasse';
import ReglesMotDePasse from '../components/ReglesMotDePasse';

export default function MonProfil() {
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState(false);

  const navigate = useNavigate();
  const [exportEnCours, setExportEnCours] = useState(false);
  const [erreurExport, setErreurExport] = useState<string | null>(null);
  const [suppressionOuverte, setSuppressionOuverte] = useState(false);
  const [confirmationSuppression, setConfirmationSuppression] = useState('');
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);

  // Code d'erreur renvoyé quand le fichier SQL de la version n'a pas encore
  // été exécuté dans Supabase (la fonction demandée n'existe pas encore).
  const FONCTION_ABSENTE = 'PGRST202';
  const MESSAGE_PAS_ACTIVE = "Cette fonction n'est pas encore activée sur le site. Réessaie plus tard.";

  async function exporterMesDonnees() {
    setErreurExport(null);
    setExportEnCours(true);
    const { data, error } = await supabase.rpc('exporter_mes_donnees');
    setExportEnCours(false);

    if (error || !data) {
      setErreurExport(
        error?.code === FONCTION_ABSENTE ? MESSAGE_PAS_ACTIVE : "L'export a échoué. Réessaie dans un instant."
      );
      return;
    }

    // Téléchargement d'un fichier .json lisible, généré dans le navigateur.
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = `mes-donnees-qcm-arbitres-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    URL.revokeObjectURL(url);
  }

  async function supprimerMonCompte() {
    setErreurSuppression(null);
    setSuppressionEnCours(true);
    const { error } = await supabase.rpc('supprimer_mon_compte');

    if (error) {
      setSuppressionEnCours(false);
      // P0001 = refus volontaire de la base, avec un message déjà rédigé en français.
      setErreurSuppression(
        error.code === 'P0001'
          ? error.message
          : error.code === FONCTION_ABSENTE
            ? MESSAGE_PAS_ACTIVE
            : 'La suppression a échoué. Réessaie dans un instant.'
      );
      return;
    }

    // Le compte n'existe plus côté serveur : on ferme seulement la session de ce navigateur.
    await supabase.auth.signOut({ scope: 'local' });
    navigate('/login', { replace: true, state: { compteSupprime: true } });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setSucces(false);

    if (!motDePasseValide(motDePasse)) {
      setErreur(MESSAGE_REGLES_MOT_DE_PASSE);
      return;
    }
    if (motDePasse !== confirmation) {
      setErreur('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setEnregistrement(true);
    const { error } = await supabase.auth.updateUser({ password: motDePasse });
    setEnregistrement(false);

    if (error) {
      setErreur("La mise à jour a échoué. Réessaie dans un instant.");
      return;
    }
    setMotDePasse('');
    setConfirmation('');
    setSucces(true);
  }

  return (
    <AppLayout>
      <h1 className="text-lg font-semibold mb-4">Mon profil</h1>
      <h2 className="text-sm font-semibold mb-2">Mon mot de passe</h2>

      <form onSubmit={handleSubmit} className="bg-surface border border-border rounded p-4">
        <label className="block text-sm text-muted mb-1">Nouveau mot de passe</label>
        <input
          type="password"
          required
          minLength={8}
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          className="w-full border border-border rounded px-3 py-2 mb-3"
        />

        <label className="block text-sm text-muted mb-1">Confirmer le mot de passe</label>
        <input
          type="password"
          required
          minLength={8}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className="w-full border border-border rounded px-3 py-2 mb-2"
        />
        <ReglesMotDePasse motDePasse={motDePasse} />

        {erreur && (
          <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-3">
            {erreur}
          </p>
        )}
        {succes && (
          <p className="text-sm text-pitch-dark bg-pitch-light rounded px-3 py-2 mb-3">
            Mot de passe mis à jour avec succès.
          </p>
        )}

        <button
          type="submit"
          disabled={enregistrement}
          className="w-full bg-pitch text-white font-medium rounded py-2 disabled:opacity-60"
        >
          {enregistrement ? 'Enregistrement…' : 'Mettre à jour le mot de passe'}
        </button>
      </form>

      <h2 className="text-sm font-semibold mt-8 mb-2">Mes données personnelles</h2>
      <div className="bg-surface border border-border rounded p-4 mb-4">
        <p className="text-sm text-muted mb-3">
          Télécharge un fichier avec toutes les données enregistrées à ton sujet.{' '}
          <Link to="/confidentialite" className="underline">
            Politique de confidentialité
          </Link>
        </p>
        {erreurExport && (
          <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-3">
            {erreurExport}
          </p>
        )}
        <button
          type="button"
          onClick={exporterMesDonnees}
          disabled={exportEnCours}
          className="w-full border border-pitch text-pitch font-medium rounded py-2 disabled:opacity-60"
        >
          {exportEnCours ? 'Préparation…' : 'Exporter mes données'}
        </button>
      </div>

      <div className="bg-surface border border-card-red rounded p-4">
        <h3 className="text-sm font-semibold text-card-red mb-1">Supprimer mon compte</h3>
        <p className="text-sm text-muted mb-3">
          Ton compte, tes résultats et tes réponses sont effacés définitivement. Cette action est
          irréversible.
        </p>

        {!suppressionOuverte ? (
          <button
            type="button"
            onClick={() => setSuppressionOuverte(true)}
            className="w-full border border-card-red text-card-red font-medium rounded py-2"
          >
            Supprimer mon compte
          </button>
        ) : (
          <div>
            <label htmlFor="confirmation-suppression" className="block text-sm text-muted mb-1">
              Pour confirmer, écris SUPPRIMER
            </label>
            <input
              id="confirmation-suppression"
              type="text"
              autoComplete="off"
              value={confirmationSuppression}
              onChange={(e) => setConfirmationSuppression(e.target.value)}
              className="w-full border border-border rounded px-3 py-2 mb-3"
            />
            {erreurSuppression && (
              <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-3">
                {erreurSuppression}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSuppressionOuverte(false);
                  setConfirmationSuppression('');
                  setErreurSuppression(null);
                }}
                disabled={suppressionEnCours}
                className="flex-1 border border-border rounded py-2 disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={supprimerMonCompte}
                disabled={suppressionEnCours || confirmationSuppression.trim().toUpperCase() !== 'SUPPRIMER'}
                className="flex-1 bg-card-red text-white font-medium rounded py-2 disabled:opacity-50"
              >
                {suppressionEnCours ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
