import { useEffect, useState } from 'react';
import {
  DELAI_AVERTISSEMENT_MS,
  deconnexionSuspendue,
  millisecondesRestantes,
  signalerActivite,
} from '../lib/inactivite';

const EVENEMENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

// Pages où la session n'existe que le temps de choisir un mot de passe
// (lien reçu par e-mail) : pas de déconnexion automatique.
function pageSansDeconnexion() {
  return /\/(activer-mon-compte|mot-de-passe-oublie)/.test(window.location.pathname);
}

// Une vidéo ou un son en cours de lecture compte comme une activité.
function mediaEnLecture() {
  return Array.from(document.querySelectorAll('video, audio')).some(
    (m) => !(m as HTMLMediaElement).paused && !(m as HTMLMediaElement).ended
  );
}

// Surveille l'inactivité d'une personne connectée : avertissement pendant
// la dernière minute, puis déconnexion. Affiché uniquement quand une
// session existe (voir AuthProvider).
export default function DeconnexionInactivite({ onDeconnexion }: { onDeconnexion: () => void }) {
  const [secondesRestantes, setSecondesRestantes] = useState<number | null>(null);

  useEffect(() => {
    let dernierSignal = 0;
    const surActivite = () => {
      // Au plus une écriture par seconde, même si la souris bouge en continu.
      if (Date.now() - dernierSignal < 1000) return;
      dernierSignal = Date.now();
      signalerActivite();
    };
    EVENEMENTS.forEach((ev) => window.addEventListener(ev, surActivite, { capture: true, passive: true }));

    let deconnecte = false;
    const verifier = () => {
      if (deconnecte) return;
      if (deconnexionSuspendue() || pageSansDeconnexion() || mediaEnLecture()) {
        signalerActivite();
        setSecondesRestantes(null);
        return;
      }
      const reste = millisecondesRestantes();
      if (reste <= 0) {
        deconnecte = true;
        setSecondesRestantes(null);
        onDeconnexion();
      } else if (reste <= DELAI_AVERTISSEMENT_MS) {
        setSecondesRestantes(Math.ceil(reste / 1000));
      } else {
        setSecondesRestantes(null);
      }
    };
    const intervalle = setInterval(verifier, 1000);
    // Au retour sur l'onglet (ou au réveil de l'ordinateur), on vérifie
    // tout de suite, sans attendre le prochain passage.
    document.addEventListener('visibilitychange', verifier);

    return () => {
      EVENEMENTS.forEach((ev) => window.removeEventListener(ev, surActivite, { capture: true }));
      clearInterval(intervalle);
      document.removeEventListener('visibilitychange', verifier);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (secondesRestantes === null) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-ink/45 flex items-center justify-center p-4">
      <div role="alertdialog" aria-modal="true" aria-label="Déconnexion pour inactivité" className="bg-surface rounded-[14px] w-full max-w-sm p-5 text-center">
        <p className="text-sm font-medium mb-1">Toujours là ?</p>
        <p className="text-sm text-muted mb-4">
          Par sécurité, tu seras déconnecté dans {secondesRestantes} seconde{secondesRestantes > 1 ? 's' : ''} pour
          inactivité.
        </p>
        <button
          type="button"
          onClick={() => {
            signalerActivite();
            setSecondesRestantes(null);
          }}
          className="w-full bg-pitch text-white font-medium rounded py-2 text-sm"
        >
          Rester connecté
        </button>
      </div>
    </div>
  );
}
