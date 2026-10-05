-- =========================================================
-- RGPD (v0.6.0) : export de mes données, suppression de mon compte,
-- suppression automatique des comptes inactifs depuis plus d'un an
-- =========================================================
-- Règle de protection : un compte ADMINISTRATEUR, ou qui possède des QCM
-- ou des groupes (formateur), n'est jamais supprimé automatiquement ni
-- en un clic. Supprimer un formateur effacerait en cascade ses QCM et
-- donc les résultats de tous les arbitres concernés. Ces comptes se
-- traitent à la main (demande à l'adresse de contact RGPD).

-- ---------------------------------------------------------
-- 1) Export des données de la personne connectée
-- ---------------------------------------------------------
create or replace function public.exporter_mes_donnees()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  uid uuid := auth.uid();
  res jsonb;
begin
  if uid is null then
    raise exception 'Connexion requise';
  end if;

  select jsonb_build_object(
    'genere_le', now(),
    'compte', (
      select jsonb_build_object(
        'nom_complet', p.full_name,
        'email', p.email,
        'compte_cree_le', p.created_at,
        'derniere_connexion', u.last_sign_in_at
      )
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.id = uid
    ),
    'roles', (
      select coalesce(jsonb_agg(r.role order by r.role), '[]'::jsonb)
      from public.user_roles r
      where r.user_id = uid
    ),
    'structures', (
      select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb)
      from public.user_structures us
      join public.structures s on s.id = us.structure_id
      where us.user_id = uid
    ),
    'groupes', (
      select coalesce(jsonb_agg(g.name order by g.name), '[]'::jsonb)
      from public.group_members gm
      join public.groups g on g.id = gm.group_id
      where gm.user_id = uid
    ),
    -- La note n'est incluse que si le QCM autorise son affichage aux
    -- arbitres (réglage "show_score" du formateur).
    'resultats_qcm', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'qcm', q.title,
        'commence_le', a.started_at,
        'remis_le', a.submitted_at,
        'statut', a.status,
        'note', case when q.show_score then a.score else null end
      ) order by a.started_at), '[]'::jsonb)
      from public.quiz_attempts a
      join public.quizzes q on q.id = a.quiz_id
      where a.user_id = uid
    ),
    'reponses_donnees', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'qcm', q.title,
        'question', qu.text,
        'reponse_cochee', o.text
      ) order by a.started_at, qu.order_index), '[]'::jsonb)
      from public.quiz_attempts a
      join public.quizzes q on q.id = a.quiz_id
      join public.selected_answers sa on sa.attempt_id = a.id
      join public.questions qu on qu.id = sa.question_id
      join public.answer_options o on o.id = sa.option_id
      where a.user_id = uid
    ),
    'journal_activite', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', l.created_at,
        'action', l.action
      ) order by l.created_at), '[]'::jsonb)
      from public.activity_log l
      where l.user_id = uid
    )
  ) into res;

  return res;
end;
$$;

comment on function public.exporter_mes_donnees() is
  'Renvoie, au format JSON, toutes les données de la personne connectée (droit d''accès et de portabilité RGPD).';

revoke all on function public.exporter_mes_donnees() from public, anon;
grant execute on function public.exporter_mes_donnees() to authenticated;

