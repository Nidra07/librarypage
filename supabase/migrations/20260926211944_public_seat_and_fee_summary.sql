create or replace function public.get_public_library_info()
returns table (seat_count bigint, monthly_fee numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.seats),
    (select s.monthly_fee from public.library_settings s where s.singleton);
$$;
revoke execute on function public.get_public_library_info() from public;
grant execute on function public.get_public_library_info() to anon, authenticated;
