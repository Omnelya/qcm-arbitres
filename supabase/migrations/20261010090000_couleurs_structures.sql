-- =========================================================
-- Couleur de chaque structure (v0.7.0)
-- =========================================================
-- L'administrateur choisit une couleur par structure. Elle est affichée à
-- côté du nom de la structure partout dans l'application, et sur chaque
-- QCM (structure(s) des groupes ciblés), pour que formateurs et arbitres
-- rattachés à plusieurs structures s'y retrouvent d'un coup d'œil.

alter table public.structures
  add column color text not null default '#1F6F4A'
  check (color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.structures.color is 'Couleur de la structure (format #RRGGBB), choisie par l''administrateur.';

-- Structures déjà créées : une couleur différente pour chacune, dans
-- l'ordre de création (même palette que dans l'application).
with palette(rang, couleur) as (
  values (1, '#1F6F4A'), (2, '#2563A6'), (3, '#C0392B'), (4, '#B7791F'), (5, '#7B3FA0'),
         (6, '#0F8A8A'), (7, '#C2185B'), (8, '#5D6D2E'), (9, '#D35400'), (10, '#34495E')
),
ordre as (
  select id, ((row_number() over (order by created_at, id) - 1) % 10) + 1 as rang
  from public.structures
)
update public.structures s
set color = p.couleur
from ordre o
join palette p on p.rang = o.rang
where s.id = o.id;

-- Structure(s) de chaque QCM, déduite(s) des groupes ciblés.
-- L'admin, le créateur du QCM et les formateurs avec qui un groupe ciblé
-- est partagé voient toutes les structures du QCM ; un arbitre ne voit que
-- la ou les siennes. Seuls le nom et la couleur sont renvoyés.
create or replace function public.structures_des_qcm(p_quiz_ids uuid[])
returns table (quiz_id uuid, structure_id uuid, name text, color text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct qg.quiz_id, s.id, s.name, s.color
  from public.quiz_groups qg
  join public.groups g on g.id = qg.group_id
  join public.structures s on s.id = g.structure_id
  join public.quizzes q on q.id = qg.quiz_id
  where qg.quiz_id = any (p_quiz_ids)
    and (
      public.has_role('admin')
      or q.formateur_id = auth.uid()
      or exists (
        select 1 from public.quiz_groups qg2
        join public.group_shares gs on gs.group_id = qg2.group_id
        where qg2.quiz_id = q.id and gs.shared_with_user_id = auth.uid()
      )
      -- Arbitre : uniquement la structure des groupes dont il fait partie
      -- (un QCM commun à deux structures n'affiche que la sienne)...
      or exists (
        select 1 from public.group_members gm
        where gm.group_id = g.id and gm.user_id = auth.uid()
      )
      -- ... ou, s'il a déjà répondu puis quitté le groupe, ses propres
      -- structures parmi celles du QCM (historique).
      or (
        exists (
          select 1 from public.quiz_attempts qa
          where qa.quiz_id = q.id and qa.user_id = auth.uid()
        )
        and s.id in (select us.structure_id from public.user_structures us where us.user_id = auth.uid())
      )
    )
  order by qg.quiz_id, s.name;
$$;

revoke all on function public.structures_des_qcm(uuid[]) from public, anon;
grant execute on function public.structures_des_qcm(uuid[]) to authenticated;
