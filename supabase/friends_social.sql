-- LearniTY — connection lists on another user's profile.
-- Run once in the Supabase SQL editor. Safe to re-run.
-- The full supabase/friends.sql already includes this function; use this
-- short file only if you have already run an earlier friends.sql.

create or replace function public.friend_social(p_user_id uuid)
returns table (
    user_id uuid,
    nickname text,
    form text,
    direction text,
    mutual boolean,
    friend_streak int,
    friend_best int,
    practiced_today boolean
)
language sql
security definer
set search_path = public
as $fn$
    with me as (select auth.uid() as uid),
    edges as (
        select f.following_id as pid, 'following' as direction
          from public.friend_follows f, me
         where f.follower_id = p_user_id
        union all
        select f.follower_id as pid, 'follower' as direction
          from public.friend_follows f, me
         where f.following_id = p_user_id
    )
    select e.pid,
        coalesce(nullif(sl.nickname, ''),
                 nullif(split_part(au.email, '@', 1), ''),
                 'Student') as nickname,
        sl.form,
        e.direction,
        (exists(select 1 from public.friend_follows f
                 where f.follower_id = p_user_id and f.following_id = e.pid)
         and exists(select 1 from public.friend_follows f
                     where f.follower_id = e.pid and f.following_id = p_user_id)) as mutual,
        case when fs.last_day is not null
                  and fs.last_day >= (now() at time zone 'Asia/Hong_Kong')::date - 1
             then fs.count else 0 end as friend_streak,
        coalesce(fs.best, 0) as friend_best,
        coalesce(us.last_practice_date = (now() at time zone 'Asia/Hong_Kong')::date, false) as practiced_today
      from edges e
      cross join me
      left join public.student_logins sl on sl.user_id = e.pid
      left join auth.users au on au.id = e.pid
      left join public.user_streaks us on us.user_id = e.pid
      left join public.friend_streaks fs
        on fs.user_a = least(e.pid, p_user_id)
       and fs.user_b = greatest(e.pid, p_user_id)
     order by e.direction, 2 asc;
$fn$;

revoke all on function public.friend_social(uuid) from public;
grant execute on function public.friend_social(uuid) to authenticated;
