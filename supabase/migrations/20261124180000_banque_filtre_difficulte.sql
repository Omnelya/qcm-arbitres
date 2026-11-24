-- Banque de questions : filtre par niveau de difficulté pour les formateurs (fenêtre « Piocher dans la banque »).
-- Nécessite 20261124172237_banque_questions_difficulte.sql.
-- p_difficulte : null = tous les niveaux, 'aucune' = questions non classées, sinon tres_facile | facile | moyen | difficile.
-- Le nouveau paramètre a une valeur par défaut : l'ancienne version du site continue de fonctionner.

drop function if exists public.banque_questions_liste(uuid, uuid, boolean, text, uuid, integer, integer);
drop function if exists public.banque_copier_hasard(uuid, uuid, uuid, integer);

create or replace function public.banque_questions_liste(
  p_banque uuid,
  p_theme uuid default null,
  p_sans_theme boolean default false,
  p_recherche text default null,
  p_quiz uuid default null,
  p_limite integer default 50,
  p_decalage integer default 0,
  p_difficulte text default null
)
returns table(id uuid, numero integer, text text, theme_id uuid, difficulte text, deja_dans_qcm boolean, options jsonb, total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.banque_acces(p_banque) then
    raise exception 'Non autorisé.';
  end if;

  return query
  with filtrees as (
    select q.*
    from public.banque_questions q
    where q.banque_id = p_banque
      and (p_theme is null or q.theme_id = p_theme)
      and (not p_sans_theme or q.theme_id is null)
      and (p_difficulte is null
           or (p_difficulte = 'aucune' and q.difficulte is null)
           or q.difficulte = p_difficulte)
      and (
        coalesce(btrim(p_recherche), '') = ''
        or position(lower(btrim(p_recherche)) in lower(q.text)) > 0
        or exists (
          select 1 from public.banque_options o
          where o.question_id = q.id and position(lower(btrim(p_recherche)) in lower(o.text)) > 0
        )
      )
  )
  select
    f.id, f.numero, f.text, f.theme_id, f.difficulte,
    (p_quiz is not null and exists (
      select 1 from public.questions qq where qq.quiz_id = p_quiz and qq.banque_question_id = f.id
    )),
    coalesce(
      (select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text, 'is_correct', o.is_correct) order by o.position)
       from public.banque_options o where o.question_id = f.id),
      '[]'::jsonb
    ),
    (select count(*) from filtrees)
  from filtrees f
  order by f.numero nulls last, f.created_at, f.id
  limit greatest(least(coalesce(p_limite, 50), 200), 1)
  offset greatest(coalesce(p_decalage, 0), 0);
end;
$$;

create or replace function public.banque_copier_hasard(p_quiz uuid, p_banque uuid, p_theme uuid, p_nombre integer, p_difficulte text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if not public.banque_acces(p_banque) then
    raise exception 'Non autorisé.';
  end if;
  if p_nombre is null or p_nombre < 1 then
    raise exception 'Indique un nombre de questions supérieur à 0.';
  end if;

  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_ids
  from (
    select q.id
    from public.banque_questions q
    where q.banque_id = p_banque
      and (p_theme is null or q.theme_id = p_theme)
      and (p_difficulte is null
           or (p_difficulte = 'aucune' and q.difficulte is null)
           or q.difficulte = p_difficulte)
      and not exists (select 1 from public.questions qq where qq.quiz_id = p_quiz and qq.banque_question_id = q.id)
    order by random()
    limit least(p_nombre, 200)
  ) x;

  return public.banque_copier(p_quiz, v_ids);
end;
$$;

revoke all on function public.banque_questions_liste(uuid, uuid, boolean, text, uuid, integer, integer, text) from public, anon;
revoke all on function public.banque_copier_hasard(uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.banque_questions_liste(uuid, uuid, boolean, text, uuid, integer, integer, text) to authenticated;
grant execute on function public.banque_copier_hasard(uuid, uuid, uuid, integer, text) to authenticated;
