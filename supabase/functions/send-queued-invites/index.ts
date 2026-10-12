// Fonction Supabase Edge Function déclenchée automatiquement par un cron
// job (Supabase > Database > Cron Jobs). Envoie UNE SEULE invitation en
// attente à chaque exécution : le débit total dépend donc entièrement de
// la fréquence de ce déclencheur, pas d'un délai codé ici.
//
// Fréquence actuelle : toutes les 2 minutes (`*/2 * * * *`), calée sur la
// limite de 30 e-mails/heure que Supabase Auth autorise une fois le SMTP
// personnalisé (Gmail) configuré — voir Authentication > Rate Limits.
// Si cette limite est un jour modifiée, ajuster la fréquence du cron en
// conséquence (ex. limite doublée à 60/h → toutes les 1 minute).
//
// Protégée par un secret (pas par une session utilisateur, puisque
// personne n'est connecté quand le déclencheur planifié s'exécute) :
// l'appelant doit fournir le même secret que celui stocké dans la
// variable d'environnement CRON_SECRET de cette fonction.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://omnelya.github.io/qcm-arbitres';

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const secretAttendu = Deno.env.get('CRON_SECRET');
  const secretRecu = req.headers.get('x-cron-secret');
  if (!secretAttendu || secretRecu !== secretAttendu) {
    return json({ error: 'Non autorisé.' }, 401);
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: rows, error: selectErr } = await supabaseAdmin
      .from('invite_queue')
      .select('id, full_name, email, roles')
      .eq('status', 'en_attente')
      .order('created_at', { ascending: true })
      .limit(1);

    if (selectErr) {
      return json({ error: selectErr.message }, 500);
    }
    if (!rows || rows.length === 0) {
      return json({ sent: 0, message: "Aucune invitation en attente." }, 200);
    }

    const invite = rows[0];

    // "Réservation" de cette ligne avant l'envoi : si deux exécutions se
    // chevauchaient, seule la première obtiendrait cette mise à jour.
    const { data: claimed } = await supabaseAdmin
      .from('invite_queue')
      .update({ status: 'en_cours' })
      .eq('id', invite.id)
      .eq('status', 'en_attente')
      .select()
      .maybeSingle();

    if (!claimed) {
      return json({ sent: 0, message: 'Rien à envoyer (déjà pris en charge).' }, 200);
    }

    const { data: created, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      invite.email,
      {
        data: { full_name: invite.full_name },
        redirectTo: `${SITE_URL}/activer-mon-compte`,
      }
    );

    if (inviteErr || !created?.user) {
      const message = inviteErr?.message ?? 'Échec inconnu.';
      // Un dépassement de quota est temporaire : on remet la ligne en
      // 'en_attente' pour que le prochain passage (30 min plus tard) la
      // reprenne automatiquement, plutôt que de l'abandonner sur 'echec'.
      const estQuotaDepasse = message.toLowerCase().includes('rate limit');
      await supabaseAdmin
        .from('invite_queue')
        .update(
          estQuotaDepasse ? { status: 'en_attente', erreur: null } : { status: 'echec', erreur: message }
        )
        .eq('id', invite.id);
      return json({ sent: 0, error: message, reessai: estQuotaDepasse }, 200);
    }

    const { error: rolesErr } = await supabaseAdmin
      .from('user_roles')
      .insert((invite.roles as string[]).map((role) => ({ user_id: created.user!.id, role })));

    await supabaseAdmin
      .from('invite_queue')
      .update({
        status: 'envoye',
        sent_at: new Date().toISOString(),
        user_id: created.user.id,
        erreur: rolesErr
          ? "Compte créé et e-mail envoyé, mais les rôles n'ont pas pu être attribués : attribue-les manuellement dans Comptes."
          : null,
      })
      .eq('id', invite.id);

    return json({ sent: 1, email: invite.email }, 200);
  } catch (_e) {
    return json({ error: 'Erreur inattendue côté serveur.' }, 500);
  }
});
