-- ============================================================
-- LearnITY Dictation — Word Jump Challenge friends rooms
-- Run once in Supabase → SQL Editor (project mggnwzirjmibreimrwiq)
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
-- Safe to re-run.
--
-- Live presence (x/y/vx/vy/score/height/colour) is updated by each member on
-- their own row. Room create / join / start / leave / finish go through
-- security-definer RPCs. Guests and teacher-preview sessions must not
-- call these from the browser.
-- ============================================================

-- Reused by the battle SQL; defined here so this file can be pasted alone.
create or replace function public.is_teacher()
returns boolean
language sql
stable
as $wjc$
    select coalesce(auth.jwt() ->> 'email', '') = 'tywong@lstyoungkhl.edu.hk';
$wjc$;

create table if not exists public.wj_challenge_rooms (
    id             uuid primary key default gen_random_uuid(),
    code           text not null unique,
    topic          text not null default '__all__',
    seed           bigint not null,
    host_id        uuid not null references auth.users(id) on delete cascade,
    status         text not null default 'waiting'
                   check (status in ('waiting', 'playing', 'finished')),
    duel_type      text
                   check (duel_type is null or duel_type in ('last_standing', 'target_score')),
    target_score   int not null default 3000,
    max_players    int not null default 8,
    started_at     timestamptz,
    finished_at    timestamptz,
    winner_id      uuid,
    result_reason  text,
    created_at     timestamptz not null default now()
);

create table if not exists public.wj_challenge_players (
    room_id     uuid not null references public.wj_challenge_rooms(id) on delete cascade,
    user_id     uuid not null references auth.users(id) on delete cascade,
    email       text,
    nickname    text,
    color       text not null default 'lime',
    score       int not null default 0,
    height      int not null default 0,
    x           double precision not null default 200,
    y           double precision not null default 0,
    vx          double precision not null default 0,
    vy          double precision not null default 0,
    face        int not null default 1,
    fallen      boolean not null default false,
    reached_at  timestamptz,
    left_at     timestamptz,
    last_seen   timestamptz not null default now(),
    primary key (room_id, user_id)
);

create index if not exists wj_challenge_rooms_created_idx
    on public.wj_challenge_rooms (created_at desc);
create index if not exists wj_challenge_rooms_code_idx
    on public.wj_challenge_rooms (code);
create index if not exists wj_challenge_players_room_idx
    on public.wj_challenge_players (room_id);

alter table public.wj_challenge_rooms   add column if not exists topic          text not null default '__all__';
alter table public.wj_challenge_rooms   add column if not exists seed           bigint;
alter table public.wj_challenge_rooms   add column if not exists host_id        uuid;
alter table public.wj_challenge_rooms   add column if not exists status         text not null default 'waiting';
alter table public.wj_challenge_rooms   add column if not exists duel_type      text;
alter table public.wj_challenge_rooms   add column if not exists target_score   int not null default 3000;
alter table public.wj_challenge_rooms   add column if not exists max_players    int not null default 8;
alter table public.wj_challenge_rooms   add column if not exists started_at     timestamptz;
alter table public.wj_challenge_rooms   add column if not exists finished_at    timestamptz;
alter table public.wj_challenge_rooms   add column if not exists winner_id      uuid;
alter table public.wj_challenge_rooms   add column if not exists result_reason  text;
alter table public.wj_challenge_players add column if not exists color          text not null default 'lime';
alter table public.wj_challenge_players add column if not exists score          int not null default 0;
alter table public.wj_challenge_players add column if not exists height         int not null default 0;
alter table public.wj_challenge_players add column if not exists x              double precision not null default 200;
alter table public.wj_challenge_players add column if not exists y              double precision not null default 0;
alter table public.wj_challenge_players add column if not exists vx             double precision not null default 0;
alter table public.wj_challenge_players add column if not exists vy             double precision not null default 0;
alter table public.wj_challenge_players add column if not exists face           int not null default 1;
alter table public.wj_challenge_players add column if not exists fallen         boolean not null default false;
alter table public.wj_challenge_players add column if not exists reached_at     timestamptz;
alter table public.wj_challenge_players add column if not exists left_at        timestamptz;
alter table public.wj_challenge_players add column if not exists last_seen      timestamptz not null default now();

