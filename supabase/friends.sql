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

-- ---------- follow / unfollow ----------
create or replace function public.follow_friend(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
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
    friend_last_day date
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
        fs.last_day as friend_last_day
      from grouped g
      cross join me
      left join public.student_logins sl on sl.user_id = g.pid
      left join auth.users au on au.id = g.pid
      left join public.friend_streaks fs
        on fs.user_a = least(g.pid, me.uid)
       and fs.user_b = greatest(g.pid, me.uid)
     order by (g.following and g.follows_me) desc, 2 asc;
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

-- ---------- grants: signed-in users only ----------
revoke all on function public.follow_friend(uuid) from public;
revoke all on function public.unfollow_friend(uuid) from public;
revoke all on function public.remove_follower(uuid) from public;
revoke all on function public.friend_overview() from public;
revoke all on function public.find_friend(text) from public;
revoke all on function public.friend_public_profile(uuid) from public;
revoke all on function public.bump_friend_streaks() from public;

grant execute on function public.follow_friend(uuid) to authenticated;
grant execute on function public.unfollow_friend(uuid) to authenticated;
grant execute on function public.remove_follower(uuid) to authenticated;
grant execute on function public.friend_overview() to authenticated;
grant execute on function public.find_friend(text) to authenticated;
grant execute on function public.friend_public_profile(uuid) to authenticated;
grant execute on function public.bump_friend_streaks() to authenticated;
