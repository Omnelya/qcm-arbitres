-- =========================================================
-- Durée d'accessibilité par défaut des QCM, réglable par chaque formateur
-- =========================================================
-- Valeur choisie dans « Mon profil » (5 jours par défaut). Elle sert à la
-- création d'un QCM (côté page) et à la duplication (ci-dessous).
-- Remplace la version « 5 jours fixes » du fichier 20261105090000.

alter table public.profiles
  add column if not exists duree_periode_jours integer not null default 5
  check (duree_periode_jours between 1 and 365);

create or replace function public.ma_duree_periode()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select duree_periode_jours from public.profiles where id = auth.uid()), 5);
$$;

create or replace function public.regler_ma_duree_periode(p_jours integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_role('formateur') or public.has_role('admin')) then
    raise exception 'Non autorisé.';
  end if;
  if p_jours is null or p_jours < 1 or p_jours > 365 then
    raise exception 'La durée doit être comprise entre 1 et 365 jours.';
  end if;
  update public.profiles set duree_periode_jours = p_jours where id = auth.uid();
end;
$$;

revoke all on function public.ma_duree_periode() from public, anon;
revoke all on function public.regler_ma_duree_periode(integer) from public, anon;
grant execute on function public.ma_duree_periode() to authenticated;
grant execute on function public.regler_ma_duree_periode(integer) to authenticated;

create or replace function public.dupliquer_qcm(p_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nouveau_id uuid;
  v_question record;
  v_nouvelle_question_id uuid;
begin
  if not exists (
    select 1 from public.quizzes q
    where q.id = p_quiz_id and (q.formateur_id = auth.uid() or public.has_role('admin'))
  ) then
    raise exception 'Non autorisé.';
  end if;

  insert into public.quizzes (
    formateur_id, title, status, time_limit_minutes,
    show_score, show_correction, show_expected_count, period_start, period_end
  )
  select
    auth.uid(), title || ' (copie)', 'draft', time_limit_minutes,
    show_score, show_correction, show_expected_count, now(), now() + make_interval(days => public.ma_duree_periode())
  from public.quizzes
  where id = p_quiz_id
  returning id into v_nouveau_id;

  insert into public.quiz_groups (quiz_id, group_id)
  select v_nouveau_id, group_id from public.quiz_groups where quiz_id = p_quiz_id;

  for v_question in select * from public.questions where quiz_id = p_quiz_id order by order_index loop
    insert into public.questions (quiz_id, type, media_url, text, explanation, order_index)
    values (v_nouveau_id, v_question.type, v_question.media_url, v_question.text, v_question.explanation, v_question.order_index)
    returning id into v_nouvelle_question_id;

    insert into public.answer_options (question_id, text, is_correct)
    select v_nouvelle_question_id, text, is_correct
    from public.answer_options where question_id = v_question.id;
  end loop;

  return v_nouveau_id;
end;
$$;

grant execute on function public.dupliquer_qcm(uuid) to authenticated;
