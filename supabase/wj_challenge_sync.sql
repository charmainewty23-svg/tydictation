-- ============================================================
-- LearnITY Dictation — smoother Word Jump Challenge bird sync
-- Run this once in Supabase → SQL Editor (project mggnwzirjmibreimrwiq)
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
-- Safe to re-run. Does not change rooms, scores, wins, or match history.
--
-- What it does:
--   * Adds vx / vy on wj_challenge_players so each heartbeat can send
--     the bird's current velocity, not just x / y.
--   * Extends heartbeat_wj_challenge with optional p_vx / p_vy
--     (old 7-argument calls still work).
--   * Zeros velocity when a match starts or rematches, so leftover
--     speed from the previous climb cannot leak into the next one.
--
-- If you prefer, you can re-run the full supabase/wj_challenge.sql
-- instead; it already includes these changes.
-- ============================================================

alter table public.wj_challenge_players add column if not exists vx double precision not null default 0;
alter table public.wj_challenge_players add column if not exists vy double precision not null default 0;

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
