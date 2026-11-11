-- ============================================================
-- LearnITY Dictation — Drive & Go! multiplayer rooms (2–5 players)
-- Run once in Supabase → SQL Editor (project mggnwzirjmibreimrwiq).
-- Safe to re-run.
--
-- Single Player never needs this file. Multiplayer rooms use short
-- polling (no Realtime publication needed), like Word Battle.
-- Drive & Go! tables are deliberately separate from battle_* tables.
-- ============================================================

create table if not exists public.drive_and_go_rooms (
    id               uuid primary key default gen_random_uuid(),
    code             text not null unique,
    host_id          uuid not null references auth.users(id) on delete cascade,
    status           text not null default 'waiting'
                     check (status in ('waiting', 'playing', 'finished')),
    question_mode    text not null default 'av'
                     check (question_mode in ('av', 'pv', 'mixed')),
    seed             bigint not null,
    finish_distance  int not null default 4200,
    duration_seconds int not null default 180,
    winner_id        uuid references auth.users(id) on delete set null,
    result_reason    text check (result_reason in ('finish', 'time')),
    started_at       timestamptz,
    finished_at      timestamptz,
    created_at       timestamptz not null default now()
);

create table if not exists public.drive_and_go_players (
    room_id       uuid not null references public.drive_and_go_rooms(id) on delete cascade,
    user_id       uuid not null references auth.users(id) on delete cascade,
    email         text,
    nickname      text,
    cat           text,
    glasses       text,
    hat           text,
    outfit        text,
    distance      double precision not null default 0,
    score         int not null default 0,
    combo         int not null default 0,
    correct       int not null default 0,
    lane          int not null default 1 check (lane between 0 and 2),
    effect_kind   text check (effect_kind in ('spin', 'slow')),
    effect_until  timestamptz,
    effect_seq    int not null default 0,
    finished_at   timestamptz,
    last_seen     timestamptz not null default now(),
    created_at    timestamptz not null default now(),
    primary key (room_id, user_id)
);

create index if not exists drive_and_go_rooms_created_idx on public.drive_and_go_rooms (created_at desc);
create index if not exists drive_and_go_players_room_idx on public.drive_and_go_players (room_id);

-- ---------- helpers ----------

create or replace function public.is_drive_and_go_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $dg$
    select exists (
        select 1 from public.drive_and_go_players p
        where p.room_id = p_room_id and p.user_id = auth.uid()
    ) or exists (
        select 1 from public.drive_and_go_rooms r
        where r.id = p_room_id and r.host_id = auth.uid()
    );
$dg$;

create or replace function public.is_drive_and_go_teacher()
returns boolean
language sql
stable
as $dg$
    select coalesce(auth.jwt() ->> 'email', '') = 'tywong@lstyoungkhl.edu.hk';
$dg$;

-- ---------- RLS ----------

alter table public.drive_and_go_rooms   enable row level security;
alter table public.drive_and_go_players enable row level security;

drop policy if exists "drive and go rooms read members" on public.drive_and_go_rooms;
drop policy if exists "drive and go rooms read teacher" on public.drive_and_go_rooms;
drop policy if exists "drive and go players read members" on public.drive_and_go_players;
drop policy if exists "drive and go players read teacher" on public.drive_and_go_players;
drop policy if exists "drive and go players update own" on public.drive_and_go_players;

create policy "drive and go rooms read members" on public.drive_and_go_rooms
    for select using (public.is_drive_and_go_member(id));

create policy "drive and go rooms read teacher" on public.drive_and_go_rooms
    for select using (public.is_drive_and_go_teacher());

create policy "drive and go players read members" on public.drive_and_go_players
    for select using (public.is_drive_and_go_member(room_id));

create policy "drive and go players read teacher" on public.drive_and_go_players
    for select using (public.is_drive_and_go_teacher());

-- A student may write only their own row; the race itself is honest-client,
-- like Word Battle. Rooms and joins are controlled by the RPCs below.
create policy "drive and go players update own" on public.drive_and_go_players
    for update
    using (user_id = auth.uid() and public.is_drive_and_go_member(room_id))
    with check (user_id = auth.uid() and public.is_drive_and_go_member(room_id));

grant select on public.drive_and_go_rooms to authenticated;
grant select, update on public.drive_and_go_players to authenticated;

-- ---------- room lifecycle ----------