-- ---------- membership helper (security definer: no RLS recursion) ----------

create or replace function public.is_wj_challenge_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $wjc$
    select exists (
        select 1 from public.wj_challenge_rooms r
        where r.id = p_room_id
          and (
              r.host_id = auth.uid()
              or exists (
                  select 1 from public.wj_challenge_players p
                   where p.room_id = r.id and p.user_id = auth.uid()
              )
          )
    );
$wjc$;

-- ---------- RLS ----------

alter table public.wj_challenge_rooms   enable row level security;
alter table public.wj_challenge_players enable row level security;

drop policy if exists "wj challenge rooms read members"  on public.wj_challenge_rooms;
drop policy if exists "wj challenge rooms read teacher"  on public.wj_challenge_rooms;
drop policy if exists "wj challenge players read members" on public.wj_challenge_players;
drop policy if exists "wj challenge players read teacher" on public.wj_challenge_players;
drop policy if exists "wj challenge players update own"   on public.wj_challenge_players;

create policy "wj challenge rooms read members" on public.wj_challenge_rooms
    for select using (public.is_wj_challenge_member(id));

create policy "wj challenge rooms read teacher" on public.wj_challenge_rooms
    for select using (public.is_teacher());

create policy "wj challenge players read members" on public.wj_challenge_players
    for select using (public.is_wj_challenge_member(room_id));

create policy "wj challenge players read teacher" on public.wj_challenge_players
    for select using (public.is_teacher());

-- A member may only change their own presence, colour, score and height.
create policy "wj challenge players update own" on public.wj_challenge_players
    for update
    using (user_id = auth.uid() and public.is_wj_challenge_member(room_id))
    with check (user_id = auth.uid() and public.is_wj_challenge_member(room_id));

grant select on public.wj_challenge_rooms   to authenticated;
grant select, update on public.wj_challenge_players to authenticated;

revoke all on public.wj_challenge_rooms   from anon;
revoke all on public.wj_challenge_players from anon;

-- ---------- internals ----------

create or replace function public.wj_challenge_next_code()
returns text
language plpgsql
as $wjc$
declare
    v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_code  text;
    i       int;
begin
    v_code := '';
    for i in 1..4 loop
        v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    return v_code;
end;
$wjc$;

create or replace function public.wj_challenge_pick_color(p_room_id uuid)
returns text
language plpgsql
as $wjc$
declare
    v_palette text[] := array['lime','sky','coral','violet','amber','rose','teal','slate'];
    v_used    text[];
    v_color   text;
begin
    select coalesce(array_agg(color), array[]::text[])
      into v_used
      from public.wj_challenge_players
     where room_id = p_room_id;

    foreach v_color in array v_palette loop
        if not (v_color = any (v_used)) then
            return v_color;
        end if;
    end loop;
    return v_palette[1 + floor(random() * array_length(v_palette, 1))::int];
end;
$wjc$;

create or replace function public.wj_challenge_add_player(p_room_id uuid)
returns void
language plpgsql
as $wjc$
begin
    insert into public.wj_challenge_players (
        room_id, user_id, email, nickname, color
    ) values (
        p_room_id,
        auth.uid(),
        coalesce(auth.jwt() ->> 'email', ''),
        coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name',
                 split_part(coalesce(auth.jwt() ->> 'email', 'player'), '@', 1)),
        public.wj_challenge_pick_color(p_room_id)
    )
    on conflict (room_id, user_id) do update
        set left_at = null,
            last_seen = now(),
            email = excluded.email,
            nickname = excluded.nickname;
end;
$wjc$;

-- Decide a winner if the current room state has a result.
-- last_standing: at most one player still in the climb, and someone is out.
-- target_score: earliest player to reach the target; if everyone is out
--               and nobody reached it, the closest score wins.
create or replace function public.wj_challenge_try_finish(p_room_id uuid)
returns public.wj_challenge_rooms
language plpgsql
as $wjc$
declare
    v_room    public.wj_challenge_rooms;
    v_alive   int;
    v_out     int;
    v_total   int;
    v_winner  uuid;
    v_reason  text;
