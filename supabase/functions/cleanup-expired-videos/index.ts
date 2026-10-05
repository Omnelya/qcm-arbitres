// Fonction Supabase Edge Function : supprime de Cloudflare R2 les vidéos
// et images des QCM expirés depuis plus longtemps que la durée de
// conservation fixée par l'administrateur (réglage "video_retention_days").
// Un fichier peut être partagé avec un QCM dupliqué encore actif : dans
// ce cas, le fichier R2 est conservé (l'autre QCM en a besoin), seule la
// référence de CETTE question est marquée comme expirée.
// Appelée automatiquement chaque jour par un GitHub Actions programmé
// (voir .github/workflows/cleanup-videos.yml), jamais depuis le navigateur.
// Protégée par un secret partagé, pas par une session utilisateur : il
// n'y a personne de connecté quand ce nettoyage se déclenche tout seul.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { S3Client, DeleteObjectCommand } from 'npm:@aws-sdk/client-s3@3';

const MARQUEUR_SUPPRIME = '__deleted__';

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const secretRecu = req.headers.get('x-cleanup-secret');
  if (!secretRecu || secretRecu !== Deno.env.get('CLEANUP_SECRET')) {
    return json({ error: 'Non autorisé.' }, 401);
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: reglage } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'video_retention_days')
      .maybeSingle();
    const retentionJours = Number(reglage?.value ?? 90);

    const dateLimite = new Date();
    dateLimite.setUTCDate(dateLimite.getUTCDate() - retentionJours);
    const dateLimiteStr = dateLimite.toISOString().slice(0, 10);

    // QCM expirés depuis plus longtemps que la durée de conservation.
    const { data: quizzesAnciens } = await supabaseAdmin
      .from('quizzes')
      .select('id')
      .lt('period_end', dateLimiteStr);

    if (!quizzesAnciens || quizzesAnciens.length === 0) {
      return json({ supprimees: 0, message: 'Aucun QCM concerné.' }, 200);
    }

    const quizIds = quizzesAnciens.map((q) => q.id);

    const { data: questionsAvecMedia } = await supabaseAdmin
      .from('questions')
      .select('id, media_url')
      .in('quiz_id', quizIds)
      .not('media_url', 'is', null)
      .neq('media_url', MARQUEUR_SUPPRIME);

    if (!questionsAvecMedia || questionsAvecMedia.length === 0) {
      return json({ supprimees: 0, message: 'Aucune vidéo à nettoyer.' }, 200);
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
    for (const question of questionsAvecMedia) {
      // Un fichier partagé avec une autre question (ex. QCM dupliqué)
      // encore valide n'est pas supprimé de R2 : on marque seulement
      // CETTE question comme expirée, sans toucher au fichier lui-même.
      const { count: encorePartage } = await supabaseAdmin
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('media_url', question.media_url)
        .neq('id', question.id);

      if (!encorePartage || encorePartage === 0) {
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: Deno.env.get('R2_BUCKET_NAME')!,
              Key: question.media_url!,
            })
          );
        } catch (_e) {
          // Le fichier sera retenté le lendemain ; on marque quand même
          // la question comme expirée pour ne pas la reproposer sans fin.
        }
      }

      await supabaseAdmin
        .from('questions')
        .update({ media_url: MARQUEUR_SUPPRIME })
        .eq('id', question.id);
      supprimees++;
    }

    return json({ supprimees }, 200);
  } catch (_e) {
    return json({ error: 'Erreur inattendue côté serveur.' }, 500);
  }
});
