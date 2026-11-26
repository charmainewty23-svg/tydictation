-- ============================================================================
-- LearniTY · Purr-fect Survival — Glass Stepping Stones 7-second window
-- ============================================================================
--
-- WHAT THIS DOES
--   The per-jumper thinking window on the glass bridge is now 7 seconds
--   (it used to be 5 seconds). Everything else is unchanged: one active
--   jumper at a time, the 7-second qualifier board before the first
--   jumper, wrong-pane falls, no reveal on timeout, lights, early-end and
--   the Tug of War 5 s 爆走拉力 2x rage all keep their existing rules.
--
--   This replaces only the two server functions that still enforced the
--   5-second glass window:
--     · public.tick_purrfect_survival(uuid)
--     · public.glass_jump_purrfect_survival(uuid, text)
--
-- HOW TO INSTALL
--   1. Open the live Supabase project (mggnwzirjmibreimrwiq) SQL editor:
--      https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--   2. Clear the editor completely.
--   3. Paste this whole file and Run once.
--   4. Run it AFTER the existing Survival incrementals (including the
--      glass-order bigint fix, Dalgona, and
--      purrfect_survival_end_rounds.sql).
--
-- Safe to re-run. Do NOT re-run older incrementals after this file.
-- Do NOT run this through a plugin, CLI or agent — paste it in the SQL editor.
-- No tables, columns or data are changed: functions only.
-- ============================================================================

-- ---------- tick (glass window now 7 seconds) ----------