begin
    select * into v_room from public.wj_challenge_rooms where id = p_room_id;
    if not found or v_room.status <> 'playing' then
        return v_room;
    end if;

    select
        count(*) filter (where fallen = false and left_at is null),
        count(*) filter (where fallen = true or left_at is not null),
        count(*)
      into v_alive, v_out, v_total
      from public.wj_challenge_players
     where room_id = p_room_id;

    if v_total < 2 then
        return v_room;
    end if;

    if v_room.duel_type = 'target_score' then
        select user_id into v_winner
          from public.wj_challenge_players
         where room_id = p_room_id
           and reached_at is not null
         order by reached_at asc, score desc, height desc
         limit 1;

        if v_winner is not null then
            v_reason := 'target';
        elsif v_alive = 0 then
            select user_id into v_winner
              from public.wj_challenge_players
             where room_id = p_room_id
             order by score desc, height desc, last_seen asc
             limit 1;
            v_reason := 'closest';
        end if;
    else
        -- last_standing (default)
        if v_out >= 1 and v_alive <= 1 then
            if v_alive = 1 then
                select user_id into v_winner
                  from public.wj_challenge_players
                 where room_id = p_room_id
                   and fallen = false
                   and left_at is null
                 limit 1;
                v_reason := 'last_standing';
            else
                select user_id into v_winner
                  from public.wj_challenge_players
                 where room_id = p_room_id
                 order by score desc, height desc, last_seen asc
                 limit 1;
                v_reason := 'highest';
            end if;
        end if;
    end if;

    if v_reason is null then
        return v_room;
    end if;

    update public.wj_challenge_rooms
       set status = 'finished',
           finished_at = coalesce(finished_at, now()),
           winner_id = v_winner,
           result_reason = v_reason
     where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$wjc$;

-- ---------- RPCs ----------

create or replace function public.create_wj_challenge(p_topic text default '__all__', p_seed bigint default null)
returns setof public.wj_challenge_rooms
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room public.wj_challenge_rooms;
    v_try  int := 0;
    v_code text;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    delete from public.wj_challenge_rooms where created_at < now() - interval '7 days';

    loop
        v_try := v_try + 1;
        v_code := public.wj_challenge_next_code();
        begin
            insert into public.wj_challenge_rooms (code, topic, seed, host_id)
            values (
                v_code,
                coalesce(nullif(trim(p_topic), ''), '__all__'),
                coalesce(p_seed, floor(random() * 2000000000)::bigint + 1),
                auth.uid()
            )
            returning * into v_room;
            exit;
        exception when unique_violation then
            if v_try >= 10 then
                raise exception 'CODE_GENERATION_FAILED';
            end if;
        end;
    end loop;

    perform public.wj_challenge_add_player(v_room.id);
    return next v_room;
end;
$wjc$;

-- Members can come back (including mid-climb). New players can join a
-- waiting or already-playing room until it is full or finished.
create or replace function public.join_wj_challenge(p_code text)
returns setof public.wj_challenge_rooms
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room   public.wj_challenge_rooms;
    v_count  int;
    v_member boolean;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
    from public.wj_challenge_rooms
    where code = upper(trim(p_code))
      and created_at > now() - interval '7 days'
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    v_member := (
        v_room.host_id = auth.uid()
        or exists (
            select 1 from public.wj_challenge_players
             where room_id = v_room.id and user_id = auth.uid()
        )
    );

    if v_member then
        update public.wj_challenge_players
           set left_at = null, last_seen = now()
         where room_id = v_room.id and user_id = auth.uid();
        return next v_room;
        return;
    end if;

    if v_room.status = 'finished' then
        raise exception 'ROOM_FINISHED';
    end if;

    if v_room.status <> 'waiting' and v_room.status <> 'playing' then
        raise exception 'ROOM_ALREADY_STARTED';
    end if;

    select count(*) into v_count
    from public.wj_challenge_players
    where room_id = v_room.id and left_at is null;

    if v_count >= coalesce(v_room.max_players, 8) then
        raise exception 'ROOM_FULL';
    end if;

    perform public.wj_challenge_add_player(v_room.id);
    return next v_room;
