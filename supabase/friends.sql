-- LearniTY — friends, following / followers and friend streaks.
-- Run once in the Supabase SQL editor of the live project. Safe to re-run.
--
-- Model: following is directional. A "friend" is two accepted follows in
-- both directions (mutual). Friend streaks only grow while both mutual
-- friends practise on the same Hong Kong calendar day.
--
-- All reads go through security-definer RPCs so students never get direct
-- access to student_logins or another student's raw records.

-- ---------- follows ----------
create table if not exists public.friend_follows (
    follower_id  uuid not null references auth.users(id) on delete cascade,
    following_id uuid not null references auth.users(id) on delete cascade,
    created_at   timestamptz not null default now(),
    primary key (follower_id, following_id),
    check (follower_id <> following_id)
);
create index if not exists friend_follows_following_idx
    on public.friend_follows(following_id);

alter table public.friend_follows enable row level security;

drop policy if exists "friend follows read own" on public.friend_follows;
create policy "friend follows read own" on public.friend_follows
    for select using (auth.uid() = follower_id or auth.uid() = following_id);

drop policy if exists "friend follows add own" on public.friend_follows;
create policy "friend follows add own" on public.friend_follows
    for insert with check (auth.uid() = follower_id);

drop policy if exists "friend follows delete own" on public.friend_follows;
create policy "friend follows delete own" on public.friend_follows
    for delete using (auth.uid() = follower_id or auth.uid() = following_id);

-- ---------- mutual friend streaks ----------
create table if not exists public.friend_streaks (
    user_a     uuid not null references auth.users(id) on delete cascade,
    user_b     uuid not null references auth.users(id) on delete cascade,
    count      int not null default 0,
    best       int not null default 0,
    last_day   date,
    updated_at timestamptz not null default now(),
    primary key (user_a, user_b),
    check (user_a < user_b)
);

alter table public.friend_streaks enable row level security;

drop policy if exists "friend streaks read pair" on public.friend_streaks;
create policy "friend streaks read pair" on public.friend_streaks
    for select using (auth.uid() in (user_a, user_b));

-- ---------- streak achievements + likes ----------
create table if not exists public.streak_achievements (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    kind        text not null check (kind in ('milestone', 'record')),
    value       int not null,
    achieved_on date not null default (now() at time zone 'Asia/Hong_Kong')::date,
    created_at  timestamptz not null default now(),
    unique (user_id, kind, value)
);
create index if not exists streak_achievements_user_idx
    on public.streak_achievements(user_id, kind, value desc);

alter table public.streak_achievements enable row level security;

drop policy if exists "streak achievements read" on public.streak_achievements;
create policy "streak achievements read" on public.streak_achievements
    for select using (auth.uid() is not null);

create table if not exists public.streak_likes (
    achievement_id uuid not null references public.streak_achievements(id) on delete cascade,
    user_id        uuid not null references auth.users(id) on delete cascade,
    created_at     timestamptz not null default now(),
    primary key (achievement_id, user_id)
);
create index if not exists streak_likes_user_idx on public.streak_likes(user_id);

alter table public.streak_likes enable row level security;

drop policy if exists "streak likes read" on public.streak_likes;
create policy "streak likes read" on public.streak_likes
    for select using (auth.uid() is not null);

drop policy if exists "streak likes add own" on public.streak_likes;
create policy "streak likes add own" on public.streak_likes
    for insert with check (auth.uid() = user_id);

drop policy if exists "streak likes delete own" on public.streak_likes;
create policy "streak likes delete own" on public.streak_likes
    for delete using (auth.uid() = user_id);

-- ---------- notifications (new follower / streak like) ----------
create table if not exists public.friend_notifications (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references auth.users(id) on delete cascade,
    actor_id       uuid not null references auth.users(id) on delete cascade,
    kind           text not null check (kind in ('follow', 'like')),
    achievement_id uuid references public.streak_achievements(id) on delete cascade,
    created_at     timestamptz not null default now(),
    read_at        timestamptz
);
create index if not exists friend_notifications_user_idx
    on public.friend_notifications(user_id, created_at desc);

alter table public.friend_notifications enable row level security;

drop policy if exists "friend notifications read own" on public.friend_notifications;
create policy "friend notifications read own" on public.friend_notifications
    for select using (auth.uid() = user_id);

