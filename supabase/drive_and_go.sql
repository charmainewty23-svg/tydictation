-- ============================================================
-- LearnITY Dictation — Drive & Go! multiplayer rooms (2–5 players)
-- Run once in Supabase → SQL Editor (project mggnwzirjmibreimrwiq).
-- Safe to re-run.
--
-- Includes the three courses (scene: desert / stadium / jungle), the two
-- topics (topic: tenses / agreement) and the separate Solo / Multi
-- leaderboards. Rooms use short polling (no Realtime publication needed),
-- like Word Battle. Drive & Go! tables are deliberately separate from
-- battle_* tables.
--
-- Single Player never needs this file. Teachers who already ran the older
-- files can paste supabase/drive_and_go_question_count.sql,
-- supabase/drive_and_go_scenes_and_boards.sql and then
-- supabase/drive_and_go_agreement_topic.sql instead of this whole file.
-- ============================================================

create table if not exists public.drive_and_go_rooms (
    id               uuid primary key default gen_random_uuid(),
    code             text not null unique,
    host_id          uuid not null references auth.users(id) on delete cascade,
    status           text not null default 'waiting'
                     check (status in ('waiting', 'playing', 'finished')),
    topic            text not null default 'tenses'
                     check (topic in ('tenses', 'agreement')),
    question_mode    text not null default 'av'
                     check (question_mode in ('av', 'pv', 'mixed', 'gapfill', 'choose')),
    question_count   int not null default 20
                     check (question_count in (20, 25, 30, 35, 40, 50)),
    scene            text not null default 'desert'
                     check (scene in ('desert', 'stadium', 'jungle')),
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
    wrong         int not null default 0,
    composite_score int not null default 0,
    elapsed_ms    int not null default 0,
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

-- Re-running this file on an existing database will not alter CREATE TABLE,
-- so also add any new columns if they are missing.
alter table public.drive_and_go_rooms
    add column if not exists question_count int not null default 20;
alter table public.drive_and_go_rooms
    add column if not exists scene text not null default 'desert';
alter table public.drive_and_go_rooms
    add column if not exists topic text not null default 'tenses';
alter table public.drive_and_go_players
    add column if not exists wrong int not null default 0;
alter table public.drive_and_go_players
    add column if not exists composite_score int not null default 0;
alter table public.drive_and_go_players
    add column if not exists elapsed_ms int not null default 0;

do $chk$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'drive_and_go_rooms_question_count_chk'
          and conrelid = 'public.drive_and_go_rooms'::regclass
    ) then
        begin
            alter table public.drive_and_go_rooms
                add constraint drive_and_go_rooms_question_count_chk
                check (question_count in (20, 25, 30, 35, 40, 50));
        exception when others then
            -- Fresh tables already have the same check inline on the column.
            null;
        end;
    end if;
end
$chk$;

do $chk$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'drive_and_go_rooms_scene_chk'
          and conrelid = 'public.drive_and_go_rooms'::regclass
    ) then
        begin
            alter table public.drive_and_go_rooms
                add constraint drive_and_go_rooms_scene_chk
                check (scene in ('desert', 'stadium', 'jungle'));
        exception when others then
            null;
        end;
    end if;
end
$chk$;

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

drop function if exists public.create_drive_and_go_room(text, text, text, text, text);
drop function if exists public.create_drive_and_go_room(text, text, text, text, text, int);
drop function if exists public.create_drive_and_go_room(text, text, text, text, text, int, text);