end;
$wjc$;

create or replace function public.rejoin_wj_challenge(p_room_id uuid default null, p_code text default null)
returns setof public.wj_challenge_rooms
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room public.wj_challenge_rooms;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    if p_room_id is not null then
        select * into v_room
        from public.wj_challenge_rooms
        where id = p_room_id
          and created_at > now() - interval '7 days'
        for update;
    elsif p_code is not null and length(trim(p_code)) > 0 then
        select * into v_room
        from public.wj_challenge_rooms
        where code = upper(trim(p_code))
          and created_at > now() - interval '7 days'
        for update;
    end if;

    if v_room.id is null then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if not (
        v_room.host_id = auth.uid()
        or exists (
            select 1 from public.wj_challenge_players
             where room_id = v_room.id and user_id = auth.uid()
        )
    ) then
        raise exception 'NOT_A_MEMBER';
    end if;

    update public.wj_challenge_players
       set left_at = null, last_seen = now()
     where room_id = v_room.id and user_id = auth.uid();

    return next v_room;
end;
$wjc$;

-- Waiting: host closes the room; others just leave their seat.
-- Playing: soft leave — keep the row so they can Rejoin, but they no
-- longer count as standing. Finished: just depart locally (row stays).
create or replace function public.leave_wj_challenge(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room public.wj_challenge_rooms;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room from public.wj_challenge_rooms where id = p_room_id;
    if not found then
        return;
    end if;

    if v_room.status = 'waiting' then
        if v_room.host_id = auth.uid() then
            delete from public.wj_challenge_rooms where id = p_room_id;
        else
            delete from public.wj_challenge_players
             where room_id = p_room_id and user_id = auth.uid();
        end if;
        return;
    end if;

    update public.wj_challenge_players
       set left_at = now(), last_seen = now()
     where room_id = p_room_id and user_id = auth.uid();

    if v_room.status = 'playing' then
        perform public.wj_challenge_try_finish(p_room_id);
    end if;
end;
$wjc$;

create or replace function public.set_wj_challenge_setup(
    p_room_id uuid,
    p_duel_type text,
    p_target_score int default 3000
)
returns setof public.wj_challenge_rooms
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room public.wj_challenge_rooms;
    v_type text;
    v_target int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    v_type := lower(trim(p_duel_type));
    if v_type not in ('last_standing', 'target_score') then
        raise exception 'BAD_DUEL_TYPE';
    end if;
    v_target := least(50000, greatest(500, coalesce(p_target_score, 3000)));

    update public.wj_challenge_rooms
       set duel_type = v_type,
           target_score = case when v_type = 'target_score' then v_target else target_score end
     where id = p_room_id
       and host_id = auth.uid()
       and status = 'waiting'
    returning * into v_room;

    if not found then
        raise exception 'CANNOT_SETUP';
    end if;

    return next v_room;
end;
$wjc$;

create or replace function public.set_wj_challenge_color(p_room_id uuid, p_color text)
returns void
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_color text;
    v_palette text[] := array['lime','sky','coral','violet','amber','rose','teal','slate'];
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    v_color := lower(trim(p_color));
    if not (v_color = any (v_palette)) then
        raise exception 'BAD_COLOR';
    end if;
    if not public.is_wj_challenge_member(p_room_id) then
        raise exception 'NOT_A_MEMBER';
    end if;
    update public.wj_challenge_players
       set color = v_color, last_seen = now()
     where room_id = p_room_id and user_id = auth.uid();
    if not found then
        raise exception 'NOT_A_MEMBER';
    end if;
end;
$wjc$;

create or replace function public.start_wj_challenge(p_room_id uuid)
returns setof public.wj_challenge_rooms
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room  public.wj_challenge_rooms;
    v_count int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room from public.wj_challenge_rooms where id = p_room_id for update;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.host_id <> auth.uid() then
        raise exception 'NOT_HOST';
    end if;
    if v_room.status <> 'waiting' then
        raise exception 'CANNOT_START';
    end if;
    if v_room.duel_type is null then
        raise exception 'DUEL_TYPE_REQUIRED';
    end if;

    select count(*) into v_count
    from public.wj_challenge_players
    where room_id = p_room_id and left_at is null;

    if v_count < 2 then
        raise exception 'NEED_TWO_PLAYERS';
    end if;

    update public.wj_challenge_players
       set score = 0, height = 0, x = 200, y = 0, vx = 0, vy = 0, face = 1,
           fallen = false, reached_at = null, left_at = null,
           last_seen = now()
     where room_id = p_room_id;

    update public.wj_challenge_rooms
       set status = 'playing',
           started_at = now(),
           finished_at = null,
           winner_id = null,
           result_reason = null
     where id = p_room_id
    returning * into v_room;

    return next v_room;
end;
$wjc$;

-- Own presence only. Also evaluates win conditions so a finished match
-- does not depend on the host staying connected.
create or replace function public.heartbeat_wj_challenge(
    p_room_id uuid,
    p_score int,
    p_height int,
    p_x double precision,
    p_y double precision,
    p_face int,
    p_fallen boolean default false
)
returns setof public.wj_challenge_rooms
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room public.wj_challenge_rooms;
    v_score int;
    v_height int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if not public.is_wj_challenge_member(p_room_id) then
        raise exception 'NOT_A_MEMBER';
    end if;

    select * into v_room from public.wj_challenge_rooms where id = p_room_id;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    v_score := greatest(0, coalesce(p_score, 0));
    v_height := greatest(0, coalesce(p_height, 0));

    update public.wj_challenge_players
       set score = v_score,
           height = v_height,
           x = coalesce(p_x, x),
           y = coalesce(p_y, y),
           face = case when coalesce(p_face, 1) < 0 then -1 else 1 end,
           fallen = fallen or coalesce(p_fallen, false),
           reached_at = case
               when reached_at is not null then reached_at
               when v_room.duel_type = 'target_score'
                    and v_score >= coalesce(v_room.target_score, 3000)
               then now()
               else null
           end,
           last_seen = now()
     where room_id = p_room_id and user_id = auth.uid();

    if v_room.status = 'playing' then
        v_room := public.wj_challenge_try_finish(p_room_id);
    end if;

    return next v_room;
end;
$wjc$;

create or replace function public.rematch_wj_challenge(p_room_id uuid, p_seed bigint default null)
returns setof public.wj_challenge_rooms
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room  public.wj_challenge_rooms;
    v_count int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room from public.wj_challenge_rooms where id = p_room_id for update;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.host_id <> auth.uid() then
        raise exception 'NOT_HOST';
    end if;
    if v_room.status <> 'finished' then
        raise exception 'CANNOT_START';
    end if;

    select count(*) into v_count
    from public.wj_challenge_players
    where room_id = p_room_id and left_at is null;
    if v_count < 2 then
        raise exception 'NEED_TWO_PLAYERS';
    end if;

    update public.wj_challenge_players
       set score = 0, height = 0, x = 200, y = 0, vx = 0, vy = 0, face = 1,
           fallen = false, reached_at = null, left_at = null,
           last_seen = now()
     where room_id = p_room_id;

    update public.wj_challenge_rooms
       set status = 'waiting',
           seed = coalesce(p_seed, floor(random() * 2000000000)::bigint + 1),
           started_at = null,
           finished_at = null,
           winner_id = null,
           result_reason = null
     where id = p_room_id
    returning * into v_room;

    return next v_room;
end;
$wjc$;

revoke all on function public.create_wj_challenge(text, bigint) from anon;
revoke all on function public.join_wj_challenge(text) from anon;
revoke all on function public.rejoin_wj_challenge(uuid, text) from anon;
revoke all on function public.leave_wj_challenge(uuid) from anon;
revoke all on function public.set_wj_challenge_setup(uuid, text, int) from anon;
revoke all on function public.set_wj_challenge_color(uuid, text) from anon;
revoke all on function public.start_wj_challenge(uuid) from anon;
revoke all on function public.heartbeat_wj_challenge(uuid, int, int, double precision, double precision, int, boolean) from anon;
revoke all on function public.rematch_wj_challenge(uuid, bigint) from anon;

grant execute on function public.create_wj_challenge(text, bigint) to authenticated;
grant execute on function public.join_wj_challenge(text) to authenticated;
grant execute on function public.rejoin_wj_challenge(uuid, text) to authenticated;
grant execute on function public.leave_wj_challenge(uuid) to authenticated;
grant execute on function public.set_wj_challenge_setup(uuid, text, int) to authenticated;
grant execute on function public.set_wj_challenge_color(uuid, text) to authenticated;
grant execute on function public.start_wj_challenge(uuid) to authenticated;
grant execute on function public.heartbeat_wj_challenge(uuid, int, int, double precision, double precision, int, boolean) to authenticated;
grant execute on function public.rematch_wj_challenge(uuid, bigint) to authenticated;

-- Policies call these helpers, so members need execute. Internal
-- generators stay revoked from anon / authenticated.
grant execute on function public.is_wj_challenge_member(uuid) to authenticated;
grant execute on function public.is_teacher() to authenticated;
revoke all on function public.wj_challenge_next_code() from anon, authenticated;
revoke all on function public.wj_challenge_pick_color(uuid) from anon, authenticated;
revoke all on function public.wj_challenge_add_player(uuid) from anon, authenticated;
revoke all on function public.wj_challenge_try_finish(uuid) from anon, authenticated;

-- Check it worked:
-- select routine_name from information_schema.routines
--  where routine_schema = 'public' and routine_name like '%wj_challenge%'
--  order by 1;

-- ---------- Public match history (7 days) + lifetime challenge wins ----------
-- Re-run this WHOLE file in the live project's SQL editor. No cron extension
-- required: expired rows are invisible immediately and deleted on each finish.
-- Snapshots intentionally have no room/user FK: deleting an old room must not
-- erase a recent result, and deleting history must not erase lifetime tallies.
begin;

create schema if not exists wjc_private;
revoke all on schema wjc_private from public, anon, authenticated;

alter table public.wj_challenge_rooms
    add column if not exists match_number bigint not null default 0;

create table if not exists public.wj_challenge_matches (
    id uuid primary key default gen_random_uuid(),
    room_id uuid not null,
    match_number bigint not null,
    room_code text not null,
    topic text not null,
    duel_type text not null,
    target_score int,
    started_at timestamptz,
    finished_at timestamptz not null,
    winner_id uuid,
    winner_name text not null,
    result_reason text,
    players jsonb not null,
    unique (room_id, match_number)
);
create index if not exists wj_challenge_matches_finished_idx
    on public.wj_challenge_matches (finished_at desc);

create table if not exists public.wj_challenge_wins (
    user_id uuid primary key,
    display_name text not null,
    wins bigint not null default 0 check (wins >= 0),
    matches bigint not null default 0 check (matches >= wins),
    last_win_at timestamptz
);
create index if not exists wj_challenge_wins_rank_idx
    on public.wj_challenge_wins (wins desc, last_win_at asc nulls last, matches asc, user_id);

alter table public.wj_challenge_matches enable row level security;
alter table public.wj_challenge_wins enable row level security;
revoke all on public.wj_challenge_matches, public.wj_challenge_wins from public, anon, authenticated;
grant select on public.wj_challenge_matches, public.wj_challenge_wins to authenticated;
drop policy if exists "wj challenge recent matches read" on public.wj_challenge_matches;
create policy "wj challenge recent matches read" on public.wj_challenge_matches
    for select to authenticated using (finished_at > now() - interval '7 days');
drop policy if exists "wj challenge wins read" on public.wj_challenge_wins;
create policy "wj challenge wins read" on public.wj_challenge_wins
    for select to authenticated using (true);

-- A durable room-local counter separates rematches even if start times collide.
create or replace function wjc_private.number_match()
returns trigger
language plpgsql
set search_path = ''
as $wjc$
begin
    if new.status = 'playing' and old.status = 'waiting' then
        new.match_number := old.match_number + 1;
    end if;
    return new;
end;
$wjc$;
drop trigger if exists wj_challenge_number_match on public.wj_challenge_rooms;
create trigger wj_challenge_number_match before update of status on public.wj_challenge_rooms
    for each row execute function wjc_private.number_match();

-- Runs in the SAME transaction as finish. If snapshot/tally fails, finish rolls
-- back too. Only the insert winner may increment tallies (ON CONFLICT guard).
create or replace function wjc_private.record_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $wjc$
declare
    v_inserted uuid;
    v_players jsonb;
    v_winner_name text;
    v_player jsonb;
begin
    if old.status <> 'playing' or new.status <> 'finished' then
        return new;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'name', coalesce(nullif(p.nickname, ''), 'Player'),
        'color', p.color, 'score', p.score, 'height', p.height,
        'fallen', p.fallen, 'left_at', p.left_at
    ) order by p.score desc, p.height desc, p.user_id), '[]'::jsonb)
    into v_players from public.wj_challenge_players p where p.room_id = new.id;
    select coalesce(nullif(p.nickname, ''), 'Player') into v_winner_name
    from public.wj_challenge_players p where p.room_id = new.id and p.user_id = new.winner_id;

    insert into public.wj_challenge_matches (
        room_id, match_number, room_code, topic, duel_type, target_score,
        started_at, finished_at, winner_id, winner_name, result_reason, players
    ) values (
        new.id, new.match_number, new.code, new.topic,
        coalesce(new.duel_type, 'last_standing'), new.target_score,
        new.started_at, coalesce(new.finished_at, now()), new.winner_id,
        coalesce(v_winner_name, 'No winner'), new.result_reason, v_players
    ) on conflict (room_id, match_number) do nothing returning id into v_inserted;

    if v_inserted is not null then
        -- Stable ordering also prevents concurrent multi-player upsert deadlocks.
        for v_player in select value from jsonb_array_elements(v_players) order by value->>'user_id'
        loop
            insert into public.wj_challenge_wins (user_id, display_name, wins, matches, last_win_at)
            values (
                (v_player->>'user_id')::uuid, v_player->>'name',
                case when (v_player->>'user_id')::uuid = new.winner_id then 1 else 0 end,
                1,
                case when (v_player->>'user_id')::uuid = new.winner_id then new.finished_at else null end
            ) on conflict (user_id) do update set
                display_name = excluded.display_name,
                wins = public.wj_challenge_wins.wins + excluded.wins,
                matches = public.wj_challenge_wins.matches + 1,
                last_win_at = case when excluded.wins = 1
                    then greatest(public.wj_challenge_wins.last_win_at, excluded.last_win_at)
                    else public.wj_challenge_wins.last_win_at end;
        end loop;
    end if;
    delete from public.wj_challenge_matches where finished_at <= now() - interval '7 days';
    return new;
