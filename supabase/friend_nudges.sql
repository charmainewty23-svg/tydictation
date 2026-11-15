-- ============================================================
-- LearniTY — Streak nudges between mutual friends
-- Run after: friends.sql, user_streaks.sql and login_tracking.sql.
-- Safe to re-run.
--
-- A student who just finished a practice can nudge their mutual friends
-- (both follow each other) who have NOT practised yet today. One nudge per
-- friend per Hong Kong day, so the bell does not get spammed.
-- ============================================================

-- The original table only allowed follow / like / announcement.
do $kind$
declare
    r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.friend_notifications'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%kind%'
    loop
        execute 'alter table public.friend_notifications drop constraint ' || quote_ident(r.conname);
    end loop;
end;
$kind$;

alter table public.friend_notifications
    add constraint friend_notifications_kind_check
    check (kind in ('follow', 'like', 'announcement', 'nudge'));

drop function if exists public.nudge_streak_friends();

create or replace function public.nudge_streak_friends()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me        uuid := auth.uid();
    v_today     date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_day_start timestamptz :=
        ((now() at time zone 'Asia/Hong_Kong')::date::timestamp at time zone 'Asia/Hong_Kong');
    v_count     int := 0;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    insert into public.friend_notifications (user_id, actor_id, kind, message)
    select mine.following_id,
           v_me,
           'nudge',
           'Keep your streak alive — don''t give up! 💛'
      from public.friend_follows mine
      join public.friend_follows theirs
        on theirs.follower_id = mine.following_id
       and theirs.following_id = v_me
     where mine.follower_id = v_me
       and mine.following_id <> v_me
       and not exists (
            select 1
              from public.user_streaks s
             where s.user_id = mine.following_id
               and s.last_practice_date = v_today
       )
       and not exists (
            select 1
              from public.friend_notifications n
             where n.user_id = mine.following_id
               and n.actor_id = v_me
               and n.kind = 'nudge'
               and n.created_at >= v_day_start
       );

    get diagnostics v_count = row_count;
    return v_count;
end;
$fn$;

revoke all on function public.nudge_streak_friends() from public;
revoke all on function public.nudge_streak_friends() from anon;
grant execute on function public.nudge_streak_friends() to authenticated;
