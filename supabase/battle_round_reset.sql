-- LearniTY Word Battle: every new round starts from zero.
--
-- Why: start_battle() and rematch_battle() used to reset score/correct/done,
-- but the live-board columns (progress / last_answer / last_correct) could keep
-- the previous round's values when battle_class.sql was re-run after
-- battle_live.sql. A stale progress = question_count made students jump
-- straight to the results screen with 0 pts as soon as the host pressed Start.
--
-- This file redefines both functions so they always clear the round, with
-- optional columns guarded (works even if battle_live.sql was never run).
--
-- Run in the Supabase SQL editor after battle_class.sql. Safe to re-run.

create or replace function public.start_battle(p_room_id uuid)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $battle$
declare
    v_room public.battle_rooms;
    v_mode text;
begin
    select mode into v_mode from public.battle_rooms where id = p_room_id;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if v_mode = 'class' then
        update public.battle_rooms
           set status = 'playing', started_at = now()
         where id = p_room_id
           and host_id = auth.uid()
           and mode = 'class'
           and status = 'waiting'
           and exists (select 1 from public.battle_players where room_id = p_room_id)
        returning * into v_room;
    else
        update public.battle_rooms
           set status = 'playing', started_at = now()
         where id = p_room_id
           and host_id = auth.uid()
           and guest_id is not null
           and status = 'waiting'
        returning * into v_room;
    end if;

    if not found then
        raise exception 'CANNOT_START';
    end if;

    update public.battle_players
       set score = 0,
           correct = 0,
           total_ms = 0,
           done = false,
           last_seen = now()
     where room_id = p_room_id;

    -- battle_live.sql columns (optional)
    if exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'battle_players'
           and column_name = 'progress'
    ) then
        update public.battle_players
           set progress = 0,
               last_answer = null,
               last_correct = null
         where room_id = p_room_id;
    end if;

    -- per-question stats (battle_stats.sql, optional)
    if to_regclass('public.battle_answers') is not null then
        delete from public.battle_answers where room_id = p_room_id;
    end if;

    return next v_room;
end;
$battle$;

create or replace function public.rematch_battle(p_room_id uuid, p_seed bigint)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $battle$
declare
    v_room public.battle_rooms;
begin
    update public.battle_rooms
       set status = 'playing', seed = p_seed, started_at = now()
     where id = p_room_id
       and host_id = auth.uid()
       and guest_id is not null
    returning * into v_room;

    if not found then
        raise exception 'CANNOT_START';
    end if;

    update public.battle_players
       set score = 0,
           correct = 0,
           total_ms = 0,
           done = false,
           last_seen = now()
     where room_id = p_room_id;

    if exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'battle_players'
           and column_name = 'progress'
    ) then
        update public.battle_players
           set progress = 0,
               last_answer = null,
               last_correct = null
         where room_id = p_room_id;
    end if;

    if to_regclass('public.battle_answers') is not null then
        delete from public.battle_answers where room_id = p_room_id;
    end if;

    return next v_room;
end;
$battle$;

revoke all on function public.start_battle(uuid) from public, anon;
revoke all on function public.rematch_battle(uuid, bigint) from public, anon;
grant execute on function public.start_battle(uuid) to authenticated;
grant execute on function public.rematch_battle(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
