-- Banque de questions : remonter à la banque les modifications faites dans un QCM
-- (administrateur seulement). Nécessite 20261022090000_banque_questions.sql.

-- Vrai si la question du QCM (copiée depuis la banque) diffère de celle de la banque :
-- énoncé, explication, propositions ou bonnes réponses. L'ordre des propositions est ignoré.
-- Renvoie faux pour toute personne autre qu'un administrateur (aucune information sur la banque n'est donnée).
create or replace function public.banque_difference(p_question uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bq uuid;
begin
  if not public.has_role('admin') then
    return false;
  end if;

  select q.banque_question_id into v_bq from public.questions q where q.id = p_question;
  if v_bq is null or not exists (select 1 from public.banque_questions b where b.id = v_bq) then
    return false;
  end if;

  return exists (
    select 1
    from public.questions q
    join public.banque_questions b on b.id = q.banque_question_id
    where q.id = p_question
      and (
        q.text is distinct from b.text
        or coalesce(q.explanation, '') <> coalesce(b.explanation, '')
        or array(select o.is_correct::text || o.text from public.answer_options o where o.question_id = q.id order by 1)
           <> array(select o.is_correct::text || o.text from public.banque_options o where o.question_id = b.id order by 1)
      )
  );
end;
$$;

-- Recopie dans la banque l'énoncé, l'explication et les propositions de la question du QCM.
create or replace function public.banque_mettre_a_jour(p_question uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bq uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Non autorisé.';
  end if;

  select q.banque_question_id into v_bq from public.questions q where q.id = p_question;
  if v_bq is null or not exists (select 1 from public.banque_questions b where b.id = v_bq) then
    raise exception 'Cette question ne vient pas de la banque.';
  end if;

  update public.banque_questions b
  set text = q.text, explanation = q.explanation
  from public.questions q
  where q.id = p_question and b.id = v_bq;

  delete from public.banque_options where question_id = v_bq;

  insert into public.banque_options (question_id, text, is_correct, position)
  select v_bq, o.text, o.is_correct, (row_number() over (order by o.ctid))::integer - 1
  from public.answer_options o
  where o.question_id = p_question;
end;
$$;

revoke all on function public.banque_difference(uuid) from public, anon;
revoke all on function public.banque_mettre_a_jour(uuid) from public, anon;
grant execute on function public.banque_difference(uuid) to authenticated;
grant execute on function public.banque_mettre_a_jour(uuid) to authenticated;
