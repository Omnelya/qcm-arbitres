// Fonction Supabase Edge Function : gestion des comptes, réservée à
// l'administrateur. La clé secrète (SERVICE_ROLE) reste ici, côté
// serveur, et n'est jamais envoyée au navigateur.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@^9';

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Adresse de l'application, utilisée pour construire le lien d'activation
// envoyé (ou généré) lors d'une invitation. Peut être surchargée par la
// variable d'environnement SITE_URL si le nom de domaine change un jour.
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://omnelya.github.io/qcm-arbitres';

const ROLES_VALIDES = ['admin', 'formateur', 'arbitre'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Délai entre deux envois d'un même lot d'invitations. On n'envoie plus les
// e-mails via le mailer intégré de Supabase Auth (inviteUserByEmail), qui
// est plafonné à 30/heure même avec le SMTP Gmail personnalisé : on génère
// le lien d'activation (generateLink, qui ne crée le lien SANS envoyer de
// mail) puis on envoie nous-mêmes le mail en direct par SMTP, exactement
// comme notify-quiz-published — ce qui permet ce rythme de 2s, prouvé en
// production avec 60 destinataires pour cette autre fonction.
const DELAI_ENTRE_ENVOIS_MS = 2000;

function creerTransportSmtp() {
  return nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOSTNAME')!,
    port: Number(Deno.env.get('SMTP_PORT')!),
    secure: false,
    auth: {
      user: Deno.env.get('SMTP_USERNAME')!,
      pass: Deno.env.get('SMTP_PASSWORD')!,
    },
  });
}

