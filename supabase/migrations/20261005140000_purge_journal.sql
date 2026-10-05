-- v0.6.6 : le journal d'activité est conservé 14 jours, puis supprimé chaque nuit.
create or replace function public.purger_journal_activite(p_jours integer default 14)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_jours < 7 then
    raise exception 'Durée minimale : 7 jours';
  end if;
  delete from public.activity_log
  where created_at < now() - make_interval(days => p_jours);
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.purger_journal_activite(integer) is
  'Supprime les lignes du journal d''activité de plus de p_jours jours (14 par défaut). Appelée chaque nuit par pg_cron.';

revoke all on function public.purger_journal_activite(integer) from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'purge-journal-activite',
    '45 3 * * *',
    'select public.purger_journal_activite()'
  );
exception when others then
  raise notice 'Planification automatique non activée (%). Activer l''extension pg_cron dans Supabase > Database > Extensions puis relancer ce fichier.', sqlerrm;
end;
$$;
