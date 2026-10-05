// Fonction Supabase Edge Function : supprime de Cloudflare R2 les
// vidéos/images associées aux questions d'un QCM, AVANT que celui-ci ne
// soit supprimé en base. Un fichier peut être partagé avec un QCM
// dupliqué : il n'est réellement supprimé de R2 que si plus aucune
// autre question, dans un autre QCM, ne le référence encore.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { S3Client, DeleteObjectCommand } from 'npm:@aws-sdk/client-s3@3';

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

    // Vérifie que l'appelant est bien le formateur propriétaire de CE QCM,
    // ou l'administrateur — pas juste "un" formateur quelconque.
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
      .select('media_url')
      .eq('quiz_id', quizId)
      .not('media_url', 'is', null)
      .neq('media_url', MARQUEUR_SUPPRIME);

    if (!questions || questions.length === 0) {
      return json({ supprimees: 0 }, 200);
    }

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${Deno.env.get('R2_ACCOUNT_ID')}${Deno.env.get('R2_JURISDICTION') ? '.' + Deno.env.get('R2_JURISDICTION') : ''}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
      },
    });

    let supprimees = 0;
    for (const q of questions) {
      // Un même fichier peut être partagé par une question dupliquée
      // (ou l'inverse) : on ne le supprime réellement que si plus aucune
      // AUTRE question, hors ce QCM, ne le référence encore.
      const { count: encoreUtilise } = await supabaseAdmin
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('media_url', q.media_url)
        .neq('quiz_id', quizId);

      if (encoreUtilise && encoreUtilise > 0) {
        continue;
      }

      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: Deno.env.get('R2_BUCKET_NAME')!,
            Key: q.media_url!,
          })
        );
        supprimees++;
      } catch (_e) {
        // On continue avec les suivantes même si une suppression échoue :
        // la suppression du QCM lui-même ne doit pas être bloquée pour
        // autant, elle se fera juste après, côté site.
      }
    }

    // Remarque : DeleteObject est une opération GRATUITE chez Cloudflare
    // (ni Classe A ni Classe B) — elle ne doit surtout pas être comptée
    // dans class_a_count, contrairement à ce qui était fait ici avant.

    return json({ supprimees }, 200);
  } catch (_e) {
    return json({ error: 'Erreur inattendue côté serveur.' }, 500);
  }
});
