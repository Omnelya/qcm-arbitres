import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Filet de sécurité : si la page est atteinte via un lien d'invitation ou
// de récupération de mot de passe (reconnaissable au fragment d'URL
// #...type=invite ou type=recovery), on force l'atterrissage sur la page
// d'activation — quelle que soit l'adresse de redirection réellement
// utilisée pour ce lien. Sert notamment quand un lien est renvoyé
// directement depuis le tableau de bord Supabase (qui utilise l'adresse
// du site par défaut, pas cette page précise) : sans ce filet, la
// personne se retrouverait connectée sans avoir jamais choisi de mot de
// passe, avec le risque de perdre l'accès à son compte en se déconnectant.
// Un lien mort/expiré revient aussi ici (sans "type="), pour que le
// message d'erreur clair de la page d'activation s'affiche au lieu de la
// page de connexion générique.
if (
  (location.hash.includes('type=invite') ||
    location.hash.includes('type=recovery') ||
    location.hash.includes('error=')) &&
  !/\/activer-mon-compte\/?$/.test(location.pathname)
) {
  location.replace(`${import.meta.env.BASE_URL}activer-mon-compte${location.hash}`);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
