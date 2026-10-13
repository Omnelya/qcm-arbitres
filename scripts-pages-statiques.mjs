// GitHub Pages répond « 404 » sur les adresses que seul le routeur connaît
// (ex. /login). L'iPhone en tient compte et perd l'icône. On copie donc
// index.html dans un dossier par page d'entrée : réponse 200 directe.
import { mkdirSync, copyFileSync } from 'node:fs';
for (const page of ['login', 'mot-de-passe-oublie', 'activer-mon-compte', 'confidentialite']) {
  mkdirSync(`dist/${page}`, { recursive: true });
  copyFileSync('dist/index.html', `dist/${page}/index.html`);
}