// Même habillage visuel que supabase/email-templates/invite-user.html
// (motif "Ballon en main"), mais avec le lien d'activation en dur : on ne
// passe plus par le système de templates Go de Supabase Auth.
function construireEmailInvitationHtml(prenom: string, lienActivation: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invitation QCM Arbitres</title>
</head>
<body style="margin:0;padding:0;background:#F7F7F5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F7F5;padding:32px 16px;font-family:Inter,-apple-system,'Segoe UI',Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;">

        <tr><td style="background:#E6F0EA;padding:20px 0;text-align:center;">
          <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ballon de handball">
            <g stroke="#164F35" stroke-width="2" opacity="0.45" stroke-linecap="round">
              <line x1="4" y1="20" x2="13" y2="23"/>
              <line x1="2" y1="28" x2="12" y2="29"/>
              <line x1="4" y1="36" x2="13" y2="34"/>
            </g>
            <circle cx="35" cy="29" r="18" fill="#164F35"/>
            <path d="M21,19 Q35,12 49,19" fill="none" stroke="#E6F0EA" stroke-width="2" opacity="0.7"/>
            <path d="M23,39 Q35,45 47,39" fill="none" stroke="#0E2A1C" stroke-width="2" opacity="0.5"/>
          </svg>
        </td></tr>

        <tr><td style="padding:30px 40px 6px;text-align:center;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#C99A2E;font-weight:700;font-family:Inter,Arial,sans-serif;">Ballon en main</p>
          <h1 style="margin:0 0 14px;font-size:21px;color:#1A1D1B;font-family:Inter,Arial,sans-serif;">Bienvenue, ${prenom}</h1>
        </td></tr>

        <tr><td style="padding:0 40px 30px;text-align:center;">
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#1A1D1B;font-family:Inter,Arial,sans-serif;">Un compte a été créé pour toi sur la plateforme QCM Arbitres. Clique sur le bouton ci-dessous pour définir ton mot de passe et activer ton compte.</p>
          <a href="${lienActivation}" style="display:inline-block;background:#C99A2E;color:#1A1D1B;text-decoration:none;font-size:15px;font-weight:700;padding:12px 32px;border-radius:24px;font-family:Inter,Arial,sans-serif;">Activer mon compte</a>
        </td></tr>

        <tr><td style="padding:18px 40px;border-top:1px solid #E3E1DB;text-align:center;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6B6B64;font-family:Inter,Arial,sans-serif;">Ce lien est valable une seule fois. Si tu n'es pas à l'origine de cette demande, tu peux ignorer cet e-mail.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Traite UNE ligne de la file : génère son lien d'activation (sans mail
// natif Supabase) puis envoie nous-mêmes le mail par SMTP. Utilisée à la
// fois par le lot immédiat ci-dessous et par send-queued-invites (filet de
// sécurité), pour un comportement identique dans les deux cas.
async function genererLienEtEnvoyer(
  supabaseAdmin: ReturnType<typeof createClient>,
  transport: ReturnType<typeof nodemailer.createTransport>,
  ligne: { id: string; full_name: string; email: string; roles: string[] }
): Promise<{ ok: boolean; erreur: string | null }> {
  const { data: claimed } = await supabaseAdmin
    .from('invite_queue')
    .update({ status: 'en_cours' })
    .eq('id', ligne.id)
    .eq('status', 'en_attente')
    .select()
    .maybeSingle();

  if (!claimed) {
    return { ok: false, erreur: null };
  }

  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email: ligne.email,
    options: { data: { full_name: ligne.full_name }, redirectTo: `${SITE_URL}/activer-mon-compte` },
  });

  if (linkErr || !linkData?.user || !linkData.properties?.action_link) {
    const message = linkErr?.message ?? 'Échec de la génération du lien.';
    await supabaseAdmin.from('invite_queue').update({ status: 'echec', erreur: message }).eq('id', ligne.id);
    return { ok: false, erreur: message };
  }

  try {
    await new Promise<void>((resolve, reject) => {
      transport.sendMail(
        {
          from: `"QCM Arbitres" <${Deno.env.get('SMTP_USERNAME')}>`,
          to: ligne.email,
          subject: 'Bienvenue sur QCM Arbitres',
          html: construireEmailInvitationHtml(ligne.full_name, linkData.properties!.action_link),
        },
        (error: Error | null) => (error ? reject(error) : resolve())
      );
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from('invite_queue').update({ status: 'echec', erreur: message }).eq('id', ligne.id);
    return { ok: false, erreur: message };
  }

  const { error: rolesErr } = await supabaseAdmin
    .from('user_roles')
    .insert(ligne.roles.map((role) => ({ user_id: linkData.user!.id, role })));

  await supabaseAdmin
    .from('invite_queue')
    .update({
      status: 'envoye',
      sent_at: new Date().toISOString(),
      user_id: linkData.user!.id,
      erreur: rolesErr
        ? "Compte créé et e-mail envoyé, mais les rôles n'ont pas pu être attribués : attribue-les manuellement dans Comptes."
        : null,
    })
    .eq('id', ligne.id);

  return { ok: true, erreur: null };
}

// Envoie tout un lot en tâche de fond, espacé de DELAI_ENTRE_ENVOIS_MS,
// pendant que la réponse HTTP est déjà repartie côté admin (voir
// EdgeRuntime.waitUntil dans l'action "queue-invite" ci-dessous). Note :
// une fonction Supabase a une durée de vie maximale (150s en plan gratuit,
// 400s en payant) partagée avec ses tâches de fond ; au-delà, les derniers
// destinataires d'un très gros lot ne seraient pas traités ici — mais
// restent en 'en_attente' et seront repris par send-queued-invites
// (toutes les 2 minutes), qui sert justement de filet de sécurité pour ce
// cas.
async function envoyerLotEnArrierePlan(
  supabaseAdmin: ReturnType<typeof createClient>,
  lignes: { id: string; full_name: string; email: string; roles: string[] }[]
) {
  const transport = creerTransportSmtp();
  for (const ligne of lignes) {
    await genererLienEtEnvoyer(supabaseAdmin, transport, ligne);
    await new Promise((r) => setTimeout(r, DELAI_ENTRE_ENVOIS_MS));
  }
}

// Envoi ponctuel d'un seul lien (bouton "Renvoyer le lien par e-mail" dans
// Comptes.tsx) : contrairement au lot ci-dessus, l'admin attend la
// confirmation, donc on envoie directement (pas de tâche de fond).
// Retourne un message d'erreur si l'envoi échoue, sinon null.
async function envoyerLienParEmail(
  email: string,
  full_name: string,
  lienActivation: string
): Promise<string | null> {
  try {
    const transport = creerTransportSmtp();
    await new Promise<void>((resolve, reject) => {
      transport.sendMail(
        {
          from: `"QCM Arbitres" <${Deno.env.get('SMTP_USERNAME')}>`,
          to: email,
          subject: 'Bienvenue sur QCM Arbitres',
          html: construireEmailInvitationHtml(full_name, lienActivation),
        },
        (error: Error | null) => (error ? reject(error) : resolve())
      );
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function rolesValides(roles: unknown): roles is string[] {
  return (
    Array.isArray(roles) &&
    roles.length > 0 &&
    roles.every((r) => typeof r === 'string' && ROLES_VALIDES.includes(r))
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Non authentifié.' }, 401);
    }

    // Client "au nom de l'appelant" : sert uniquement à vérifier qui il est
    // et s'il est administrateur, en respectant les règles RLS normales.
    const supabaseCaller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await supabaseCaller.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: 'Session invalide.' }, 401);
    }

    const { data: roleRows } = await supabaseCaller
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('role', 'admin');

    if (!roleRows || roleRows.length === 0) {
      return json({ error: "Réservé à l'administrateur." }, 403);
    }

    const body = await req.json();
    const action = body.action ?? 'create';

    // Client "admin" : utilise la clé secrète, disponible uniquement ici,
    // jamais transmise au navigateur.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    if (action === 'update-password') {
      const { userId, password } = body;
      if (!userId || !password) {
        return json({ error: 'Identifiant et mot de passe requis.' }, 400);
      }
      // Même politique que côté frontend (src/lib/motDePasse.ts), dupliquée
      // ici volontairement (fonctions autonomes) : cette action passe par
      // la clé service-role (auth.admin.updateUserById), qui contourne le
      // réglage "Password Requirements" du tableau de bord Supabase — donc
      // sans cette vérification explicite, un mot de passe faible pourrait
      // être défini par ce chemin même si le réglage du dashboard est actif.
      const caracteresSpeciaux = /[!@#$%^&*()_+=[\]{};':"|<>?,./`~-]/;
      const reglesOk =
        password.length >= 8 &&
        /\p{Lu}/u.test(password) &&
        /\p{Ll}/u.test(password) &&
        /\p{N}/u.test(password) &&
        caracteresSpeciaux.test(password);
      if (!reglesOk) {
        return json(
          {
            error:
              'Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.',
          },
          400
        );
      }

      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (updateErr) {
        return json({ error: updateErr.message }, 400);
      }
      return json({ success: true }, 200);
    }

    if (action === 'delete') {
      const { userId } = body;
      if (!userId) {
        return json({ error: 'Identifiant requis.' }, 400);
      }
      if (userId === userData.user.id) {
        return json({ error: 'Tu ne peux pas supprimer ton propre compte.' }, 400);
      }

      const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (deleteErr) {
        return json({ error: deleteErr.message }, 400);
      }
      return json({ success: true }, 200);
    }

    if (action === 'queue-invite') {
      const people = Array.isArray(body.people) ? body.people : [];
      if (people.length === 0) {
        return json({ error: 'Aucune personne à mettre en file d\'attente.' }, 400);
      }

      // Validation de chaque ligne avant toute écriture, pour ne jamais
      // insérer une partie seulement du lot en cas d'erreur.
      const lignesValides: { full_name: string; email: string; roles: string[] }[] = [];
      const erreursLignes: { ligne: number; email: string; erreur: string }[] = [];

      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        const full_name = typeof p.full_name === 'string' ? p.full_name.trim() : '';
        const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
        const roles = p.roles;

        if (!full_name) {
          erreursLignes.push({ ligne: i + 1, email, erreur: 'Nom manquant.' });
          continue;
        }
        if (!email || !EMAIL_REGEX.test(email)) {
          erreursLignes.push({ ligne: i + 1, email, erreur: 'E-mail invalide.' });
          continue;
        }
        if (!rolesValides(roles)) {
          erreursLignes.push({ ligne: i + 1, email, erreur: 'Rôle manquant ou invalide (admin, formateur ou arbitre).' });
          continue;
        }
        lignesValides.push({ full_name, email, roles });
      }

      // Doublons à l'intérieur du fichier déposé.
      const emailsVus = new Set<string>();
      const lignesSansDoublonInterne = lignesValides.filter((l) => {
        if (emailsVus.has(l.email)) {
          erreursLignes.push({ ligne: 0, email: l.email, erreur: 'E-mail en double dans le fichier déposé.' });
          return false;
        }
        emailsVus.add(l.email);
        return true;
      });

      // Comptes déjà existants (requête sautée si aucune ligne valide,
      // un tableau vide passé à .in() serait rejeté par PostgREST).
      let emailsExistants = new Set<string>();
      if (lignesSansDoublonInterne.length > 0) {
        const { data: profilsExistants } = await supabaseAdmin
          .from('profiles')
          .select('email')
          .in('email', lignesSansDoublonInterne.map((l) => l.email));
        emailsExistants = new Set((profilsExistants ?? []).map((p) => p.email.toLowerCase()));
      }

      // Déjà en file d'attente.
      const { data: dejaEnAttente } = await supabaseAdmin
        .from('invite_queue')
        .select('email')
        .eq('status', 'en_attente');
      const emailsEnAttente = new Set((dejaEnAttente ?? []).map((r) => r.email.toLowerCase()));

      const aInserer = lignesSansDoublonInterne.filter((l) => {
        if (emailsExistants.has(l.email)) {
          erreursLignes.push({ ligne: 0, email: l.email, erreur: 'Un compte existe déjà avec cet e-mail.' });
          return false;
        }
        if (emailsEnAttente.has(l.email)) {
          erreursLignes.push({ ligne: 0, email: l.email, erreur: 'Déjà en file d\'attente.' });
          return false;
        }
        return true;
      });

      if (aInserer.length === 0) {
        return json({ queued: 0, erreurs: erreursLignes }, 200);
      }

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('invite_queue')
        .insert(
          aInserer.map((l) => ({
            full_name: l.full_name,
            email: l.email,
            roles: l.roles,
            created_by: userData.user.id,
          }))
        )
        .select('id, full_name, email, roles');

      if (insertErr || !inserted) {
        return json({ error: "La mise en file d'attente a échoué. Réessaie dans un instant." }, 400);
      }

      // Envoi de tout le lot en tâche de fond, espacé de 2s (voir
      // envoyerLotEnArrierePlan) : la réponse HTTP part tout de suite,
      // l'admin n'attend pas. Les lignes déjà présentes en file avant cet
      // import (emailsEnAttente) sont ignorées ici : elles seront reprises
      // par send-queued-invites, le filet de sécurité.
      EdgeRuntime.waitUntil(
        envoyerLotEnArrierePlan(
          supabaseAdmin,
          inserted as { id: string; full_name: string; email: string; roles: string[] }[]
        )
      );

      const dureeEstimeeSecondes = aInserer.length * (DELAI_ENTRE_ENVOIS_MS / 1000);

      return json(
        { queued: aInserer.length, erreurs: erreursLignes, envoiEnCours: true, dureeEstimeeSecondes },
        200
      );
    }

    if (action === 'generate-invite-link') {
      const full_name = typeof body.full_name === 'string' ? body.full_name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const roles = body.roles;
      // Si true, le lien généré est aussi envoyé directement par e-mail
      // (bouton "Renvoyer le lien par e-mail" dans Comptes.tsx) — sinon on
      // se contente de le renvoyer pour que l'admin le copie lui-même
      // (bouton "Générer un nouveau lien d'activation", comportement
      // inchangé).
      const envoyerParEmail = body.envoyerParEmail === true;

      if (!full_name || !email || !EMAIL_REGEX.test(email)) {
        return json({ error: 'Nom complet et e-mail valides requis.' }, 400);
      }
      if (!rolesValides(roles)) {
        return json({ error: 'Au moins un rôle est requis.' }, 400);
      }

      // Un compte existe-t-il déjà pour cet e-mail ? (ex. invitation
      // envoyée précédemment dont le lien a expiré ou a été perdu).
      // Supabase refuse de recréer un compte existant avec type "invite" ;
      // on génère alors un lien de type "recovery", qui fonctionne pour un
      // compte déjà existant et permet exactement la même chose : arriver
      // sur la page d'activation et choisir son mot de passe. Les rôles ne
      // sont pas réattribués dans ce cas (déjà en place depuis la première
      // invitation) ; l'admin peut les ajuster depuis la fiche du compte.
      const { data: profilExistant } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .ilike('email', email)
        .maybeSingle();

      if (profilExistant) {
        const { data: linkRenvoi, error: erreurRenvoi } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${SITE_URL}/activer-mon-compte` },
        });
        if (erreurRenvoi || !linkRenvoi?.properties?.action_link) {
          return json({ error: erreurRenvoi?.message ?? 'Échec de la génération du lien.' }, 400);
        }

        if (envoyerParEmail) {
          const erreurEnvoi = await envoyerLienParEmail(email, full_name, linkRenvoi.properties.action_link);
          return json(
            {
              id: profilExistant.id,
              link: linkRenvoi.properties.action_link,
              renvoi: true,
              envoye: !erreurEnvoi,
              erreurEnvoi,
            },
            200
          );
        }

        return json(
          { id: profilExistant.id, link: linkRenvoi.properties.action_link, renvoi: true },
          200
        );
      }

      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
          data: { full_name },
          redirectTo: `${SITE_URL}/activer-mon-compte`,
        },
      });

      if (linkErr || !linkData?.user) {
        return json({ error: traduireErreurCreation(linkErr?.message ?? 'Échec de la création.') }, 400);
      }

      const { error: rolesErr } = await supabaseAdmin
        .from('user_roles')
        .insert(roles.map((role: string) => ({ user_id: linkData.user!.id, role })));

      if (rolesErr) {
        return json({ error: 'Compte créé mais les rôles n\'ont pas pu être attribués. Attribue-les manuellement.' }, 200);
      }

      if (envoyerParEmail && linkData.properties?.action_link) {
        const erreurEnvoi = await envoyerLienParEmail(email, full_name, linkData.properties.action_link);
        return json(
          {
            id: linkData.user.id,
            link: linkData.properties.action_link,
            renvoi: false,
            envoye: !erreurEnvoi,
            erreurEnvoi,
          },
          200
        );
      }

      return json({ id: linkData.user.id, link: linkData.properties?.action_link, renvoi: false }, 200);
    }

    return json({ error: 'Action inconnue.' }, 400);
  } catch (_e) {
    return json({ error: 'Erreur inattendue côté serveur.' }, 500);
  }
});

function traduireErreurCreation(message: string): string {
  if (message.toLowerCase().includes('already') || message.toLowerCase().includes('registered')) {
    return 'Un compte existe déjà avec cet e-mail.';
  }
  return message;
}
