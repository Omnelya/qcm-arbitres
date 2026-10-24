-- Réordonner les questions d'un QCM (glisser-déposer dans l'éditeur).
-- p_ordre : identifiants des questions dans le nouvel ordre. Une question du QCM absente de la liste
-- (ajoutée entre-temps) est placée à la suite, dans son ordre actuel.
create or replace function public.reordonner_questions(p_quiz uuid, p_ordre uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- verrou sur le QCM : deux réordonnancements simultanés ne se mélangent pas
  perform 1 from public.quizzes q
    where q.id = p_quiz and (q.formateur_id = auth.uid() or public.has_role('admin'))
    for update;
  if not found then
    raise exception 'Non autorisé.';
  end if;
  if exists (select 1 from public.quizzes q where q.id = p_quiz and q.status = 'published') then
    raise exception 'Ce QCM est publié : les questions ne peuvent plus être modifiées.';
  end if;
  if exists (
    select 1 from unnest(p_ordre) as t(id)
    where not exists (select 1 from public.questions x where x.id = t.id and x.quiz_id = p_quiz)
  ) then
    raise exception 'Question inconnue dans ce QCM.';
  end if;

  update public.questions q
  set order_index = s.pos
  from (
    select x.id, (row_number() over (order by coalesce(t.ord, 1000000), x.order_index, x.id))::integer - 1 as pos
    from public.questions x
    left join unnest(p_ordre) with ordinality as t(id, ord) on t.id = x.id
    where x.quiz_id = p_quiz
  ) s
  where q.id = s.id;
end;
$$;

revoke all on function public.reordonner_questions(uuid, uuid[]) from public, anon;
grant execute on function public.reordonner_questions(uuid, uuid[]) to authenticated;