create or replace function public.tick_purrfect_survival(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_finished int;
    v_alive int;
    v_now timestamptz := now();
    v_now_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
    v_state jsonb;
    v_pos int;
    v_winner text;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if not public.is_purrfect_survival_member(p_room_id) then
        raise exception 'NOT_A_MEMBER';
    end if;

    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if v_room.status = 'round1' then
        select count(*) into v_alive
        from public.purrfect_survival_players
        where room_id = p_room_id
          and status = 'alive'
          and is_playing;

        select count(*) into v_finished
        from public.purrfect_survival_players
        where room_id = p_room_id
          and status = 'alive'
          and is_playing
          and (distance >= v_room.finish_distance or reached_finish);

        if public.purrfect_survival_round_count(v_room.settings) > 1 then
            if v_finished >= 15
               or (v_room.round1_ends_at is not null and v_now >= v_room.round1_ends_at) then
                v_room := public.purrfect_survival_complete_round1(p_room_id);
            end if;
        else
            if v_finished >= v_alive
               or (v_room.round1_ends_at is not null and v_now >= v_room.round1_ends_at) then
                v_room := public.purrfect_survival_complete_round1(p_room_id);
            end if;
        end if;
    end if;

    if v_room.status = 'round2' then
        update public.purrfect_survival_players
        set status = 'eliminated',
            ghost = true,
            eliminated_reason = 'glass_timeout',
            glass_active = false
        where room_id = p_room_id
          and status = 'alive'
          and is_playing
          and glass_active
          and glass_started_at is not null
          and v_now - glass_started_at >= interval '7 seconds';

        if v_room.round2_ends_at is not null and v_now >= v_room.round2_ends_at then
            update public.purrfect_survival_players
            set status = 'eliminated',
                ghost = true,
                eliminated_reason = 'round2_timeout',
                glass_active = false
            where room_id = p_room_id
              and status = 'alive'
              and is_playing;
        end if;

        perform public.purrfect_survival_release_glass(p_room_id);

        v_room := public.purrfect_survival_finish_if_done(p_room_id);
    end if;

    if v_room.status = 'round3' then
        v_state := coalesce(v_room.tug_state, public.purrfect_survival_empty_tug());

        if coalesce(v_state ->> 'phase', 'briefing') = 'playing'
           and coalesce((v_state ->> 'suddenDeath')::boolean, false) = false
           and v_room.round3_ends_at is not null
           and v_now >= v_room.round3_ends_at then
            v_pos := coalesce((v_state ->> 'bluePull')::int, 0)
                   - coalesce((v_state ->> 'redPull')::int, 0);
            if v_pos = 0 then
                v_state := jsonb_set(v_state, '{suddenDeath}', 'true'::jsonb, true);
                update public.purrfect_survival_rooms
                set tug_state = v_state,
                    round3_ends_at = null,
                    server_now = now()
                where id = p_room_id
                returning * into v_room;
            else
                v_winner := case when v_pos > 0 then 'blue' else 'red' end;
                v_state := jsonb_set(v_state, '{phase}', to_jsonb('done'::text), true);
                v_state := jsonb_set(v_state, '{winner}', to_jsonb(v_winner), true);
                v_state := jsonb_set(v_state, '{position}', to_jsonb(v_pos), true);
            end if;
        end if;

        if v_state ? 'winner' and v_state ->> 'winner' is not null
           and coalesce(v_state ->> 'phase', '') = 'done' then
            v_winner := v_state ->> 'winner';
            update public.purrfect_survival_rooms
            set tug_state = v_state,
                server_now = now()
            where id = p_room_id
            returning * into v_room;
            v_room := public.purrfect_survival_enter_round4(p_room_id, v_winner);
        end if;
    end if;

    if v_room.status = 'round4' then
        if v_room.round4_started_at is not null
           and v_now >= v_room.round4_started_at + interval '7 seconds' then
            if v_room.round4_ends_at is not null and v_now >= v_room.round4_ends_at then
                update public.purrfect_survival_players
                set status = 'eliminated',
                    ghost = true,
                    eliminated_reason = 'dalgona_timeout'
                where room_id = p_room_id
                  and is_playing
                  and dalgona_pattern is not null
                  and dalgona_finished_at is null
                  and status <> 'eliminated';
            end if;

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
        end if;
    end if;

    update public.purrfect_survival_rooms
    set server_now = now()
    where id = p_room_id
    returning * into v_room;

    -- Large banks are cached by the client after the first fetch.
    v_room.questions := '[]'::jsonb;
    v_room.tug_questions := '[]'::jsonb;
    return v_room;
end;
$fn$;

-- ---------- glass jump (window now 7 seconds) ----------

-- Glass jump. correct -> next step; wrong -> fall (correct pane is lit);
-- no jump within 7 s -> fall with no reveal. Each player is validated
-- against their own glass_order, never the shared array as if everybody
-- had already revealed it. The shared bank is not mutated with reveal
-- flags, so the next jumper starts clean.
create or replace function public.glass_jump_purrfect_survival(
    p_room_id uuid,
    p_side text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
    v_player public.purrfect_survival_players;
    v_side text;
    v_index int;
    v_bank_index int;
    v_steps jsonb;
    v_step jsonb;
    v_order jsonb;
    v_correct_side text;
    v_outcome text;
    v_new_step int;
    v_len int;
    v_finished boolean := false;
    v_log jsonb := '[]'::jsonb;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if not public.is_purrfect_survival_member(p_room_id) then
        raise exception 'NOT_A_MEMBER';
    end if;

    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.status <> 'round2' then
        return jsonb_build_object('ok', false, 'error', 'NOT_ROUND2');
    end if;

    select * into v_player
    from public.purrfect_survival_players
    where room_id = p_room_id and user_id = auth.uid()
    for update;

    if not found or not v_player.is_playing or v_player.status <> 'alive' then
        return jsonb_build_object('ok', false, 'error', 'NOT_PLAYING');
    end if;
    if not v_player.glass_active then
        return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    end if;

    v_steps := coalesce(v_room.glass_steps, '[]'::jsonb);
    v_len := jsonb_array_length(v_steps);
    v_order := coalesce(
        nullif(v_player.glass_order, '[]'::jsonb),
        public.purrfect_survival_glass_order(v_room.seed, v_player.user_id, v_len)
    );
    v_bank_index := coalesce((v_order ->> v_player.glass_step)::int, -1);
    v_step := case when v_bank_index >= 0 and v_bank_index < v_len
        then v_steps -> v_bank_index else null end;

    -- Server-side 7 second window. The pane text is logged for the
    -- post-ceremony report, but the class is not shown the answer.
    if v_player.glass_started_at is not null
       and now() - v_player.glass_started_at >= interval '7 seconds' then
        if v_step is not null then
            v_log := jsonb_build_array(jsonb_build_object(
                'round', 2,
                'kind', 'glass_timeout',
                'prompt', coalesce(v_step ->> 'prompt', ''),
                'left', coalesce(v_step ->> 'left', ''),
                'right', coalesce(v_step ->> 'right', ''),
                'choice', null,
                'answer', coalesce(v_step ->> 'correct_side', ''),
                'correct', false,
                'at', now()
            ));
        end if;
        update public.purrfect_survival_players
        set status = 'eliminated',
            ghost = true,
            eliminated_reason = 'glass_timeout',
            glass_active = false,
            answer_log = coalesce(answer_log, '[]'::jsonb) || v_log
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_player;

        perform public.purrfect_survival_release_glass(p_room_id);
        v_room := public.purrfect_survival_finish_if_done(p_room_id);
        return jsonb_build_object(
            'ok', true,
            'outcome', 'timeout',
            'correct_side', null,
            'revealed', false,
            'player', to_jsonb(v_player),
            'room', to_jsonb(v_room) - 'questions'
        );
    end if;

    v_side := lower(trim(coalesce(p_side, '')));
    if v_side not in ('left', 'right') then
        return jsonb_build_object('ok', false, 'error', 'INVALID_SIDE');
    end if;

    if v_step is null then
        return jsonb_build_object('ok', false, 'error', 'INVALID_STEP');
    end if;

    v_index := v_player.glass_step;
    v_correct_side := v_step ->> 'correct_side';
    v_outcome := case when v_side = v_correct_side then 'correct' else 'wrong' end;

    if v_outcome = 'wrong' then
        v_log := jsonb_build_array(jsonb_build_object(
            'round', 2,
            'kind', 'glass',
            'prompt', coalesce(v_step ->> 'prompt', ''),
            'left', coalesce(v_step ->> 'left', ''),
            'right', coalesce(v_step ->> 'right', ''),
            'choice', v_side,
            'answer', v_correct_side,
            'correct', false,
            'at', now()
        ));
    end if;

    if v_outcome = 'correct' then
        v_new_step := v_index + 1;
        if v_new_step >= v_len then
            v_finished := true;
            update public.purrfect_survival_players
            set glass_step = v_new_step,
                glass_side = v_side,
                glass_active = false,
                glass_finished_at = now(),
                crossed_glass = true,
                status = 'advanced',
                answer_log = coalesce(answer_log, '[]'::jsonb) || v_log,
                last_seen = now()
            where room_id = p_room_id and user_id = auth.uid()
            returning * into v_player;
        else
            update public.purrfect_survival_players
            set glass_step = v_new_step,
                glass_side = v_side,
                glass_active = true,
                glass_started_at = now(),
                crossed_glass = false,
                status = 'alive',
                answer_log = coalesce(answer_log, '[]'::jsonb) || v_log,
                last_seen = now()
            where room_id = p_room_id and user_id = auth.uid()
            returning * into v_player;
        end if;
    else
        update public.purrfect_survival_players
        set glass_side = v_side,
            glass_active = false,
            status = 'eliminated',
            ghost = true,
            eliminated_reason = 'glass',
            answer_log = coalesce(answer_log, '[]'::jsonb) || v_log,
            last_seen = now()
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_player;
    end if;

    -- Deliberately do NOT write revealed_side back to the shared bank:
    -- each student's sequence is different, so a shared reveal would leak
    -- a pane that does not belong to the next jumper's question.
    perform public.purrfect_survival_release_glass(p_room_id);
    v_room := public.purrfect_survival_finish_if_done(p_room_id);

    return jsonb_build_object(
        'ok', true,
        'outcome', v_outcome,
        'finished_bridge', v_finished,
        'correct_side', v_correct_side,
        'revealed', true,
        'step_index', v_bank_index,
        'player', to_jsonb(v_player),
        'room', to_jsonb(v_room) - 'questions'
    );
end;
$$;

revoke all on function public.tick_purrfect_survival(uuid) from public, anon;
revoke all on function public.glass_jump_purrfect_survival(uuid, text) from public, anon;

grant execute on function public.tick_purrfect_survival(uuid) to authenticated;
grant execute on function public.glass_jump_purrfect_survival(uuid, text) to authenticated;

notify pgrst, 'reload schema';
