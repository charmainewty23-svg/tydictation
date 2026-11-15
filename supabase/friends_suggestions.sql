-- ============================================================
-- LearniTY — Suggested friends
-- Run after: login_tracking.sql → student_forms.sql → user_streaks.sql
--            → friends.sql (and friends_social.sql if used).
-- Safe to re-run. No new table.
--
-- Discovery is deliberately NOT based on leaderboard scores: a student who
-- has logged in but has not scored yet can still be suggested. Ranking:
--   1. follows you (follow back)
--   2. mutual friends (people you both follow)
--   3. same class code (3A / 4C …)
--   4. same form
--   5. practised in the last 7 days
--   6. new in the last 14 days
--   7. deterministic daily rotation
-- ============================================================

drop function if exists public.suggested_friends(int);

create or replace function public.suggested_friends(p_limit int default 6)
returns table (
    user_id uuid,
    nickname text,
    form text,
    class_code text,
    follows_me boolean,
    mutual_count int,
    same_class boolean,
    same_form boolean,
    last_practice date,
    streak int,
    is_new boolean
)
language sql
security definer
set search_path = public
as $fn$
    with me as (
        select auth.uid() as uid
    ),
    my as (
        select
            sl.form,
            upper(substring(coalesce(sl.nickname, '') from '^([3-6][A-Za-z])')) as class_code
          from (select 1) one
          left join public.student_logins sl on sl.user_id = (select uid from me)
    ),
    today as (
        select (now() at time zone 'Asia/Hong_Kong')::date as d
    ),
    scored as (
        select
            u.id as user_id,
            coalesce(nullif(sl.nickname, ''), nullif(split_part(u.email, '@', 1), ''), 'Student') as nickname,
            sl.form,
            upper(substring(coalesce(sl.nickname, '') from '^([3-6][A-Za-z])')) as class_code,
            exists (
                select 1 from public.friend_follows f
                 where f.follower_id = u.id and f.following_id = me.uid
            ) as follows_me,
            (
                select count(*)
                  from public.friend_follows a
                  join public.friend_follows b on b.following_id = a.following_id
                 where a.follower_id = me.uid and b.follower_id = u.id
            )::int as mutual_count,
            (
                my.class_code is not null
                and upper(substring(coalesce(sl.nickname, '') from '^([3-6][A-Za-z])')) = my.class_code
            ) as same_class,
            (
                coalesce(sl.form, '') <> ''
                and coalesce(sl.form, '') = coalesce(my.form, '')
            ) as same_form,
            us.last_practice_date as last_practice,
            case
                when us.last_practice_date is not null
                 and us.last_practice_date >= (select d from today) - 1
                then coalesce(us.streak_count, 0)
                else 0
            end as streak,
            (coalesce(us.first_seen, sl.first_login_at) > now() - interval '14 days') as is_new
          from auth.users u
          join public.student_logins sl on sl.user_id = u.id
          left join public.user_streaks us on us.user_id = u.id
          cross join me
          cross join my
         where me.uid is not null
           and u.id <> me.uid
           and u.email ilike '%@lstyoungkhl.edu.hk'
           and lower(u.email) <> 'tywong@lstyoungkhl.edu.hk'
           -- Do not suggest Unassigned students: either a form is set, or the
           -- displayed name starts with a class code (3A / 4C ...).
           and (
                coalesce(sl.form, '') <> ''
                or upper(substring(coalesce(sl.nickname, '') from '^([3-6][A-Za-z])')) is not null
           )
           -- Hide AI test accounts such as "AI 01" / ai01@...
           and upper(coalesce(sl.nickname, '')) !~ '^AI [0-9]'
           and lower(split_part(u.email, '@', 1)) !~ '^ai[0-9]'
           and not exists (
                select 1 from public.friend_follows f
                 where f.follower_id = me.uid and f.following_id = u.id
           )
    )
    select
        s.user_id,
        s.nickname,
        s.form,
        s.class_code,
        s.follows_me,
        s.mutual_count,
        s.same_class,
        s.same_form,
        s.last_practice,
        s.streak,
        s.is_new
      from scored s
     order by
        s.follows_me desc,
        s.mutual_count desc,
        s.same_class desc,
        s.same_form desc,
        (s.last_practice is not null and s.last_practice >= (select d from today) - 7) desc,
        s.is_new desc,
        md5(((select d from today)::text) || s.user_id::text)
     limit greatest(1, least(coalesce(p_limit, 6), 12));
$fn$;

revoke all on function public.suggested_friends(int) from public;
revoke all on function public.suggested_friends(int) from anon;
grant execute on function public.suggested_friends(int) to authenticated;