end;
$wjc$;
revoke all on function wjc_private.number_match(), wjc_private.record_match() from public, anon, authenticated;
drop trigger if exists wj_challenge_record_match on public.wj_challenge_rooms;
create trigger wj_challenge_record_match after update of status on public.wj_challenge_rooms
    for each row execute function wjc_private.record_match();

-- Serialize presence/leave/finish against start/rematch. Late heartbeats must
-- not change the final scoreboard or write an old score into a new lobby.
create or replace function public.wj_challenge_try_finish(p_room_id uuid)
returns public.wj_challenge_rooms
language plpgsql
as $wjc$
declare
    v_room    public.wj_challenge_rooms;
    v_alive   int;
    v_out     int;
    v_total   int;
    v_winner  uuid;
    v_reason  text;
begin
    select * into v_room from public.wj_challenge_rooms where id = p_room_id for update;
    if not found or v_room.status <> 'playing' then
        return v_room;
    end if;

    select
        count(*) filter (where fallen = false and left_at is null),
        count(*) filter (where fallen = true or left_at is not null),
        count(*)
      into v_alive, v_out, v_total
      from public.wj_challenge_players
     where room_id = p_room_id;

    if v_total < 2 then
        return v_room;
    end if;

    if v_room.duel_type = 'target_score' then
        select user_id into v_winner
          from public.wj_challenge_players
         where room_id = p_room_id
           and reached_at is not null
         order by reached_at asc, score desc, height desc
         limit 1;

        if v_winner is not null then
            v_reason := 'target';
        elsif v_alive = 0 then
            select user_id into v_winner
              from public.wj_challenge_players
             where room_id = p_room_id
             order by score desc, height desc, last_seen asc
             limit 1;
            v_reason := 'closest';
        end if;
    else
        -- last_standing (default)
        if v_out >= 1 and v_alive <= 1 then
            if v_alive = 1 then
                select user_id into v_winner
                  from public.wj_challenge_players
                 where room_id = p_room_id
                   and fallen = false
                   and left_at is null
                 limit 1;
                v_reason := 'last_standing';
            else
                select user_id into v_winner
                  from public.wj_challenge_players
                 where room_id = p_room_id
                 order by score desc, height desc, last_seen asc
                 limit 1;
                v_reason := 'highest';
            end if;
        end if;
    end if;

    if v_reason is null then
        return v_room;
    end if;

    update public.wj_challenge_rooms
       set status = 'finished',
           finished_at = coalesce(finished_at, now()),
           winner_id = v_winner,
           result_reason = v_reason
     where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$wjc$;

