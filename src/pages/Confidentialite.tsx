import { Link } from 'react-router-dom';
import {
  CONTACT_RGPD_EMAIL,
  DERNIERE_MISE_A_JOUR,
  DUREE_INACTIVITE_MOIS,
  RESPONSABLE_NOM,
} from '../lib/rgpd';

// Page publique (accessible sans être connecté) : elle doit pouvoir être
// lue avant même de créer son compte.
export default function Confidentialite() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border px-4 py-3">
        <Link to="/" className="text-sm text-muted underline">
          ← Retour à l'application
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6 text-sm leading-relaxed">
        <div>
          <h1 className="text-xl font-semibold mb-1">Politique de confidentialité</h1>
          <p className="text-muted">QCM Arbitres · mise à jour du {DERNIERE_MISE_A_JOUR}</p>
        </div>

        <section>
          <h2 className="font-semibold mb-1">Qui est responsable de tes données ?</h2>
          <p>
            {RESPONSABLE_NOM}, éditeur de l'application. Si cette responsabilité est un jour transférée
            (par exemple à ta ligue), tu en seras informé. Pour toute question sur tes données :{' '}
            <a href={`mailto:${CONTACT_RGPD_EMAIL}`} className="underline">
              {CONTACT_RGPD_EMAIL}
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1">Pourquoi ces données sont utilisées</h2>
          <p>
            Faire passer des QCM de formation aux arbitres, et permettre aux formateurs de suivre les
            résultats. Base légale : l'intérêt légitime d'organiser et de suivre ces formations.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1">Quelles données sont enregistrées</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Nom, prénom et adresse e-mail.</li>
            <li>Ton ou tes rôles (arbitre, formateur, administrateur), tes structures et tes groupes.</li>
            <li>Les dates de connexion.</li>
            <li>Tes résultats et les réponses cochées à chaque QCM.</li>
            <li>Un journal des actions importantes (création d'un QCM, par exemple).</li>
          </ul>
          <p className="mt-2">
            Ton mot de passe est stocké sous forme chiffrée : personne, y compris l'éditeur, ne peut le
            lire. Des données techniques de connexion, comme l'adresse IP, peuvent être traitées par
            l'hébergeur à des fins de sécurité.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1">Qui peut voir tes données</h2>
          <p>
            L'administrateur de l'application, et les formateurs de tes structures pour tes résultats aux
            QCM qu'ils te destinent. Tes données ne sont ni vendues ni utilisées pour de la publicité.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1">Les prestataires techniques</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Supabase</strong> : base de données et connexion des comptes, hébergées en Irlande
              (Union européenne).
            </li>
            <li>
              <strong>Google (Gmail)</strong> : envoi des e-mails de l'application (invitation,
              réinitialisation de mot de passe, nouveau QCM).
            </li>
            <li>
              <strong>Cloudflare</strong> : stockage des vidéos des QCM.
            </li>
            <li>
              <strong>GitHub</strong> : publication du site.
            </li>
          </ul>
          <p className="mt-2">
            Supabase appartient à un groupe américain et fait appel à des sous-traitants situés aux
            États-Unis et à Singapour : certaines données peuvent donc être traitées hors de l'Union
            européenne. Ces transferts sont encadrés par les clauses contractuelles types de la
            Commission européenne.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1">Les vidéos des QCM</h2>
          <p>
            Les extraits de matchs de handball sont fournis par des clubs, la ligue, les Pôles Espoirs
            ou tout autre organisme autorisant l'exploitation des images, informés de leur usage pour la formation des arbitres. Ils montrent des matchs publics ; des
            personnes mineures, arbitres ou joueurs, peuvent y apparaître. Ces vidéos ne sont visibles que
            par les comptes connectés, servent uniquement à la formation et sont supprimées après la durée
            de conservation fixée par l'administrateur. Si tu apparais sur une vidéo, toi ou ton enfant, et
            souhaites son retrait, écris à l'adresse de contact.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1">Combien de temps elles sont conservées</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Tes données sont conservées tant que ton compte existe, résultats compris.</li>
            <li>
              Un compte sans connexion ni activité pendant {DUREE_INACTIVITE_MOIS} mois est supprimé
              automatiquement, avec toutes ses données. Les comptes d'administrateur et de formateur
              ayant créé des QCM ou des groupes sont examinés au cas par cas, pour ne pas effacer les
              résultats des autres.
            </li>
            <li>
              À la suppression d'un compte, le journal d'activité est conservé sans ton nom : l'auteur
              devient « Système ».
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold mb-1">Tes droits</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Accéder à tes données et les récupérer</strong> : bouton « Exporter mes données »
              dans la page{' '}
              <Link to="/mon-profil" className="underline">
                Mon profil
              </Link>
              .
            </li>
            <li>
              <strong>Supprimer ton compte</strong> : bouton « Supprimer mon compte » dans la même page
              (pour un compte d'administrateur ou de formateur propriétaire de QCM ou de groupes, écris à
              l'adresse de contact).
            </li>
            <li>
              <strong>Corriger une information, limiter ou t'opposer à un usage</strong> : écris à l'adresse
              de contact. Réponse sous un mois.
            </li>
            <li>
              <strong>Réclamation</strong> : tu peux saisir la CNIL (
              <a href="https://www.cnil.fr/fr/plaintes" className="underline" target="_blank" rel="noreferrer">
                cnil.fr/fr/plaintes
              </a>
              ).
            </li>
          </ul>
          <p className="mt-2 text-muted">
            Pour un QCM dont la note est masquée aux arbitres, elle n'apparaît pas dans l'export : demande-la
            à l'adresse de contact.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1">Cookies</h2>
          <p>
            L'application n'utilise que le stockage technique nécessaire pour te garder connecté. Aucun
            outil de statistiques ni de publicité n'est utilisé, donc aucun bandeau de consentement n'est
            nécessaire.
          </p>
        </section>
      </main>
    </div>
  );
}
