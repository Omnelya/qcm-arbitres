-- =========================================================
-- Fin de période d'un QCM : envoi automatique des copies en cours (v0.7.5)
-- =========================================================
-- Quand la période d'un QCM se termine alors que des arbitres sont en
-- train d'y répondre :
--   * leurs réponses déjà cochées sont envoyées automatiquement (statut
--     "auto_submitted"), même s'ils ont fermé leur navigateur ;
--   * ils ne peuvent plus modifier leurs réponses.
-- Même règle à la fin du temps imparti (limite de temps du QCM).

-- Délai de tolérance (réseau) après la fin, avant de refuser une réponse.
-- La marge de 10 s au démarrage est la même que dans l'application
-- (MARGE_DEMARRAGE_MS, src/pages/arbitre/QuizAttempt.tsx).

-- 1) Calcul de la note d'une copie, sans contrôle d'identité (usage interne
--    uniquement : même calcul que submit_exam_attempt jusqu'ici).
create or replace function public.note_tentative_interne(p_attempt_id uuid)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  with tentative as (
    select quiz_id from public.quiz_attempts where id = p_attempt_id
  ),
  attendu as (
    select ao.question_id, count(*) as nb_attendu
    from public.answer_options ao
    join public.questions qu on qu.id = ao.question_id
    where qu.quiz_id = (select quiz_id from tentative) and ao.is_correct
    group by ao.question_id
  ),
  coche as (
    select question_id, count(*) as nb_coche
    from public.selected_answers
    where attempt_id = p_attempt_id
    group by question_id
  ),
  coche_correct as (
    select sa.question_id, count(*) as nb_coche_correct
    from public.selected_answers sa
    join public.answer_options ao on ao.id = sa.option_id
    where sa.attempt_id = p_attempt_id and ao.is_correct
    group by sa.question_id
  )
  select coalesce(avg(
    case
      when coalesce(a.nb_attendu, 0) = 0 then 0
      when coalesce(c.nb_coche, 0) > a.nb_attendu then 0
      else round((coalesce(cc.nb_coche_correct, 0)::numeric / a.nb_attendu::numeric) * 100, 2)
    end
  ), 0)
  from public.questions q
  left join attendu a on a.question_id = q.id
  left join coche c on c.question_id = q.id
  left join coche_correct cc on cc.question_id = q.id
  where q.quiz_id = (select quiz_id from tentative);
$$;

revoke all on function public.note_tentative_interne(uuid) from public, anon, authenticated;

-- 2) Envoi par l'arbitre (bouton "Terminer" ou envoi automatique de
--    l'application) : désormais "auto_submitted" aussi après la fin de la
--    période.
create or replace function public.submit_exam_attempt(p_attempt_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
  v_time_limit integer;
  v_started_at timestamptz;
  v_period_end timestamptz;
  v_new_status public.attempt_status;
  v_score numeric;
begin
  select qa.quiz_id, qa.started_at, q.time_limit_minutes, q.period_end
  into v_quiz_id, v_started_at, v_time_limit, v_period_end
  from public.quiz_attempts qa
  join public.quizzes q on q.id = qa.quiz_id
  where qa.id = p_attempt_id
    and qa.user_id = auth.uid()
    and qa.status = 'in_progress';

  if v_quiz_id is null then
    raise exception 'Tentative introuvable ou déjà soumise.';
  end if;

  v_new_status := case
    when now() > v_started_at + (v_time_limit || ' minutes')::interval then 'auto_submitted'
    when now() >= v_period_end then 'auto_submitted'
    else 'submitted'
  end;

  v_score := public.note_tentative_interne(p_attempt_id);

  update public.quiz_attempts
  set status = v_new_status, submitted_at = now(), score = v_score
  where id = p_attempt_id;

  return v_score;
end;
$$;

grant execute on function public.submit_exam_attempt(uuid) to authenticated;

-- 3) Plus aucune réponse modifiable après la fin (période ou temps), ni
--    après l'envoi de la copie. Ne s'applique qu'à l'arbitre lui-même :
--    les suppressions faites par l'administrateur ou par les purges
--    automatiques (suppression de compte...) ne sont pas bloquées.
create or replace function public.controler_reponse_dans_les_temps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt_id uuid := coalesce(new.attempt_id, old.attempt_id);
  v_user uuid;
  v_status public.attempt_status;
  v_fin timestamptz;
begin
  select qa.user_id, qa.status,
         least(qa.started_at + make_interval(mins => q.time_limit_minutes) + interval '10 seconds', q.period_end)
  into v_user, v_status, v_fin
  from public.quiz_attempts qa
  join public.quizzes q on q.id = qa.quiz_id
  where qa.id = v_attempt_id;

  if auth.uid() is null or v_user is distinct from auth.uid() then
    return coalesce(new, old);
  end if;

  if v_status <> 'in_progress' then
    raise exception 'Ta copie a déjà été envoyée : les réponses ne peuvent plus être modifiées.';
  end if;

  -- 30 s de tolérance pour une réponse cochée juste avant la fin.
  if now() > v_fin + interval '30 seconds' then
    raise exception 'Le temps est écoulé : les réponses ne peuvent plus être modifiées.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_controler_reponse_dans_les_temps on public.selected_answers;
create trigger trg_controler_reponse_dans_les_temps
before insert or update or delete on public.selected_answers
for each row execute function public.controler_reponse_dans_les_temps();

-- 4) Envoi automatique, chaque minute, des copies restées ouvertes après la
--    fin (arbitre qui a fermé son navigateur, perdu sa connexion...).
create or replace function public.cloturer_tentatives_expirees()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  n integer := 0;
begin
  for t in
    select qa.id
    from public.quiz_attempts qa
    join public.quizzes q on q.id = qa.quiz_id
    where qa.status = 'in_progress'
      and now() > least(
        qa.started_at + make_interval(mins => q.time_limit_minutes) + interval '10 seconds',
        q.period_end
      ) + interval '30 seconds'
    for update of qa skip locked
  loop
    update public.quiz_attempts
    set status = 'auto_submitted', submitted_at = now(), score = public.note_tentative_interne(t.id)
    where id = t.id and status = 'in_progress';
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function public.cloturer_tentatives_expirees() is
  'Envoie automatiquement les copies encore ouvertes après la fin de la période du QCM ou du temps imparti. Appelée chaque minute par pg_cron.';

revoke all on function public.cloturer_tentatives_expirees() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'cloturer-tentatives-expirees',
    '* * * * *',
    'select public.cloturer_tentatives_expirees()'
  );
exception when others then
  raise notice 'Planification automatique non activée (%). Activer l''extension pg_cron dans Supabase > Database > Extensions puis relancer ce fichier.', sqlerrm;
end;
$$;