create or replace function public.leave_wj_challenge(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room public.wj_challenge_rooms;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room from public.wj_challenge_rooms where id = p_room_id for update;
    if not found then
        return;
    end if;

    if v_room.status = 'waiting' then
        if v_room.host_id = auth.uid() then
            delete from public.wj_challenge_rooms where id = p_room_id;
        else
            delete from public.wj_challenge_players
             where room_id = p_room_id and user_id = auth.uid();
        end if;
        return;
    end if;

    update public.wj_challenge_players
       set left_at = now(), last_seen = now()
     where room_id = p_room_id and user_id = auth.uid();

    if v_room.status = 'playing' then
        perform public.wj_challenge_try_finish(p_room_id);
    end if;
end;
$wjc$;

drop function if exists public.heartbeat_wj_challenge(uuid, int, int, double precision, double precision, int, boolean);
drop function if exists public.heartbeat_wj_challenge(uuid, int, int, double precision, double precision, int, boolean, double precision, double precision);

create or replace function public.heartbeat_wj_challenge(
    p_room_id uuid,
    p_score int,
    p_height int,
    p_x double precision,
    p_y double precision,
    p_face int,
    p_fallen boolean default false,
    p_vx double precision default null,
    p_vy double precision default null
)
returns setof public.wj_challenge_rooms
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room public.wj_challenge_rooms;
    v_score int;
    v_height int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if not public.is_wj_challenge_member(p_room_id) then
        raise exception 'NOT_A_MEMBER';
    end if;

    select * into v_room from public.wj_challenge_rooms where id = p_room_id for update;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if v_room.status <> 'playing' then
        return next v_room;
        return;
    end if;

    v_score := greatest(0, coalesce(p_score, 0));
    v_height := greatest(0, coalesce(p_height, 0));

    update public.wj_challenge_players
       set score = v_score,
           height = v_height,
           x = coalesce(p_x, x),
           y = coalesce(p_y, y),
           vx = coalesce(p_vx, vx),
           vy = coalesce(p_vy, vy),
           face = case when coalesce(p_face, 1) < 0 then -1 else 1 end,
           fallen = fallen or coalesce(p_fallen, false),
           reached_at = case
               when reached_at is not null then reached_at
               when v_room.duel_type = 'target_score'
                    and v_score >= coalesce(v_room.target_score, 3000)
               then now()
               else null
           end,
           last_seen = now()
     where room_id = p_room_id and user_id = auth.uid();

    if v_room.status = 'playing' then
        v_room := public.wj_challenge_try_finish(p_room_id);
    end if;

    return next v_room;
end;
$wjc$;

revoke all on function public.heartbeat_wj_challenge(uuid, int, int, double precision, double precision, int, boolean, double precision, double precision) from anon;
grant execute on function public.heartbeat_wj_challenge(uuid, int, int, double precision, double precision, int, boolean, double precision, double precision) to authenticated;

delete from public.wj_challenge_matches where finished_at <= now() - interval '7 days';
commit;

-- No backfill: older rematches were overwritten and cannot be reconstructed.
-- Verify: select * from public.wj_challenge_wins order by wins desc;
--         select * from public.wj_challenge_matches order by finished_at desc;
