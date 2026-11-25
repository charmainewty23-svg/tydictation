-- ============================================================================
-- LearniTY · Purr-fect Survival — qualifier beat before Glass Stepping Stones
-- ============================================================================
--
-- WHAT THIS DOES
--   The teacher/projector now shows an "Advancing to Glass Stepping Stones"
--   board for 7 seconds after Round 1. This file makes the live glass clock
--   wait for that board: purrfect_survival_release_glass() will not release
--   the first jumper until round2_started_at + 7 seconds.
--
-- HOW TO INSTALL
--   1. Open the live Supabase project (mggnwzirjmibreimrwiq) SQL editor.
--   2. Clear the editor completely.
--   3. Paste this whole file and Run once.
--   4. Run it AFTER the host-settings, tug and ceremony incrementals.
--
-- Safe to re-run. Do NOT re-run older incrementals after this file.
-- Do NOT run this through a plugin, CLI or agent — paste it in the SQL editor.
-- No tables, columns or data are changed.
-- ============================================================================

create or replace function public.purrfect_survival_release_glass(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_blocked int;
    v_status text;
    v_started timestamptz;
begin
    -- The client qualifier board owns the first 7 seconds of round 2. Do not
    -- start the first 5 s glass window while that board is still on screen.
    select status, round2_started_at
      into v_status, v_started
      from public.purrfect_survival_rooms
     where id = p_room_id;

    if v_status = 'round2'
       and v_started is not null
       and now() < v_started + interval '7 seconds' then
        return;
    end if;

    select count(*) into v_blocked
    from public.purrfect_survival_players
    where room_id = p_room_id
      and status = 'alive'
      and is_playing
      and glass_active
      and glass_step = 0;

    if v_blocked > 0 then
        return;
    end if;

    update public.purrfect_survival_players p
    set glass_active = true,
        glass_started_at = now()
    from (
        select user_id
        from public.purrfect_survival_players
        where room_id = p_room_id
          and status = 'alive'
          and is_playing
          and glass_active = false
          and glass_started_at is null
          and glass_step = 0
        order by round1_rank asc nulls last, distance desc, user_id asc
        limit 1
    ) n
    where p.user_id = n.user_id
      and p.room_id = p_room_id;
end;
$$;

-- This function is internal only; clients never call it directly.
revoke all on function public.purrfect_survival_release_glass(uuid)
    from public, anon, authenticated;

notify pgrst, 'reload schema';
