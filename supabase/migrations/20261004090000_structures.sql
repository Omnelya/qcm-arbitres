-- =========================================================
-- Structures (v0.3.0)
-- =========================================================
-- Une "structure" est l'entité (district, ligue, club...) pour laquelle
-- une personne arbitre ou forme.
--   * Seul l'administrateur crée/renomme/supprime les structures et y
--     affecte les comptes. Une personne peut appartenir à plusieurs
--     structures.
--   * Un formateur ne voit que les arbitres (et formateurs) de ses
--     propres structures.
--   * Chaque groupe est créé DANS une structure précise et ne peut
--     contenir que des personnes de cette structure.
--   * Les comptes et groupes existants restent "sans structure" tant
--     qu'ils n'ont pas été affectés/rattachés.

-- ---------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------
create table public.structures (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

comment on table public.structures is 'Structure (district, ligue, club...) à laquelle l''administrateur rattache arbitres et formateurs.';

create unique index structures_name_uidx on public.structures (lower(btrim(name)));

create table public.user_structures (
  user_id uuid not null references public.profiles (id) on delete cascade,
  structure_id uuid not null references public.structures (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, structure_id)
);

comment on table public.user_structures is 'Appartenance d''un compte à une structure. Une personne peut appartenir à plusieurs structures.';

create index user_structures_structure_id_idx on public.user_structures (structure_id);

-- Structures choisies par l'admin au moment d'une invitation, en attendant
-- que le compte soit réellement créé (l'invitation est envoyée en différé).
-- Elles sont appliquées automatiquement à la création du profil (voir le
-- déclencheur plus bas).
create table public.structures_en_attente (
  email text not null,
  structure_id uuid not null references public.structures (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (email, structure_id),
  check (email = lower(email))
);

comment on table public.structures_en_attente is 'Structures à attribuer à un compte invité, dès que ce compte sera créé.';

-- Un groupe appartient à une structure. NULL = groupe créé avant la mise
-- en place des structures, à rattacher par son formateur.
-- "on delete restrict" : on ne peut pas supprimer une structure tant que
-- des groupes y sont rattachés.
alter table public.groups
  add column structure_id uuid references public.structures (id) on delete restrict;

create index groups_structure_id_idx on public.groups (structure_id);

-- ---------------------------------------------------------
-- 2) Fonctions utilitaires (security definer : évitent les boucles
--    infinies entre règles d'accès)
-- ---------------------------------------------------------
create or replace function public.mes_structures()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select structure_id from public.user_structures where user_id = auth.uid();
$$;

-- Comptes qu'un formateur a le droit de voir :
--   * les personnes de ses structures ;
--   * les membres de ses groupes (ou des groupes partagés avec lui), pour
--     que les groupes créés avant les structures restent lisibles ;
--   * les formateurs avec qui un groupe est partagé (dans un sens ou
--     l'autre) ;
--   * les arbitres ayant répondu à l'un de ses QCM (résultats).
create or replace function public.comptes_visibles_formateur()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select us2.user_id
  from public.user_structures us1
  join public.user_structures us2 on us2.structure_id = us1.structure_id
  where us1.user_id = auth.uid()
  union
  select gm.user_id
  from public.group_members gm
  join public.groups g on g.id = gm.group_id
  where g.formateur_id = auth.uid()
  union
  select gm.user_id
  from public.group_members gm
  join public.group_shares gs on gs.group_id = gm.group_id
  where gs.shared_with_user_id = auth.uid()
  union
  select g.formateur_id
  from public.groups g
  join public.group_shares gs on gs.group_id = g.id
  where gs.shared_with_user_id = auth.uid()
  union
  select gs.shared_with_user_id
  from public.group_shares gs
  join public.groups g on g.id = gs.group_id
  where g.formateur_id = auth.uid()
  union
  select qa.user_id
  from public.quiz_attempts qa
  join public.quizzes q on q.id = qa.quiz_id
  where q.formateur_id = auth.uid();
$$;

revoke all on function public.mes_structures() from public, anon;
revoke all on function public.comptes_visibles_formateur() from public, anon;
grant execute on function public.mes_structures() to authenticated;
grant execute on function public.comptes_visibles_formateur() to authenticated;

-- ---------------------------------------------------------
-- 3) Règles d'accès (RLS)
-- ---------------------------------------------------------
alter table public.structures enable row level security;

create policy "Voir ses structures, l'admin voit tout"
  on public.structures for select
  using (public.has_role('admin') or id in (select public.mes_structures()));

create policy "Seul l'admin gère les structures"
  on public.structures for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

alter table public.user_structures enable row level security;

create policy "Voir les affectations de ses structures, l'admin voit tout"
  on public.user_structures for select
  using (
    public.has_role('admin')
    or user_id = auth.uid()
    or (public.has_role('formateur') and structure_id in (select public.mes_structures()))
  );

create policy "Seul l'admin affecte les comptes aux structures"
  on public.user_structures for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

alter table public.structures_en_attente enable row level security;

create policy "Seul l'admin gère les structures en attente"
  on public.structures_en_attente for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

grant select, insert, update, delete on public.structures to authenticated;
grant select, insert, update, delete on public.user_structures to authenticated;
grant select, insert, update, delete on public.structures_en_attente to authenticated;

-- Un formateur ne voit plus TOUS les comptes, seulement ceux de ses
-- structures (voir comptes_visibles_formateur).
drop policy "Un formateur voit tous les profils (gestion groupes et QCM)" on public.profiles;

create policy "Un formateur voit les profils de ses structures"
  on public.profiles for select
  using (public.has_role('formateur') and id in (select public.comptes_visibles_formateur()));

drop policy "Un formateur voit tous les rôles (gestion des groupes et QCM)" on public.user_roles;

create policy "Un formateur voit les rôles des comptes de ses structures"
  on public.user_roles for select
  using (public.has_role('formateur') and user_id in (select public.comptes_visibles_formateur()));

-- Un nouveau groupe doit être créé dans une structure du formateur.
drop policy "Un formateur crée ses propres groupes" on public.groups;

create policy "Un formateur crée ses groupes dans l'une de ses structures"
  on public.groups for insert
  with check (
    formateur_id = auth.uid()
    and public.has_role('formateur')
    and structure_id is not null
    and structure_id in (select public.mes_structures())
  );

-- ---------------------------------------------------------
-- 4) Garde-fous (déclencheurs)
-- ---------------------------------------------------------

-- 4.a) Structure d'un groupe : définitive une fois choisie. Au premier
--      rattachement d'un ancien groupe, les membres (et les partages)
--      qui ne relèvent pas de la structure choisie sont retirés.
create or replace function public.controler_structure_groupe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.structure_id is not distinct from old.structure_id then
    return new;
  end if;

  if old.structure_id is not null then
    raise exception 'La structure d''un groupe ne peut plus être modifiée une fois choisie.';
  end if;

  if not public.has_role('admin') and not exists (
    select 1 from public.user_structures us
    where us.user_id = auth.uid() and us.structure_id = new.structure_id
  ) then
    raise exception 'Tu n''appartiens pas à cette structure.';
  end if;

  delete from public.group_members gm
  where gm.group_id = new.id
    and not exists (
      select 1 from public.user_structures us
      where us.user_id = gm.user_id and us.structure_id = new.structure_id
    );

  delete from public.group_shares gs
  where gs.group_id = new.id
    and not exists (
      select 1 from public.user_structures us
      where us.user_id = gs.shared_with_user_id and us.structure_id = new.structure_id
    );

  return new;
end;
$$;

create trigger trg_controler_structure_groupe
before update of structure_id on public.groups
for each row execute function public.controler_structure_groupe();

-- 4.b) Un groupe ne contient que des personnes de sa structure.
create or replace function public.controler_membre_groupe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_structure uuid;
begin
  select g.structure_id into v_structure from public.groups g where g.id = new.group_id;

  if v_structure is null then
    raise exception 'Ce groupe n''est rattaché à aucune structure : rattache-le d''abord à une structure.';
  end if;

  if not exists (
    select 1 from public.user_structures us
    where us.user_id = new.user_id and us.structure_id = v_structure
  ) then
    raise exception 'Cette personne n''appartient pas à la structure du groupe.';
  end if;

  return new;
