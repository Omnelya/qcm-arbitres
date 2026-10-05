// Fonction Supabase Edge Function : après qu'un QCM ait été dupliqué en
// base (fonction dupliquer_qcm), ses questions pointent encore vers les
// MÊMES fichiers R2 que l'original. Cette fonction copie réellement
// chaque fichier vers une nouvelle clé, et met à jour les questions de
// la copie pour qu'elles pointent vers leur propre fichier indépendant —
// sinon, supprimer l'original supprimerait aussi le média de la copie.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { S3Client, CopyObjectCommand } from 'npm:@aws-sdk/client-s3@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MARQUEUR_SUPPRIME = '__deleted__';

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

    const { data: userData, error: userErr } = await supabaseCaller.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: 'Session invalide.' }, 401);
    }

    const { quizId } = await req.json();
    if (!quizId) {
      return json({ error: 'Identifiant de QCM manquant.' }, 400);
    }

    const { data: quiz } = await supabaseAdmin
      .from('quizzes')
      .select('formateur_id')
      .eq('id', quizId)
      .single();

    const { data: roleRows } = await supabaseCaller
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('role', 'admin');
    const estAdmin = (roleRows ?? []).length > 0;

    if (!quiz || (quiz.formateur_id !== userData.user.id && !estAdmin)) {
      return json({ error: 'Non autorisé.' }, 403);
    }

    const { data: questions } = await supabaseAdmin
      .from('questions')
      .select('id, media_url')
      .eq('quiz_id', quizId)
      .not('media_url', 'is', null)
      .neq('media_url', MARQUEUR_SUPPRIME);

    if (!questions || questions.length === 0) {
      return json({ copiees: 0 }, 200);
    }

    const bucket = Deno.env.get('R2_BUCKET_NAME')!;
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${Deno.env.get('R2_ACCOUNT_ID')}${Deno.env.get('R2_JURISDICTION') ? '.' + Deno.env.get('R2_JURISDICTION') : ''}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
      },
    });

    let copiees = 0;
    for (const q of questions) {
      const ancienneCle = q.media_url!;
      const extension = ancienneCle.split('.').pop() ?? 'bin';
      const nouvelleCle = `questions/${crypto.randomUUID()}.${extension}`;

      try {
        await s3.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: nouvelleCle,
            CopySource: `${bucket}/${ancienneCle}`,
          })
        );
        await supabaseAdmin.from('questions').update({ media_url: nouvelleCle }).eq('id', q.id);
        copiees++;
      } catch (_e) {
        // Cette question précise garde son ancienne référence en cas
        // d'échec ; les autres questions continuent d'être traitées.
      }
    }

    if (copiees > 0) {
      const mois = new Date();
      const premierJour = new Date(Date.UTC(mois.getUTCFullYear(), mois.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10);
      const { data: usage } = await supabaseAdmin
        .from('r2_usage_monthly')
        .select('class_a_count')
        .eq('month', premierJour)
        .maybeSingle();
      if (usage) {
        await supabaseAdmin
          .from('r2_usage_monthly')
          .update({ class_a_count: usage.class_a_count + copiees })
          .eq('month', premierJour);
      }
    }

    return json({ copiees }, 200);
  } catch (_e) {
    return json({ error: 'Erreur inattendue côté serveur.' }, 500);
  }
});
