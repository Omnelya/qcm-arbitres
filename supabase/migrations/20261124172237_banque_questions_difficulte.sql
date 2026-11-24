-- Banque de questions : niveau de difficulté de chaque question (déjà appliqué en base le 24/11/2026).
alter table public.banque_questions
  add column if not exists difficulte text
  check (difficulte in ('tres_facile','facile','moyen','difficile'));
comment on column public.banque_questions.difficulte is 'Niveau de difficulté : tres_facile (jeunes 9-15 ans), facile, moyen, difficile. Null = non classée.';
