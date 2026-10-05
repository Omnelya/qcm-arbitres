// Fonction Supabase Edge Function : gère les échanges sécurisés avec
// Cloudflare R2, sans que les identifiants R2 (secrets) ne transitent
// jamais par le navigateur.
// - action "upload" (par défaut) : génère un lien temporaire pour ENVOYER un fichier.
// - action "read" : génère un lien temporaire pour RELIRE un fichier déjà envoyé.
// Avant chaque opération, vérifie les quotas mensuels fixés par
// l'administrateur (offre gratuite Cloudflare R2) et refuse si dépassé.
//
// Les vérifications indépendantes (identité, réglages, usage du mois)
// sont lancées EN PARALLÈLE plutôt que les unes après les autres, pour
// réduire le temps d'attente avant que l'envoi du fichier ne commence.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { S3Client, PutObjectCommand, GetObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

class ErreurHttp extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function premierJourDuMois(): string {
  const maintenant = new Date();
  return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
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

    const supabaseCaller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const mois = premierJourDuMois();

    // Ces trois vérifications ne dépendent pas les unes des autres :
    // on les lance toutes en même temps plutôt que d'attendre chacune
    // avant de démarrer la suivante.
    const identitePromise = (async () => {
      const { data: userData, error: userErr } = await supabaseCaller.auth.getUser();
      if (userErr || !userData.user) {
        throw new ErreurHttp('Session invalide.', 401);
      }
      const { data: roleRows } = await supabaseCaller
        .from('user_roles')
        .select('role')
        .eq('user_id', userData.user.id)
        .in('role', ['formateur', 'admin']);
      if (!roleRows || roleRows.length === 0) {
        throw new ErreurHttp('Non autorisé.', 403);
      }
    })();

    const reglagesPromise = supabaseAdmin
      .from('app_settings')
      .select('key, value')
      .in('key', [
        'r2_quota_class_a_per_month',
        'r2_quota_class_b_per_month',
        'r2_quota_gb_uploaded_per_month',
      ]);

    const usagePromise = (async () => {
      let { data: usage } = await supabaseAdmin
        .from('r2_usage_monthly')
        .select('class_a_count, class_b_count, bytes_uploaded')
        .eq('month', mois)
        .maybeSingle();

      if (!usage) {
        const { data: cree } = await supabaseAdmin
          .from('r2_usage_monthly')
          .insert({ month: mois })
          .select('class_a_count, class_b_count, bytes_uploaded')
          .single();
        usage = cree ?? { class_a_count: 0, class_b_count: 0, bytes_uploaded: 0 };
      }
      return usage;
    })();

    const [, { data: reglages }, usage, body] = await Promise.all([
      identitePromise,
      reglagesPromise,
      usagePromise,
      req.json(),
    ]);

    const valeurReglage = (cle: string, defaut: number) =>
      Number(reglages?.find((r) => r.key === cle)?.value ?? defaut);

    const quotaClasseA = valeurReglage('r2_quota_class_a_per_month', 900000);
    const quotaClasseB = valeurReglage('r2_quota_class_b_per_month', 9000000);
    const quotaGoParMois = valeurReglage('r2_quota_gb_uploaded_per_month', 9);

    const action = body.action ?? 'upload';

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${Deno.env.get('R2_ACCOUNT_ID')}${Deno.env.get('R2_JURISDICTION') ? '.' + Deno.env.get('R2_JURISDICTION') : ''}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
      },
    });

    if (action === 'read') {
      if (usage.class_b_count + 1 > quotaClasseB) {
        return json(
          { error: 'Quota mensuel de lecture atteint. Contacte l’administrateur.' },
          429
        );
      }
      const { key } = body;
      if (!key) return json({ error: 'Clé manquante.' }, 400);

      const commande = new GetObjectCommand({
        Bucket: Deno.env.get('R2_BUCKET_NAME')!,
        Key: key,
      });
      const readUrl = await getSignedUrl(s3, commande, { expiresIn: 300 });

      await supabaseAdmin
        .from('r2_usage_monthly')
        .update({ class_b_count: usage.class_b_count + 1 })
        .eq('month', mois);

      return json({ readUrl }, 200);
    }

    // action === 'upload'
    const { fileType, fileExtension, fileSize } = body;
    if (!fileType || !fileExtension || typeof fileSize !== 'number') {
      return json({ error: 'Informations de fichier manquantes.' }, 400);
    }

    if (usage.class_a_count + 1 > quotaClasseA) {
      return json({ error: 'Quota mensuel d’envoi atteint. Contacte l’administrateur.' }, 429);
    }
    const quotaOctets = quotaGoParMois * 1_000_000_000;
    if (usage.bytes_uploaded + fileSize > quotaOctets) {
      return json(
        { error: 'Quota mensuel de volume envoyé (Go) atteint. Contacte l’administrateur.' },
        429
      );
    }

    const extensionSure = String(fileExtension).replace(/[^a-z0-9]/gi, '').slice(0, 10);
    const cle = `questions/${crypto.randomUUID()}.${extensionSure}`;

    const commande = new PutObjectCommand({
      Bucket: Deno.env.get('R2_BUCKET_NAME')!,
      Key: cle,
      ContentType: fileType,
    });
    const uploadUrl = await getSignedUrl(s3, commande, { expiresIn: 300 });

    await supabaseAdmin
      .from('r2_usage_monthly')
      .update({
        class_a_count: usage.class_a_count + 1,
        bytes_uploaded: usage.bytes_uploaded + fileSize,
      })
      .eq('month', mois);

    return json({ uploadUrl, key: cle }, 200);
  } catch (e) {
    if (e instanceof ErreurHttp) {
      return json({ error: e.message }, e.status);
    }
    return json({ error: 'Erreur inattendue côté serveur.' }, 500);
  }
});
