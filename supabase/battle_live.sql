-- ============================================================
-- LearnITY Dictation — Live progress for the teacher board
-- Run AFTER supabase/battle_class.sql.
-- Safe to re-run.
--
-- Adds per-student live state so the teacher can watch the class play:
--   progress      = current question index (0-based)
--   last_answer   = what the student typed for the last question
--   last_correct  = whether it was right
--   updated_at    = server timestamp of last update (used for "idle Ns")
-- ============================================================

alter table public.battle_players add column if not exists progress int not null default 0;
alter table public.battle_players add column if not exists last_answer text;
alter table public.battle_players add column if not exists last_correct boolean;
alter table public.battle_players add column if not exists updated_at timestamptz not null default now();

-- server-side "last touched" so idle detection does not depend on the
-- student's device clock
create or replace function public.touch_battle_player()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists battle_player_touch on public.battle_players;
create trigger battle_player_touch
    before update on public.battle_players
    for each row execute function public.touch_battle_player();

-- reset the new columns when a round starts
create or replace function public.start_battle(p_room_id uuid)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
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
       set score = 0, correct = 0, total_ms = 0, done = false,
           progress = 0, last_answer = null, last_correct = null
     where room_id = p_room_id;

    return next v_room;
end;
$$;

create or replace function public.rematch_battle(p_room_id uuid, p_seed bigint)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
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
       set score = 0, correct = 0, total_ms = 0, done = false,
           progress = 0, last_answer = null, last_correct = null
     where room_id = p_room_id;

    return next v_room;
end;
$$;

-- Check:
-- select nickname, progress, score, last_answer, last_correct, updated_at
-- from public.battle_players order by updated_at desc limit 20;