create or replace function public.create_drive_and_go_room(
    p_question_mode text default 'av',
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null
) returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_code   text;
    v_room   public.drive_and_go_rooms;
    v_try    int := 0;
    v_mode   text := lower(coalesce(p_question_mode, 'av'));
    v_email  text := coalesce(auth.jwt() ->> 'email', '');
    v_nick   text;
    i        int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if v_mode not in ('av', 'pv', 'mixed') then
        v_mode := 'av';
    end if;

    -- Housekeeping: abandoned rooms are dead after 12 hours.
    delete from public.drive_and_go_rooms
     where created_at < now() - interval '12 hours';

    v_nick := coalesce(
        nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
        nullif(split_part(v_email, '@', 1), ''),
        'Player'
    );

    loop
        v_try := v_try + 1;
        v_code := '';
        for i in 1..4 loop
            v_code := v_code || substr(v_chars, floor(random() * length(v_chars))::int + 1, 1);
        end loop;
        exit when not exists (select 1 from public.drive_and_go_rooms r where r.code = v_code);
        if v_try > 40 then
            raise exception 'CODE_GENERATION_FAILED';
        end if;
    end loop;

    insert into public.drive_and_go_rooms (code, host_id, question_mode, seed)
    values (v_code, auth.uid(), v_mode, floor(random() * 2147483646)::bigint + 1)
    returning * into v_room;

    insert into public.drive_and_go_players
        (room_id, user_id, email, nickname, cat, glasses, hat, outfit)
    values
        (v_room.id, auth.uid(), v_email, v_nick,
         left(coalesce(p_cat, 'Ginger'), 30),
         left(coalesce(p_glasses, 'None'), 30),
         left(coalesce(p_hat, 'None'), 30),
         left(coalesce(p_outfit, 'None'), 40));

    return next v_room;
end;
$dg$;

create or replace function public.join_drive_and_go_room(
    p_code text,
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null
) returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room    public.drive_and_go_rooms;
    v_member  boolean;
    v_count   int;
    v_email   text := coalesce(auth.jwt() ->> 'email', '');
    v_nick    text;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
      from public.drive_and_go_rooms
     where code = upper(trim(p_code))
     for update;

    if v_room.id is null then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    select exists (
        select 1 from public.drive_and_go_players p
        where p.room_id = v_room.id and p.user_id = auth.uid()
    ) into v_member;

    if not v_member and v_room.status <> 'waiting' then
        raise exception 'ROOM_ALREADY_STARTED';
    end if;

    select count(distinct p.user_id) into v_count
      from public.drive_and_go_players p
     where p.room_id = v_room.id;

    if not v_member and v_count >= 5 then
        raise exception 'ROOM_FULL';
    end if;

    v_nick := coalesce(
        nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
        nullif(split_part(v_email, '@', 1), ''),
        'Player'
    );

    if v_member then
        update public.drive_and_go_players
           set cat = left(coalesce(p_cat, cat, 'Ginger'), 30),
               glasses = left(coalesce(p_glasses, glasses, 'None'), 30),
               hat = left(coalesce(p_hat, hat, 'None'), 30),
               outfit = left(coalesce(p_outfit, outfit, 'None'), 40),
               last_seen = now()
         where room_id = v_room.id and user_id = auth.uid();
    else
        insert into public.drive_and_go_players
            (room_id, user_id, email, nickname, cat, glasses, hat, outfit)
        values
            (v_room.id, auth.uid(), v_email, v_nick,
             left(coalesce(p_cat, 'Ginger'), 30),
             left(coalesce(p_glasses, 'None'), 30),
             left(coalesce(p_hat, 'None'), 30),
             left(coalesce(p_outfit, 'None'), 40));
    end if;

    return next v_room;
end;
$dg$;

create or replace function public.start_drive_and_go_room(p_room_id uuid)
returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room  public.drive_and_go_rooms;
    v_count int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
      from public.drive_and_go_rooms
     where id = p_room_id
     for update;

    if v_room.id is null then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.host_id <> auth.uid() then
        raise exception 'NOT_HOST';
    end if;
    if v_room.status = 'playing' then
        return next v_room;
        return;
    end if;
    if v_room.status = 'finished' then
        raise exception 'ROOM_ALREADY_STARTED';
    end if;

    select count(distinct p.user_id) into v_count
      from public.drive_and_go_players p
     where p.room_id = v_room.id;
    if v_count < 2 then
        raise exception 'START_NEEDS_TWO';
    end if;
    if v_count > 5 then
        raise exception 'ROOM_FULL';
    end if;

    update public.drive_and_go_rooms
       set status = 'playing', started_at = now()
     where id = v_room.id
     returning * into v_room;

    return next v_room;
end;
$dg$;

create or replace function public.leave_drive_and_go_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room     public.drive_and_go_rooms;
    v_new_host uuid;
