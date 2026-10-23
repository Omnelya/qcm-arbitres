-- =========================================================
-- Banque de questions (v0.13.0)
-- =========================================================
-- Une "banque" est un lot de questions préenregistrées (ex. : un test papier
-- importé depuis Excel). Règles :
--   * Seul l'administrateur crée, importe, organise (thèmes) et supprime
--     les banques, et choisit les structures qui peuvent s'en servir.
--   * Un formateur ne voit que les banques rattachées à l'une de SES
--     structures, uniquement par les fonctions ci-dessous. Les arbitres et
--     les autres formateurs n'ont AUCUN accès (pas de triche possible).
--   * Piocher une question la COPIE dans le QCM du formateur : il peut la
--     modifier sans toucher à la banque.
--   * Les thèmes sont créés plus tard par l'administrateur, par banque.

-- ---------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------
create table public.banques (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create unique index banques_name_uidx on public.banques (lower(btrim(name)));

comment on table public.banques is 'Lot de questions préenregistrées, géré par l''administrateur.';

create table public.banque_structures (
  banque_id uuid not null references public.banques (id) on delete cascade,
  structure_id uuid not null references public.structures (id) on delete cascade,
  primary key (banque_id, structure_id)
);

comment on table public.banque_structures is 'Structures dont les formateurs peuvent piocher dans la banque.';

create index banque_structures_structure_id_idx on public.banque_structures (structure_id);

create table public.banque_themes (
  id uuid primary key default gen_random_uuid(),
  banque_id uuid not null references public.banques (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (id, banque_id)
);

create unique index banque_themes_name_uidx on public.banque_themes (banque_id, lower(btrim(name)));

create table public.banque_questions (
  id uuid primary key default gen_random_uuid(),
  banque_id uuid not null references public.banques (id) on delete cascade,
  theme_id uuid,
  numero integer,
  text text not null check (length(btrim(text)) > 0),
  explanation text,
  created_at timestamptz not null default now(),
  -- le thème doit appartenir à la même banque ; supprimer un thème remet
  -- seulement theme_id à vide (les questions restent)
  foreign key (theme_id, banque_id) references public.banque_themes (id, banque_id) on delete set null (theme_id)
);

comment on column public.banque_questions.numero is 'Numéro d''origine dans le fichier importé (Q1, Q2...).';

create index banque_questions_banque_idx on public.banque_questions (banque_id, numero);
create index banque_questions_theme_idx on public.banque_questions (theme_id);

create table public.banque_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.banque_questions (id) on delete cascade,
  text text not null,
  is_correct boolean not null default false,
  position integer not null default 0
);

create index banque_options_question_idx on public.banque_options (question_id, position);

-- Origine d'une question copiée dans un QCM (évite d'ajouter deux fois la
-- même question, et sert au tirage au hasard). Si la question de la banque
-- est supprimée, la copie reste, simplement détachée.
alter table public.questions
  add column banque_question_id uuid references public.banque_questions (id) on delete set null;

create index questions_banque_question_idx on public.questions (banque_question_id);

-- ---------------------------------------------------------
-- 2) Droits : l'administrateur seulement, directement sur les tables.
--    Les formateurs passent uniquement par les fonctions (plus bas).
-- ---------------------------------------------------------
alter table public.banques enable row level security;
alter table public.banque_structures enable row level security;
alter table public.banque_themes enable row level security;
alter table public.banque_questions enable row level security;
alter table public.banque_options enable row level security;

create policy "Admin gère les banques" on public.banques
  for all using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "Admin gère les structures des banques" on public.banque_structures
  for all using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "Admin gère les thèmes" on public.banque_themes
  for all using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "Admin gère les questions de banque" on public.banque_questions
  for all using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "Admin gère les réponses de banque" on public.banque_options
  for all using (public.has_role('admin')) with check (public.has_role('admin'));

revoke all on public.banques, public.banque_structures, public.banque_themes,
  public.banque_questions, public.banque_options from anon;
