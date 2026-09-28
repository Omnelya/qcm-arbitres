-- =========================================================
-- Dernière connexion de chaque compte (onglet Comptes de l'admin)
-- =========================================================
-- La date de dernière connexion est lue directement dans la table
-- interne de Supabase (auth.users.last_sign_in_at), qui n'est mise à
-- jour qu'à une vraie connexion (mot de passe, lien magique...), et non
-- à chaque rechargement de page. Cette table n'étant pas lisible depuis
-- l'application, on passe par une fonction réservée à l'administrateur.

create or replace function public.admin_dernieres_connexions()
returns table (user_id uuid, last_sign_in_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Accès réservé à l''administrateur';
  end if;

  return query
    select u.id, u.last_sign_in_at
    from auth.users u;
end;
$$;

comment on function public.admin_dernieres_connexions() is
  'Renvoie la date de dernière connexion de chaque compte. Réservée à l''administrateur.';

revoke all on function public.admin_dernieres_connexions() from public, anon;
grant execute on function public.admin_dernieres_connexions() to authenticated;
