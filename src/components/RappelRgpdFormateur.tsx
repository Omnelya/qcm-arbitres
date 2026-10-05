import { useState } from 'react';
import { Link } from 'react-router-dom';
import { REGLES_FORMATEUR } from '../lib/rgpd';

interface Props {
  onAnnuler: () => void;
  onConfirmer: () => void;
}

// Rappel des règles RGPD, affiché avant chaque création de QCM : la
// création n'est possible qu'après avoir coché la case d'engagement.
export default function RappelRgpdFormateur({ onAnnuler, onConfirmer }: Props) {
  const [coche, setCoche] = useState(false);

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rappel-rgpd-titre"
        className="bg-surface rounded-lg p-5 max-w-sm w-full"
      >
        <p id="rappel-rgpd-titre" className="text-lg font-semibold mb-2">
          Avant de créer un QCM
        </p>
        <p className="text-sm text-muted mb-3">
          Les vidéos montrent des personnes identifiables, parfois mineures. Rappel des règles :
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm mb-3">
          {REGLES_FORMATEUR.map((regle) => (
            <li key={regle}>{regle}</li>
          ))}
        </ul>
        <p className="text-sm mb-3">
          <Link to="/confidentialite" target="_blank" className="underline text-muted">
            Lire la politique de confidentialité
          </Link>
        </p>

        <label className="flex items-start gap-2 text-sm mb-4">
          <input
            type="checkbox"
            checked={coche}
            onChange={(e) => setCoche(e.target.checked)}
            className="mt-0.5"
          />
          J'ai lu ces règles et je m'engage à les respecter.
        </label>

        <div className="flex gap-2">
          <button type="button" onClick={onAnnuler} className="flex-1 border border-border rounded py-2 text-sm">
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            disabled={!coche}
            className="flex-1 bg-pitch text-white font-medium rounded py-2 text-sm disabled:opacity-50"
          >
            Créer le QCM
          </button>
        </div>
      </div>
    </div>
  );
}
