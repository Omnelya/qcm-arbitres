-- =========================================================
-- Relances par e-mail des arbitres qui n'ont pas répondu (v0.8.0)
-- =========================================================
-- Historique des relances envoyées par le formateur (ou l'admin) depuis
-- l'onglet Résultats d'un QCM. Sert à afficher « Dernière relance le … » et
-- à éviter deux relances coup sur coup (10 minutes minimum entre deux).
-- Les lignes sont écrites uniquement par la fonction serveur
-- notify-quiz-published (clé service), jamais directement par le navigateur.

create table public.quiz_relances (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  sent_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz not null default now(),
  recipients integer not null default 0
);

comment on table public.quiz_relances is 'Relances par e-mail envoyées aux arbitres n''ayant pas répondu à un QCM.';

create index quiz_relances_quiz_id_idx on public.quiz_relances (quiz_id, sent_at desc);

alter table public.quiz_relances enable row level security;

create policy "Le créateur du QCM et l'admin voient les relances"
  on public.quiz_relances for select
  using (public.has_role('admin') or public.is_quiz_owner(quiz_relances.quiz_id));

grant select on public.quiz_relances to authenticated;