end;
$$;

create trigger trg_controler_membre_groupe
before insert or update on public.group_members
for each row execute function public.controler_membre_groupe();

-- 4.c) Quand l'admin retire une personne d'une structure, elle sort
--      automatiquement des groupes de cette structure.
create or replace function public.retirer_des_groupes_de_la_structure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_members gm
  using public.groups g
  where g.id = gm.group_id
    and g.structure_id = old.structure_id
    and gm.user_id = old.user_id;

  delete from public.group_shares gs
  using public.groups g
  where g.id = gs.group_id
    and g.structure_id = old.structure_id
    and gs.shared_with_user_id = old.user_id;
  return old;
end;
$$;

create trigger trg_retirer_des_groupes_de_la_structure
after delete on public.user_structures
for each row execute function public.retirer_des_groupes_de_la_structure();

-- 4.d) Un groupe n'est partagé qu'avec un formateur de la même structure.
create or replace function public.controler_partage_groupe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_structure uuid;
begin
  select g.structure_id into v_structure from public.groups g where g.id = new.group_id;

  if v_structure is null then
    raise exception 'Ce groupe n''est rattaché à aucune structure : rattache-le d''abord à une structure.';
  end if;

  if not exists (
    select 1 from public.user_structures us
    where us.user_id = new.shared_with_user_id and us.structure_id = v_structure
  ) then
    raise exception 'Ce formateur n''appartient pas à la structure du groupe.';
  end if;

  return new;
end;
$$;

create trigger trg_controler_partage_groupe
before insert on public.group_shares
for each row execute function public.controler_partage_groupe();

-- 4.e) À la création d'un compte, application des structures choisies par
--      l'admin au moment de l'invitation.
create or replace function public.appliquer_structures_en_attente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_structures (user_id, structure_id)
  select new.id, sa.structure_id
  from public.structures_en_attente sa
  where sa.email = lower(new.email)
  on conflict do nothing;

  delete from public.structures_en_attente where email = lower(new.email);
  return new;
end;
$$;

create trigger trg_appliquer_structures_en_attente
after insert on public.profiles
for each row execute function public.appliquer_structures_en_attente();