grant select, insert, update, delete on public.banques, public.banque_structures,
  public.banque_themes, public.banque_questions, public.banque_options to authenticated;

-- ---------------------------------------------------------
-- 3) Fonctions
-- ---------------------------------------------------------

-- Le compte connecté peut-il utiliser cette banque ? (admin : toujours ;
-- formateur : si la banque est rattachée à l'une de ses structures)
create or replace function public.banque_acces(p_banque uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_role('admin')
    or (
      public.has_role('formateur')
      and exists (
        select 1
        from public.banque_structures bs
        join public.user_structures us on us.structure_id = bs.structure_id
        where bs.banque_id = p_banque and us.user_id = auth.uid()
      )
    );
$$;

-- Import d'une banque entière en une seule opération (tout ou rien).
-- p_questions : [{"numero": 1, "text": "...", "options": [{"text": "...", "is_correct": true}, ...]}, ...]
create or replace function public.banque_importer(p_nom text, p_structures uuid[], p_questions jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_banque uuid;
  v_q jsonb;
  v_qid uuid;
  v_o jsonb;
  v_pos integer;
begin
  if not public.has_role('admin') then
    raise exception 'Non autorisé.';
  end if;
  if p_nom is null or length(btrim(p_nom)) = 0 then
    raise exception 'Le nom de la banque est obligatoire.';
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'Aucune question à importer.';
  end if;

  insert into public.banques (name) values (btrim(p_nom)) returning id into v_banque;

  insert into public.banque_structures (banque_id, structure_id)
  select v_banque, s from unnest(coalesce(p_structures, '{}'::uuid[])) as s;

  for v_q in select * from jsonb_array_elements(p_questions) loop
    if coalesce(btrim(v_q->>'text'), '') = ''
       or jsonb_typeof(v_q->'options') is distinct from 'array'
       or jsonb_array_length(v_q->'options') < 2
       or not exists (select 1 from jsonb_array_elements(v_q->'options') o where (o->>'is_correct')::boolean)
    then
      raise exception 'Question invalide (numéro %) : texte vide, moins de 2 propositions ou aucune bonne réponse.', coalesce(v_q->>'numero', '?');
    end if;

    insert into public.banque_questions (banque_id, numero, text)
    values (v_banque, nullif(v_q->>'numero', '')::integer, btrim(v_q->>'text'))
    returning id into v_qid;

    v_pos := 0;
    for v_o in select * from jsonb_array_elements(v_q->'options') loop
      insert into public.banque_options (question_id, text, is_correct, position)
      values (v_qid, v_o->>'text', coalesce((v_o->>'is_correct')::boolean, false), v_pos);
      v_pos := v_pos + 1;
    end loop;
  end loop;

  return v_banque;
end;
$$;

-- Banques accessibles au compte connecté
create or replace function public.banque_liste()
returns table (id uuid, name text, nb_questions bigint, nb_themes bigint)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.name,
    (select count(*) from public.banque_questions q where q.banque_id = b.id),
    (select count(*) from public.banque_themes t where t.banque_id = b.id)
  from public.banques b
  where public.banque_acces(b.id)
  order by b.name;
$$;

create or replace function public.banque_themes_liste(p_banque uuid)
returns table (id uuid, name text, nb_questions bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.banque_acces(p_banque) then
    raise exception 'Non autorisé.';
  end if;
  return query
  select t.id, t.name, (select count(*) from public.banque_questions q where q.theme_id = t.id)
  from public.banque_themes t
  where t.banque_id = p_banque
  order by t.name;
end;
$$;

-- Questions d'une banque, avec recherche, thème et pagination.
-- p_sans_theme : ne garder que les questions sans thème.
-- p_quiz : si renseigné, indique quelles questions sont déjà dans ce QCM.
create or replace function public.banque_questions_liste(
  p_banque uuid,
  p_theme uuid default null,
  p_sans_theme boolean default false,
  p_recherche text default null,
  p_quiz uuid default null,
  p_limite integer default 50,
  p_decalage integer default 0
)
returns table (
  id uuid,
  numero integer,
  text text,
  theme_id uuid,
  deja_dans_qcm boolean,
  options jsonb,
  total bigint
)
language plpgsql
security definer
set search_path = public
stable
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
    f.id, f.numero, f.text, f.theme_id,
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

-- Copie des questions choisies dans un QCM (brouillon uniquement).
-- Renvoie le nombre de questions réellement ajoutées (celles déjà
-- présentes dans le QCM sont ignorées).
create or replace function public.banque_copier(p_quiz uuid, p_questions uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ordre integer;
  v_ajoutees integer := 0;
  v_bq record;
  v_qid uuid;
begin
  -- verrou sur le QCM : deux ajouts simultanés ne se marchent pas dessus
  perform 1 from public.quizzes q
    where q.id = p_quiz and (q.formateur_id = auth.uid() or public.has_role('admin'))
    for update;
  if not found then
    raise exception 'Non autorisé.';
  end if;
  if exists (select 1 from public.quizzes q where q.id = p_quiz and q.status = 'published') then
    raise exception 'Ce QCM est publié : les questions ne peuvent plus être modifiées.';
  end if;

  select coalesce(max(order_index), -1) + 1 into v_ordre from public.questions where quiz_id = p_quiz;

  for v_bq in
    select q.id, q.banque_id, q.text, q.explanation
    from unnest(p_questions) with ordinality as t(qid, ord)
    join public.banque_questions q on q.id = t.qid
    order by t.ord
  loop
    if not public.banque_acces(v_bq.banque_id) then
      raise exception 'Non autorisé.';
    end if;
    if exists (select 1 from public.questions x where x.quiz_id = p_quiz and x.banque_question_id = v_bq.id) then
      continue;
    end if;

    insert into public.questions (quiz_id, type, text, explanation, order_index, banque_question_id)
    values (p_quiz, 'text', v_bq.text, v_bq.explanation, v_ordre, v_bq.id)
    returning id into v_qid;

    insert into public.answer_options (question_id, text, is_correct)
    select v_qid, o.text, o.is_correct
    from public.banque_options o
    where o.question_id = v_bq.id
    order by o.position;

    v_ordre := v_ordre + 1;
    v_ajoutees := v_ajoutees + 1;
  end loop;

  return v_ajoutees;
end;
$$;

-- Ajout de N questions tirées au hasard (hors celles déjà dans le QCM),
-- éventuellement limitées à un thème.
create or replace function public.banque_copier_hasard(p_quiz uuid, p_banque uuid, p_theme uuid, p_nombre integer)
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
      and not exists (select 1 from public.questions qq where qq.quiz_id = p_quiz and qq.banque_question_id = q.id)
    order by random()
    limit least(p_nombre, 200)
  ) x;

  return public.banque_copier(p_quiz, v_ids);
end;
$$;

revoke all on function public.banque_acces(uuid) from public, anon;
revoke all on function public.banque_importer(text, uuid[], jsonb) from public, anon;
revoke all on function public.banque_liste() from public, anon;
revoke all on function public.banque_themes_liste(uuid) from public, anon;
revoke all on function public.banque_questions_liste(uuid, uuid, boolean, text, uuid, integer, integer) from public, anon;
revoke all on function public.banque_copier(uuid, uuid[]) from public, anon;
revoke all on function public.banque_copier_hasard(uuid, uuid, uuid, integer) from public, anon;

grant execute on function public.banque_acces(uuid) to authenticated;
grant execute on function public.banque_importer(text, uuid[], jsonb) to authenticated;
grant execute on function public.banque_liste() to authenticated;
grant execute on function public.banque_themes_liste(uuid) to authenticated;
grant execute on function public.banque_questions_liste(uuid, uuid, boolean, text, uuid, integer, integer) to authenticated;
grant execute on function public.banque_copier(uuid, uuid[]) to authenticated;
grant execute on function public.banque_copier_hasard(uuid, uuid, uuid, integer) to authenticated;