create or replace function public.create_drive_and_go_room(
    p_question_mode text default 'av',
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null,
    p_question_count int default 20,
    p_scene text default 'desert',
    p_topic text default 'tenses'
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
    v_topic  text := lower(coalesce(p_topic, 'tenses'));
    v_mode   text := lower(coalesce(p_question_mode, 'av'));
    v_count  int := coalesce(p_question_count, 20);
    v_scene  text := lower(coalesce(p_scene, 'desert'));
    v_email  text := coalesce(auth.jwt() ->> 'email', '');
    v_nick   text;
    i        int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if v_topic not in ('tenses', 'agreement') then
        v_topic := 'tenses';
    end if;
    if v_topic = 'agreement' then
        if v_mode not in ('gapfill', 'choose', 'mixed') then
            v_mode := 'gapfill';
        end if;
    else
        if v_mode not in ('av', 'pv', 'mixed') then
            v_mode := 'av';
        end if;
    end if;
    if v_count not in (20, 25, 30, 35, 40, 50) then
        v_count := 20;
    end if;
    if v_scene not in ('desert', 'stadium', 'jungle') then
        v_scene := 'desert';
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

    insert into public.drive_and_go_rooms
        (code, host_id, topic, question_mode, question_count, seed, scene)
    values
        (v_code, auth.uid(), v_topic, v_mode, v_count,
         floor(random() * 2147483646)::bigint + 1, v_scene)
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

    -- A mid-race leave should end the room once every remaining racer has
    -- reached N correct (or also left).
    if exists (
        select 1 from public.drive_and_go_rooms r
         where r.id = p_room_id and r.status = 'playing'
    ) then
        perform public.maybe_finish_drive_and_go_room(p_room_id);
    end if;
end;
$dg$;

-- Room ends when every remaining racer has finished (N correct) or left.
-- Winner is the highest composite score; tie-break: faster finish, then
-- higher accuracy (correct / (correct + wrong)).
create or replace function public.maybe_finish_drive_and_go_room(p_room_id uuid)
returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room       public.drive_and_go_rooms;
    v_winner     uuid;
    v_remaining  int;
    v_unfinished int;
begin
    select * into v_room
      from public.drive_and_go_rooms
     where id = p_room_id
     for update;

    if v_room.id is null then
        return;
    end if;
    if v_room.status <> 'playing' then
        return next v_room;
        return;
    end if;

    select count(*), count(*) filter (where finished_at is null)
      into v_remaining, v_unfinished
      from public.drive_and_go_players
     where room_id = p_room_id;

    if v_remaining = 0 then
        delete from public.drive_and_go_rooms where id = p_room_id;
        return;
    end if;
    if v_unfinished > 0 then
        return next v_room;
        return;
    end if;

    select p.user_id into v_winner
      from public.drive_and_go_players p
     where p.room_id = v_room.id
     order by p.composite_score desc,
              p.finished_at asc nulls last,
              (p.correct::double precision / nullif(p.correct + p.wrong, 0)) desc nulls last,
              p.score desc,
              p.user_id
     limit 1;

    update public.drive_and_go_rooms
       set status = 'finished',
           winner_id = v_winner,
           result_reason = 'finish',
           finished_at = now()
     where id = v_room.id
     returning * into v_room;

    return next v_room;
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

    return query
        select * from public.maybe_finish_drive_and_go_room(p_room_id);
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
    -- The 3-minute "highest score wins" rule has been removed. Rooms now end
    -- when every remaining racer has N correct answers (or has left).
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
-- Only signed-in users may call these functions. The three old
-- create_drive_and_go_room overloads may already have been dropped above, so
-- revoke them only when they still exist.
do $rev$
begin
    if to_regprocedure('public.create_drive_and_go_room(text,text,text,text,text)') is not null then
        execute 'revoke all on function public.create_drive_and_go_room(text,text,text,text,text) from public, anon, authenticated';
    end if;
    if to_regprocedure('public.create_drive_and_go_room(text,text,text,text,text,int)') is not null then
        execute 'revoke all on function public.create_drive_and_go_room(text,text,text,text,text,int) from public, anon, authenticated';
    end if;
    if to_regprocedure('public.create_drive_and_go_room(text,text,text,text,text,int,text)') is not null then
        execute 'revoke all on function public.create_drive_and_go_room(text,text,text,text,text,int,text) from public, anon, authenticated';
    end if;
end
$rev$;
revoke all on function public.create_drive_and_go_room(text, text, text, text, text, int, text, text) from public, anon;
revoke all on function public.join_drive_and_go_room(text, text, text, text, text) from public, anon;
revoke all on function public.start_drive_and_go_room(uuid) from public, anon;
revoke all on function public.leave_drive_and_go_room(uuid) from public, anon;
revoke all on function public.cross_drive_and_go_finish(uuid) from public, anon;
revoke all on function public.time_up_drive_and_go_room(uuid) from public, anon;
revoke all on function public.apply_drive_and_go_effect(uuid, uuid, text, int) from public, anon;
grant execute on function public.create_drive_and_go_room(text, text, text, text, text, int, text, text) to authenticated;
grant execute on function public.join_drive_and_go_room(text, text, text, text, text) to authenticated;
grant execute on function public.start_drive_and_go_room(uuid) to authenticated;
grant execute on function public.leave_drive_and_go_room(uuid) to authenticated;
grant execute on function public.cross_drive_and_go_finish(uuid) to authenticated;
grant execute on function public.time_up_drive_and_go_room(uuid) to authenticated;
grant execute on function public.apply_drive_and_go_effect(uuid, uuid, text, int) to authenticated;

-- ============================================================
-- Solo leaderboard
-- ============================================================

create table if not exists public.drive_and_go_solo_scores (
    id             bigserial primary key,
    user_id        uuid not null references auth.users(id) on delete cascade,
    email          text not null,
    nickname       text,
    topic          text not null default 'tenses'
                   check (topic in ('tenses', 'agreement')),
    bank_mode      text not null default 'av'
                   check (bank_mode in ('av', 'pv', 'mixed', 'gapfill', 'choose')),
    question_count int  not null default 20,
    scene          text not null default 'desert'
                   check (scene in ('desert', 'stadium', 'jungle')),
    composite      int  not null default 0,
    race_score     int  not null default 0,
    time_bonus     int  not null default 0,
    correct        int  not null default 0,
    wrong          int  not null default 0,
    accuracy       numeric not null default 0
                   check (accuracy >= 0 and accuracy <= 1),
    elapsed_ms     int  not null default 0,
    created_at     timestamptz not null default now()
);

create index if not exists drive_and_go_solo_rank_idx
    on public.drive_and_go_solo_scores (composite desc, elapsed_ms asc, created_at asc);
create index if not exists drive_and_go_solo_user_idx
    on public.drive_and_go_solo_scores (user_id);
create index if not exists drive_and_go_solo_created_idx
    on public.drive_and_go_solo_scores (created_at desc);

alter table public.drive_and_go_solo_scores
    add column if not exists topic text not null default 'tenses';

alter table public.drive_and_go_solo_scores enable row level security;

drop policy if exists "drive and go solo board is public" on public.drive_and_go_solo_scores;
create policy "drive and go solo board is public" on public.drive_and_go_solo_scores
    for select
    using (true);

drop policy if exists "drive and go solo insert own" on public.drive_and_go_solo_scores;
create policy "drive and go solo insert own" on public.drive_and_go_solo_scores
    for insert
    with check (auth.uid() = user_id);

grant select on public.drive_and_go_solo_scores to anon, authenticated;
grant insert on public.drive_and_go_solo_scores to authenticated;

-- One row per student: their personal best by composite, then faster time,
-- then accuracy, then earlier created_at. `plays` is the run count.
drop view if exists public.drive_and_go_solo_leaderboard;

create view public.drive_and_go_solo_leaderboard
with (security_invoker = true)
as
select
    user_id,
    email,
    nickname,
    topic,
    bank_mode,
    question_count,
    scene,
    composite,
    race_score,
    time_bonus,
    correct,
    wrong,
    accuracy,
    elapsed_ms,
    created_at,
    plays
from (
    select
        s.*,
        count(*) over (partition by s.user_id, s.topic) as plays,
        row_number() over (
            partition by s.user_id, s.topic
            order by s.composite desc, s.elapsed_ms asc, s.accuracy desc, s.created_at asc
        ) as rn
    from public.drive_and_go_solo_scores s
) ranked
where rn = 1;

grant select on public.drive_and_go_solo_leaderboard to anon, authenticated;

-- ============================================================
-- Multiplayer leaderboard
-- ============================================================

create table if not exists public.drive_and_go_multi_scores (
    id             bigserial primary key,
    user_id        uuid not null references auth.users(id) on delete cascade,
    email          text not null,
    nickname       text,
    topic          text not null default 'tenses'
                   check (topic in ('tenses', 'agreement')),
    bank_mode      text not null default 'av'
                   check (bank_mode in ('av', 'pv', 'mixed', 'gapfill', 'choose')),
    question_count int  not null default 20,
    scene          text not null default 'desert'
                   check (scene in ('desert', 'stadium', 'jungle')),
    composite      int  not null default 0,
    race_score     int  not null default 0,
    time_bonus     int  not null default 0,
    correct        int  not null default 0,
    wrong          int  not null default 0,
    accuracy       numeric not null default 0
                   check (accuracy >= 0 and accuracy <= 1),
    elapsed_ms     int  not null default 0,
    room_id        uuid references public.drive_and_go_rooms(id) on delete set null,
    place          int,
    player_count   int,
    created_at     timestamptz not null default now()
);

create index if not exists drive_and_go_multi_rank_idx
    on public.drive_and_go_multi_scores (composite desc, elapsed_ms asc, created_at asc);
create index if not exists drive_and_go_multi_user_idx
    on public.drive_and_go_multi_scores (user_id);
create index if not exists drive_and_go_multi_created_idx
    on public.drive_and_go_multi_scores (created_at desc);
create index if not exists drive_and_go_multi_room_idx
    on public.drive_and_go_multi_scores (room_id);

alter table public.drive_and_go_multi_scores
    add column if not exists topic text not null default 'tenses';

alter table public.drive_and_go_multi_scores enable row level security;

drop policy if exists "drive and go multi board is public" on public.drive_and_go_multi_scores;
create policy "drive and go multi board is public" on public.drive_and_go_multi_scores
    for select
    using (true);

drop policy if exists "drive and go multi insert own" on public.drive_and_go_multi_scores;
create policy "drive and go multi insert own" on public.drive_and_go_multi_scores
    for insert
    with check (auth.uid() = user_id);

grant select on public.drive_and_go_multi_scores to anon, authenticated;
grant insert on public.drive_and_go_multi_scores to authenticated;

drop view if exists public.drive_and_go_multi_leaderboard;

create view public.drive_and_go_multi_leaderboard
with (security_invoker = true)
as
select
    user_id,
    email,
    nickname,
    topic,
    bank_mode,
    question_count,
    scene,
    composite,
    race_score,
    time_bonus,
    correct,
    wrong,
    accuracy,
    elapsed_ms,
    created_at,
    plays
from (
    select
        s.*,
        count(*) over (partition by s.user_id, s.topic) as plays,
        row_number() over (
            partition by s.user_id, s.topic
            order by s.composite desc, s.elapsed_ms asc, s.accuracy desc, s.created_at asc
        ) as rn
    from public.drive_and_go_multi_scores s
) ranked
where rn = 1;

grant select on public.drive_and_go_multi_leaderboard to anon, authenticated;

-- ---------- re-run safety: widen old topic / mode checks ----------
-- Fresh tables above already carry the new inline checks. This block makes a
-- repeat run of this file on an older database replace the narrower ones.

do $chk$
declare
    r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.drive_and_go_rooms'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%question_mode%'
    loop
        execute format('alter table public.drive_and_go_rooms drop constraint %I', r.conname);
    end loop;

    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.drive_and_go_solo_scores'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%bank_mode%'
    loop
        execute format('alter table public.drive_and_go_solo_scores drop constraint %I', r.conname);
    end loop;

    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.drive_and_go_multi_scores'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%bank_mode%'
    loop
        execute format('alter table public.drive_and_go_multi_scores drop constraint %I', r.conname);
    end loop;
end
$chk$;

alter table public.drive_and_go_rooms
    drop constraint if exists drive_and_go_rooms_question_mode_chk;
alter table public.drive_and_go_rooms
    add constraint drive_and_go_rooms_question_mode_chk
    check (question_mode in ('av', 'pv', 'mixed', 'gapfill', 'choose'));

alter table public.drive_and_go_solo_scores
    drop constraint if exists drive_and_go_solo_scores_bank_mode_chk;
alter table public.drive_and_go_solo_scores
    add constraint drive_and_go_solo_scores_bank_mode_chk
    check (bank_mode in ('av', 'pv', 'mixed', 'gapfill', 'choose'));

alter table public.drive_and_go_multi_scores
    drop constraint if exists drive_and_go_multi_scores_bank_mode_chk;
alter table public.drive_and_go_multi_scores
    add constraint drive_and_go_multi_scores_bank_mode_chk
    check (bank_mode in ('av', 'pv', 'mixed', 'gapfill', 'choose'));

alter table public.drive_and_go_rooms
    drop constraint if exists drive_and_go_rooms_topic_chk;
alter table public.drive_and_go_rooms
    add constraint drive_and_go_rooms_topic_chk
    check (topic in ('tenses', 'agreement'));

alter table public.drive_and_go_solo_scores
    drop constraint if exists drive_and_go_solo_scores_topic_chk;
alter table public.drive_and_go_solo_scores
    add constraint drive_and_go_solo_scores_topic_chk
    check (topic in ('tenses', 'agreement'));

alter table public.drive_and_go_multi_scores
    drop constraint if exists drive_and_go_multi_scores_topic_chk;
alter table public.drive_and_go_multi_scores
    add constraint drive_and_go_multi_scores_topic_chk
    check (topic in ('tenses', 'agreement'));

notify pgrst, 'reload schema';

-- Check it worked:
-- select nickname, topic, bank_mode, composite, elapsed_ms, accuracy, question_count, scene, plays
-- from public.drive_and_go_solo_leaderboard
-- order by topic, composite desc, elapsed_ms asc, accuracy desc, created_at asc limit 10;