begin
    if auth.uid() is null then
        return;
    end if;

    select * into v_room
      from public.drive_and_go_rooms
     where id = p_room_id
     for update;
    if v_room.id is null then
        return;
    end if;

    delete from public.drive_and_go_players
     where room_id = v_room.id and user_id = auth.uid();

    -- Keep a waiting room alive by handing the host badge to the next player.
    if v_room.host_id = auth.uid() then
        select p.user_id into v_new_host
          from public.drive_and_go_players p
         where p.room_id = v_room.id
         order by p.created_at
         limit 1;
        if v_new_host is null then
            delete from public.drive_and_go_rooms where id = v_room.id;
        else
            update public.drive_and_go_rooms
               set host_id = v_new_host
             where id = v_room.id;
        end if;
    elsif not exists (select 1 from public.drive_and_go_players p where p.room_id = v_room.id)
          and v_room.status = 'waiting' then
        delete from public.drive_and_go_rooms where id = v_room.id;
    end if;
end;
$dg$;

create or replace function public.cross_drive_and_go_finish(p_room_id uuid)
returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room public.drive_and_go_rooms;
begin
    if auth.uid() is null or not public.is_drive_and_go_member(p_room_id) then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    update public.drive_and_go_players
       set finished_at = coalesce(finished_at, now()),
           last_seen = now()
     where room_id = p_room_id and user_id = auth.uid();

    update public.drive_and_go_rooms
       set status = 'finished',
           winner_id = auth.uid(),
           result_reason = 'finish',
           finished_at = now()
     where id = p_room_id
       and status = 'playing'
       and winner_id is null;

    select * into v_room from public.drive_and_go_rooms where id = p_room_id;
    return next v_room;
end;
$dg$;

create or replace function public.time_up_drive_and_go_room(p_room_id uuid)
returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room   public.drive_and_go_rooms;
    v_winner uuid;
begin
    if auth.uid() is null or not public.is_drive_and_go_member(p_room_id) then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
      from public.drive_and_go_rooms
     where id = p_room_id
     for update;

    if v_room.id is null then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.status <> 'playing' then
        return next v_room;
        return;
    end if;
    if v_room.started_at is null
       or now() < v_room.started_at + make_interval(secs => v_room.duration_seconds) then
        return next v_room;
        return;
    end if;

    select p.user_id into v_winner
      from public.drive_and_go_players p
     where p.room_id = v_room.id
     order by p.score desc, p.distance desc, p.last_seen asc, p.user_id
     limit 1;

    update public.drive_and_go_rooms
       set status = 'finished',
           winner_id = v_winner,
           result_reason = 'time',
           finished_at = now()
     where id = v_room.id
     returning * into v_room;

    return next v_room;
end;
$dg$;

create or replace function public.apply_drive_and_go_effect(
    p_room_id uuid,
    p_target uuid,
    p_kind text,
    p_ms int default 1500
) returns void
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_ms int := greatest(100, least(coalesce(p_ms, 1500), 6000));
begin
    if auth.uid() is null or not public.is_drive_and_go_member(p_room_id) then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if p_kind not in ('spin', 'slow') then
        raise exception 'BAD_EFFECT';
    end if;

    update public.drive_and_go_players
       set effect_kind = p_kind,
           effect_until = now() + make_interval(secs => v_ms / 1000.0),
           effect_seq = effect_seq + 1,
           last_seen = now()
     where room_id = p_room_id and user_id = p_target;
end;
$dg$;

-- Only signed-in users may call these functions.
revoke all on function public.create_drive_and_go_room(text, text, text, text, text) from public, anon;
revoke all on function public.join_drive_and_go_room(text, text, text, text, text) from public, anon;
revoke all on function public.start_drive_and_go_room(uuid) from public, anon;
revoke all on function public.leave_drive_and_go_room(uuid) from public, anon;
revoke all on function public.cross_drive_and_go_finish(uuid) from public, anon;
revoke all on function public.time_up_drive_and_go_room(uuid) from public, anon;
revoke all on function public.apply_drive_and_go_effect(uuid, uuid, text, int) from public, anon;
grant execute on function public.create_drive_and_go_room(text, text, text, text, text) to authenticated;
grant execute on function public.join_drive_and_go_room(text, text, text, text, text) to authenticated;
grant execute on function public.start_drive_and_go_room(uuid) to authenticated;
grant execute on function public.leave_drive_and_go_room(uuid) to authenticated;
grant execute on function public.cross_drive_and_go_finish(uuid) to authenticated;
grant execute on function public.time_up_drive_and_go_room(uuid) to authenticated;
grant execute on function public.apply_drive_and_go_effect(uuid, uuid, text, int) to authenticated;