drop policy if exists "friend notifications mark own" on public.friend_notifications;
create policy "friend notifications mark own" on public.friend_notifications
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- follow / unfollow ----------
create or replace function public.follow_friend(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_rows int := 0;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if p_user_id is null or p_user_id = auth.uid() then
        raise exception 'INVALID_FRIEND';
    end if;
    if not exists (select 1 from auth.users u where u.id = p_user_id) then
        raise exception 'FRIEND_NOT_FOUND';
    end if;
    insert into public.friend_follows(follower_id, following_id)
    values (auth.uid(), p_user_id)
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
        insert into public.friend_notifications(user_id, actor_id, kind)
        values (p_user_id, auth.uid(), 'follow');
    end if;
end;
$fn$;

create or replace function public.unfollow_friend(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    delete from public.friend_follows
     where follower_id = auth.uid() and following_id = p_user_id;
    delete from public.friend_notifications
     where kind = 'follow'
       and user_id = p_user_id
       and actor_id = auth.uid();
end;
$fn$;

create or replace function public.remove_follower(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    delete from public.friend_follows
     where follower_id = p_user_id and following_id = auth.uid();
end;
$fn$;

-- ---------- overview for the Me page ----------
drop function if exists public.friend_overview();

create or replace function public.friend_overview()
returns table (
    user_id uuid,
    nickname text,
    form text,
    following boolean,
    follows_me boolean,
    mutual boolean,
    friend_streak int,
    friend_best int,
    friend_last_day date,
    practiced_today boolean,
    last_practice_date date
)
language sql
security definer
set search_path = public
as $fn$
    with me as (select auth.uid() as uid),
    peers as (
        select f.following_id as pid, true as following, false as follows_me
          from public.friend_follows f, me
         where f.follower_id = me.uid
        union
        select f.follower_id as pid, false as following, true as follows_me
          from public.friend_follows f, me
         where f.following_id = me.uid
    ),
    grouped as (
        select pid, bool_or(following) as following, bool_or(follows_me) as follows_me
          from peers
         group by pid
    )
    select g.pid,
        coalesce(nullif(sl.nickname, ''),
                 nullif(split_part(au.email, '@', 1), ''),
                 'Student') as nickname,
        sl.form,
        g.following,
        g.follows_me,
        (g.following and g.follows_me) as mutual,
        case when fs.last_day is not null
                  and fs.last_day >= (now() at time zone 'Asia/Hong_Kong')::date - 1
             then fs.count else 0 end as friend_streak,
        coalesce(fs.best, 0) as friend_best,
        fs.last_day as friend_last_day,
        coalesce(us.last_practice_date = (now() at time zone 'Asia/Hong_Kong')::date, false) as practiced_today,
        us.last_practice_date
      from grouped g
      cross join me
      left join public.student_logins sl on sl.user_id = g.pid
      left join auth.users au on au.id = g.pid
      left join public.user_streaks us on us.user_id = g.pid
      left join public.friend_streaks fs
        on fs.user_a = least(g.pid, me.uid)
       and fs.user_b = greatest(g.pid, me.uid)
     order by (g.following and g.follows_me) desc, 2 asc;
$fn$;

-- ---------- another user's following / follower list ----------
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

-- ---------- exact-email lookup (no directory listing) ----------
create or replace function public.find_friend(p_email text)
returns table (
    user_id uuid,
    nickname text,
    form text,
    following boolean,
    follows_me boolean
)
language sql
security definer
set search_path = public
as $fn$
    select u.id,
        coalesce(nullif(sl.nickname, ''),
                 nullif(split_part(u.email, '@', 1), ''),
                 'Student') as nickname,
        sl.form,
        exists(select 1 from public.friend_follows f
                where f.follower_id = auth.uid() and f.following_id = u.id),
        exists(select 1 from public.friend_follows f
                where f.follower_id = u.id and f.following_id = auth.uid())
      from auth.users u
      left join public.student_logins sl on sl.user_id = u.id
     where lower(u.email) = lower(trim(p_email))
     limit 1;
$fn$;

-- ---------- a friend's shareable profile ----------
create or replace function public.friend_public_profile(p_user_id uuid)
returns table (
    user_id uuid,
    nickname text,
    form text,
    recent_days jsonb,
    streak_count int,
    streak_best int,
    first_seen timestamptz,
    dict_count bigint,
    dict_accuracy numeric,
    wj_best int,
    following boolean,
    follows_me boolean,
    friend_streak int,
    friend_best int,
    friend_last_day date
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    return query
    select u.id,
        coalesce(nullif(sl.nickname, ''),
                 nullif(split_part(u.email, '@', 1), ''),
                 'Student') as nickname,
        sl.form,
        coalesce(us.recent_days, '[]'::jsonb),
        coalesce(us.streak_count, 0),
        coalesce(us.streak_best, 0),
        us.first_seen,
        (select count(*) from public.dictation_results d where d.user_id = u.id),
        (select case when sum(d.total) > 0
                     then sum(d.correct)::numeric / sum(d.total)
                     else null end
           from public.dictation_results d
          where d.user_id = u.id and d.correct is not null),
        coalesce((select l.score from public.wj_leaderboard l where l.user_id = u.id),
                 (select max(w.score) from public.wj_scores w where w.user_id = u.id),
                 0),
        exists(select 1 from public.friend_follows f
                where f.follower_id = v_me and f.following_id = u.id),
        exists(select 1 from public.friend_follows f
                where f.follower_id = u.id and f.following_id = v_me),
        case when fs.last_day is not null and fs.last_day >= v_today - 1
             then fs.count else 0 end,
        coalesce(fs.best, 0),
        fs.last_day
      from auth.users u
      left join public.student_logins sl on sl.user_id = u.id
      left join public.user_streaks us on us.user_id = u.id
      left join public.friend_streaks fs
        on fs.user_a = least(u.id, v_me)
       and fs.user_b = greatest(u.id, v_me)
     where u.id = p_user_id;
end;
$fn$;

-- ---------- grow the shared streak when both practised today ----------
create or replace function public.bump_friend_streaks()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_my_last date;
    r record;
    v_a uuid;
    v_b uuid;
    v_prev public.friend_streaks;
    v_count int;
    v_best int;
begin
    if v_me is null then return; end if;
    select last_practice_date into v_my_last
      from public.user_streaks where user_id = v_me;
    if v_my_last is distinct from v_today then return; end if;

    for r in
        select f.following_id as other
          from public.friend_follows f
         where f.follower_id = v_me
           and exists (select 1 from public.friend_follows g
                        where g.follower_id = f.following_id
                          and g.following_id = v_me)
    loop
        if not exists (select 1 from public.user_streaks s
                        where s.user_id = r.other
                          and s.last_practice_date = v_today) then
            continue;
        end if;
        v_a := least(v_me, r.other);
        v_b := greatest(v_me, r.other);
        select * into v_prev
          from public.friend_streaks
         where user_a = v_a and user_b = v_b
           for update;
        if not found then
            v_count := 1;
            v_best := 1;
        elsif v_prev.last_day = v_today then
            continue;
        elsif v_prev.last_day = v_today - 1 then
            v_count := v_prev.count + 1;
            v_best := greatest(v_prev.best, v_count);
        else
            v_count := 1;
            v_best := greatest(v_prev.best, 1);
        end if;
        insert into public.friend_streaks(user_a, user_b, count, best, last_day, updated_at)
        values (v_a, v_b, v_count, v_best, v_today, now())
        on conflict (user_a, user_b) do update
           set count = excluded.count,
               best = excluded.best,
               last_day = excluded.last_day,
               updated_at = now();
    end loop;
end;
$fn$;

-- ---------- streak achievements ----------
create or replace function public.record_streak_achievements(p_best int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_best int := greatest(0, coalesce(p_best, 0));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    n int;
begin
    if v_me is null then return; end if;
    if v_best >= 7 then
        for n in 7..v_best by 7 loop
            insert into public.streak_achievements(user_id, kind, value, achieved_on)
            values (v_me, 'milestone', n, v_today)
            on conflict (user_id, kind, value) do nothing;
        end loop;
    end if;
    if v_best > 0 then
        update public.streak_achievements
           set value = greatest(value, v_best),
               achieved_on = case when v_best > value then v_today else achieved_on end
         where user_id = v_me and kind = 'record';
        if not found then
            insert into public.streak_achievements(user_id, kind, value, achieved_on)
            values (v_me, 'record', v_best, v_today)
            on conflict (user_id, kind, value) do update
               set value = greatest(streak_achievements.value, excluded.value),
                   achieved_on = excluded.achieved_on;
        end if;
    end if;
end;
$fn$;

create or replace function public.achievement_feed(p_user_id uuid default null)
returns table (
    id uuid,
    kind text,
    value int,
    achieved_on date,
    likes int,
    liked boolean
)
language sql
security definer
set search_path = public
as $fn$
    select a.id,
        a.kind,
        a.value,
        a.achieved_on,
        (select count(*) from public.streak_likes l where l.achievement_id = a.id)::int,
        exists(select 1 from public.streak_likes l
                where l.achievement_id = a.id and l.user_id = auth.uid())
      from public.streak_achievements a
     where a.user_id = coalesce(p_user_id, auth.uid())
     order by case when a.kind = 'record' then 0 else 1 end, a.value desc;
$fn$;

create or replace function public.like_achievement(p_achievement_id uuid, p_like boolean)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_owner uuid;
    v_rows int := 0;
    v_count int := 0;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    select user_id into v_owner
      from public.streak_achievements where id = p_achievement_id;
    if v_owner is null then
        raise exception 'ACHIEVEMENT_NOT_FOUND';
    end if;
    if coalesce(p_like, true) then
        insert into public.streak_likes(achievement_id, user_id)
        values (p_achievement_id, v_me)
        on conflict do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 and v_owner <> v_me then
            insert into public.friend_notifications(user_id, actor_id, kind, achievement_id)
            values (v_owner, v_me, 'like', p_achievement_id);
        end if;
    else
        delete from public.streak_likes
         where achievement_id = p_achievement_id and user_id = v_me;
        delete from public.friend_notifications
         where kind = 'like'
           and achievement_id = p_achievement_id
           and actor_id = v_me
           and user_id = v_owner;
    end if;
    select count(*) into v_count
      from public.streak_likes where achievement_id = p_achievement_id;
    return v_count;
end;
$fn$;

-- ---------- notifications ----------
create or replace function public.friend_notification_feed()
returns table (
    id uuid,
    kind text,
    actor_name text,
    achievement_kind text,
    achievement_value int,
    created_at timestamptz,
    read_at timestamptz
)
language sql
security definer
set search_path = public
as $fn$
    select n.id,
        n.kind,
        coalesce(nullif(sl.nickname, ''),
                 nullif(split_part(au.email, '@', 1), ''),
                 'Student') as actor_name,
        a.kind as achievement_kind,
        a.value as achievement_value,
        n.created_at,
        n.read_at
      from public.friend_notifications n
      left join public.student_logins sl on sl.user_id = n.actor_id
      left join auth.users au on au.id = n.actor_id
      left join public.streak_achievements a on a.id = n.achievement_id
     where n.user_id = auth.uid()
     order by n.created_at desc
     limit 30;
$fn$;

create or replace function public.unread_notification_count()
returns int
language sql
security definer
set search_path = public
as $fn$
    select count(*)::int
      from public.friend_notifications
     where user_id = auth.uid() and read_at is null;
$fn$;

create or replace function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if auth.uid() is null then return; end if;
    update public.friend_notifications
       set read_at = now()
     where user_id = auth.uid() and read_at is null;
end;
$fn$;

-- ---------- backfill existing streak achievements ----------
insert into public.streak_achievements(user_id, kind, value, achieved_on)
select s.user_id, 'milestone', n, (now() at time zone 'Asia/Hong_Kong')::date
  from public.user_streaks s,
       generate_series(7, s.streak_best, 7) n
 where s.streak_best >= 7
on conflict do nothing;

insert into public.streak_achievements(user_id, kind, value, achieved_on)
select s.user_id, 'record', s.streak_best, (now() at time zone 'Asia/Hong_Kong')::date
  from public.user_streaks s
 where s.streak_best > 0
   and not exists (select 1 from public.streak_achievements a
                    where a.user_id = s.user_id and a.kind = 'record');

-- ---------- grants: signed-in users only ----------
revoke all on function public.follow_friend(uuid) from public;
revoke all on function public.unfollow_friend(uuid) from public;
revoke all on function public.remove_follower(uuid) from public;
revoke all on function public.friend_overview() from public;
revoke all on function public.find_friend(text) from public;
revoke all on function public.friend_social(uuid) from public;
revoke all on function public.friend_public_profile(uuid) from public;
revoke all on function public.bump_friend_streaks() from public;
revoke all on function public.record_streak_achievements(int) from public;
revoke all on function public.achievement_feed(uuid) from public;
revoke all on function public.like_achievement(uuid, boolean) from public;
revoke all on function public.friend_notification_feed() from public;
revoke all on function public.unread_notification_count() from public;
revoke all on function public.mark_notifications_read() from public;

grant execute on function public.follow_friend(uuid) to authenticated;
grant execute on function public.unfollow_friend(uuid) to authenticated;
grant execute on function public.remove_follower(uuid) to authenticated;
grant execute on function public.friend_overview() to authenticated;
grant execute on function public.find_friend(text) to authenticated;
grant execute on function public.friend_social(uuid) to authenticated;
grant execute on function public.friend_public_profile(uuid) to authenticated;
grant execute on function public.bump_friend_streaks() to authenticated;
grant execute on function public.record_streak_achievements(int) to authenticated;
grant execute on function public.achievement_feed(uuid) to authenticated;
grant execute on function public.like_achievement(uuid, boolean) to authenticated;
grant execute on function public.friend_notification_feed() to authenticated;
grant execute on function public.unread_notification_count() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
