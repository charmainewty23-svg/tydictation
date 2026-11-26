-- ============================================================================
-- LearniTY · Purr-fect Survival — host early-end for every existing round
-- ============================================================================
--
-- WHAT THIS DOES
--   The host can now stop the round that is currently in play instead of
--   waiting for its clock: 1-2-3 Meow! (round 1), Glass Stepping Stones
--   (round 2), Tug of War (round 3) and Dalgona Candy Carving (round 4).
--   The end-of-round rules are exactly the same ones tick_purrfect_survival
--   already uses when the clock runs out — no new elimination rules.
--
--   Round 1 keeps using the existing end_purrfect_survival_round1() RPC.
--   Rounds 2–4 call the new host-only end_purrfect_survival_round() RPC.
--
-- HOW TO INSTALL
--   1. Open the live Supabase project (mggnwzirjmibreimrwiq) SQL editor:
--      https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--   2. Clear the editor completely.
--   3. Paste this whole file and Run once.
--   4. Run it AFTER the existing Survival incrementals (including the
--      glass-order bigint fix and purrfect_survival_round4_dalgona.sql).
--
-- Safe to re-run. Do NOT re-run older incrementals after this file.
-- Do NOT run this through a plugin, CLI or agent — paste it in the SQL editor.
-- No tables, columns or data are changed: functions only.
-- ============================================================================

create or replace function public.end_purrfect_survival_round(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_now timestamptz := now();
    v_state jsonb;
    v_pos int;
    v_winner text;
    v_alive int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.host_id <> auth.uid() then
        raise exception 'NOT_HOST';
    end if;

    -- Lobby or already finished: nothing to end.
    if v_room.status in ('waiting', 'finished') then
        return v_room;
    end if;

    -- Round 1: identical to the existing End round 1 button.
    if v_room.status = 'round1' then
        return public.purrfect_survival_complete_round1(p_room_id);
    end if;

    -- Round 2: treat as round2_ends_at reached. The tick eliminates every
    -- living player, then finish_if_done finishes a 1–2 round room or moves
    -- a 3+ round room with enough survivors to the Tug briefing.
    if v_room.status = 'round2' then
        update public.purrfect_survival_players
        set status = 'eliminated',
            ghost = true,
            eliminated_reason = 'round2_timeout',
            glass_active = false
        where room_id = p_room_id
          and status = 'alive'
          and is_playing;

        v_room := public.purrfect_survival_finish_if_done(p_room_id);
        return v_room;
    end if;

    -- Round 3: treat as the Tug clock expiring.
    if v_room.status = 'round3' then
        v_state := coalesce(v_room.tug_state, public.purrfect_survival_empty_tug());

        -- Briefing (Start Tug of War still owns the way in) or already done.
        if coalesce(v_state ->> 'phase', 'briefing') <> 'playing' then
            return v_room;
        end if;

        -- Sudden death has no clock: the host cannot invent a winner.
        if coalesce((v_state ->> 'suddenDeath')::boolean, false) then
            return v_room;
        end if;

        v_pos := coalesce((v_state ->> 'bluePull')::int, 0)
               - coalesce((v_state ->> 'redPull')::int, 0);

        if v_pos = 0 then
            -- Exactly centred: enter sudden death, same as the tick.
            v_state := jsonb_set(v_state, '{suddenDeath}', 'true'::jsonb, true);
            update public.purrfect_survival_rooms
            set tug_state = v_state,
                round3_ends_at = null,
                server_now = now()
            where id = p_room_id
            returning * into v_room;
            return v_room;
        end if;

        v_winner := case when v_pos > 0 then 'blue' else 'red' end;
        v_state := jsonb_set(v_state, '{phase}', to_jsonb('done'::text), true);
        v_state := jsonb_set(v_state, '{winner}', to_jsonb(v_winner), true);
        v_state := jsonb_set(v_state, '{position}', to_jsonb(v_pos), true);

        update public.purrfect_survival_rooms
        set tug_state = v_state,
            server_now = now()
        where id = p_room_id
        returning * into v_room;

        -- Mirrors the tick: 3-round rooms finish here; 4-round rooms start
        -- Dalgona (enter_round4 handles both cases).
        return public.purrfect_survival_enter_round4(p_room_id, v_winner);
    end if;

    -- Round 4: treat as the carving clock expiring, but respect the
    -- 7-second qualifier board — never kill the team during that board.
    if v_room.status = 'round4' then
        if v_room.round4_started_at is null
           or v_now < v_room.round4_started_at + interval '7 seconds' then
            return v_room;
        end if;

        update public.purrfect_survival_players
        set status = 'eliminated',
            ghost = true,
            eliminated_reason = 'dalgona_timeout'
        where room_id = p_room_id
          and is_playing
          and dalgona_pattern is not null
          and dalgona_finished_at is null
          and status <> 'eliminated';

        select count(*) into v_alive
        from public.purrfect_survival_players
        where room_id = p_room_id
          and is_playing
          and dalgona_pattern is not null
          and dalgona_finished_at is null
          and status <> 'eliminated'
          and not ghost;

        if v_alive = 0 then
            update public.purrfect_survival_rooms
            set status = 'finished',
                current_round = 4,
                finished_at = coalesce(finished_at, v_now),
                server_now = now()
            where id = p_room_id
            returning * into v_room;
        end if;

        return v_room;
    end if;

    return v_room;
end;
$fn$;

revoke all on function public.end_purrfect_survival_round(uuid) from public, anon;
grant execute on function public.end_purrfect_survival_round(uuid) to authenticated;

notify pgrst, 'reload schema';