-- ---------------------------------------------------------
-- 2) Suppression de MON compte (droit à l'effacement)
-- ---------------------------------------------------------
create or replace function public.supprimer_mon_compte()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mail text;
begin
  if uid is null then
    raise exception 'Connexion requise';
  end if;

  if public.has_role('admin') then
    raise exception 'Un compte administrateur ne peut pas être supprimé depuis l''application. Contacte le responsable RGPD (voir la page Confidentialité).';
  end if;

  if exists (select 1 from public.quizzes where formateur_id = uid)
     or exists (select 1 from public.groups where formateur_id = uid) then
    raise exception 'Ton compte possède des QCM ou des groupes : leur suppression effacerait aussi les résultats des arbitres. Contacte le responsable RGPD (voir la page Confidentialité) pour traiter ta demande.';
  end if;

  select email into mail from public.profiles where id = uid;

  -- Traces par adresse e-mail (invitations, structures en attente).
  delete from public.invite_queue where lower(email) = lower(mail);
  delete from public.structures_en_attente where email = lower(mail);

  -- Le journal ne garde aucun nom : l'auteur devient "Système".
  insert into public.activity_log (user_id, action)
  values (null, 'a supprimé un compte à la demande de la personne (RGPD)');

  -- Supprime le compte ; profil, rôles, résultats, appartenances partent en cascade.
  delete from auth.users where id = uid;
end;
$$;

comment on function public.supprimer_mon_compte() is
  'Supprime définitivement le compte de la personne connectée et ses données (arbitres et formateurs sans QCM ni groupe).';

revoke all on function public.supprimer_mon_compte() from public, anon;
grant execute on function public.supprimer_mon_compte() to authenticated;

-- ---------------------------------------------------------
-- 3) Comptes inactifs depuis plus d'un an
-- ---------------------------------------------------------
-- Dernière activité = la plus récente parmi : création du compte,
-- dernière connexion, dernier QCM commencé ou remis.
create or replace function public.comptes_inactifs_purgeables(p_jours integer default 365)
returns table (user_id uuid, email text, derniere_activite timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select u.id,
         u.email::text,
         greatest(u.created_at, u.last_sign_in_at, max(a.started_at), max(a.submitted_at))
  from auth.users u
  left join public.quiz_attempts a on a.user_id = u.id
  where not exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin')
    and not exists (select 1 from public.quizzes q where q.formateur_id = u.id)
    and not exists (select 1 from public.groups g where g.formateur_id = u.id)
  group by u.id, u.email, u.created_at, u.last_sign_in_at
  having greatest(u.created_at, u.last_sign_in_at, max(a.started_at), max(a.submitted_at))
         < now() - make_interval(days => p_jours);
$$;

comment on function public.comptes_inactifs_purgeables(integer) is
  'Liste (sans rien supprimer) les comptes qui seraient supprimés par la purge. Test : select * from public.comptes_inactifs_purgeables();';

revoke all on function public.comptes_inactifs_purgeables(integer) from public, anon, authenticated;

create or replace function public.purger_comptes_inactifs(p_jours integer default 365)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  -- Garde-fou contre une erreur de saisie (ex. purger_comptes_inactifs(0)).
  if p_jours < 30 then
    raise exception 'Durée minimale : 30 jours';
  end if;

  for r in select * from public.comptes_inactifs_purgeables(p_jours) loop
    delete from public.invite_queue where lower(email) = lower(r.email);
    delete from public.structures_en_attente where email = lower(r.email);
    delete from auth.users where id = r.user_id;
    n := n + 1;
  end loop;

  if n > 0 then
    insert into public.activity_log (user_id, action)
    values (null, format('a supprimé %s compte(s) inactif(s) depuis plus de %s jours (RGPD)', n, p_jours));
  end if;

  return n;
end;
$$;

comment on function public.purger_comptes_inactifs(integer) is
  'Supprime les comptes inactifs depuis plus de p_jours jours (365 par défaut). Appelée chaque nuit par pg_cron.';

revoke all on function public.purger_comptes_inactifs(integer) from public, anon, authenticated;

-- ---------------------------------------------------------
-- 4) Planification : chaque nuit à 3 h 30 (UTC)
-- ---------------------------------------------------------
-- Si l'extension pg_cron ne peut pas s'activer, le reste de la migration
-- reste appliqué : un simple message est affiché (voir les instructions).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'purge-comptes-inactifs',
    '30 3 * * *',
    'select public.purger_comptes_inactifs()'
  );
exception when others then
  raise notice 'Planification automatique non activée (%). Activer l''extension pg_cron dans Supabase > Database > Extensions puis relancer ce fichier.', sqlerrm;
end;
$$;
