-- LearniTY Daily Paws records
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Creates:
--   my_paws_today()           -> Me profile "My look" +N Paws Today
--   admin_paw_daily(p_days)   -> teacher dashboard "🐾 Paws daily"
--   friend_paws_daily(user, n) -> friend profile "Daily Paws" chips
--
-- Requires supabase/store.sql (paw_ledger, store tables) and
-- supabase/login_tracking.sql (student_logins) to have been run already.

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

create or replace function public.friend_paws_daily(p_user_id uuid, p_days int default 7)
returns table (day date, earned int)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_days int := greatest(1, least(coalesce(p_days, 7), 31));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_start timestamptz :=
        ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Hong_Kong');
begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_user_id is null then return; end if;
    return query
    with days as (
        select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as d
    ),
    daily as (
        select (l.created_at at time zone 'Asia/Hong_Kong')::date as d,
               sum(l.amount)::int as earned
          from public.paw_ledger l
         where l.user_id = p_user_id
           and l.amount > 0
           and l.created_at >= v_start
           and (l.reason like 'practice:%' or l.reason = 'class_battle')
         group by (l.created_at at time zone 'Asia/Hong_Kong')::date
    )
    select days.d as day, coalesce(daily.earned, 0)::int as earned
      from days
      left join daily on daily.d = days.d
     order by days.d;
end;
$fn$;

create or replace function public.admin_paw_daily(p_days int default 7)
returns table (
    user_id uuid,
    email text,
    nickname text,
    form text,
    day date,
    earned int,
    spent int,
    balance int
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_days int := greatest(1, least(coalesce(p_days, 7), 31));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_start timestamptz :=
        ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Hong_Kong');
begin
    if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'tywong@lstyoungkhl.edu.hk' then
        raise exception 'NOT_ADMIN';
    end if;

    return query
    with days as (
        select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as d
    ),
    students as (
        select sl.user_id, sl.email, sl.nickname, sl.form
          from public.student_logins sl
    ),
    daily as (
        select l.user_id,
               (l.created_at at time zone 'Asia/Hong_Kong')::date as d,
               sum(case when l.amount > 0
                         and (l.reason like 'practice:%' or l.reason = 'class_battle')
                        then l.amount else 0 end)::int as earned,
               sum(case when l.amount < 0 then -l.amount else 0 end)::int as spent
          from public.paw_ledger l
         where l.created_at >= v_start
         group by l.user_id, (l.created_at at time zone 'Asia/Hong_Kong')::date
    )
    select s.user_id,
           s.email,
           s.nickname,
           s.form,
           d.d as day,
           coalesce(x.earned, 0) as earned,
           coalesce(x.spent, 0) as spent,
           coalesce((select sum(l2.amount)::int from public.paw_ledger l2
                      where l2.user_id = s.user_id), 0) as balance
      from students s
      cross join days d
      left join daily x on x.user_id = s.user_id and x.d = d.d
     order by s.form nulls last, s.email, d.d;
end;
$fn$;

revoke all on function public.friend_paws_daily(uuid, int) from public;
revoke all on function public.admin_paw_daily(int) from public;

grant execute on function public.friend_paws_daily(uuid, int) to authenticated;
grant execute on function public.admin_paw_daily(int) to authenticated;

notify pgrst, 'reload schema';
