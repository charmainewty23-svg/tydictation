-- LearniTY: fix "Me → My look → +N 🐾 Today" staying at 0.
-- The client calls my_paws_today(); older installs ran store.sql before this
-- function existed, so the RPC returned 404 and the UI fell back to 0.
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Requires supabase/store.sql (paw_ledger).

create or replace function public.my_paws_today()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_day_start timestamptz :=
        ((now() at time zone 'Asia/Hong_Kong')::date::timestamp at time zone 'Asia/Hong_Kong');
    v_total int := 0;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    select coalesce(sum(amount), 0)::int into v_total
      from public.paw_ledger
     where user_id = v_me
       and amount > 0
       and created_at >= v_day_start
       and (reason like 'practice:%' or reason = 'class_battle');
    return v_total;
end;
$fn$;

revoke all on function public.my_paws_today() from public;
grant execute on function public.my_paws_today() to authenticated;

notify pgrst, 'reload schema';
