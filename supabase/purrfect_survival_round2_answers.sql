-- ============================================================================
-- LearniTY · Purr-fect Survival — Round 2 lights + per-student order + reports
-- ============================================================================
--
-- WHAT THIS DOES
--   • Glass Stepping Stones shows lights only (no vocab on the 3D bridge).
--   • Every student gets their own deterministic glass_order from the same
--     topic bank, so the classmate ahead cannot hand over the answers.
--   • answer_log records each student's own mistakes (Round 1 wrong answers
--     and red-light notes, Round 2 wrong/timeout panes, Round 3 wrong tug
--     answers) for the post-ceremony report.
--
-- HOW TO INSTALL
--   1. Open the live Supabase project (mggnwzirjmibreimrwiq) SQL editor:
--      https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--   2. Clear the editor completely.
--   3. Paste this whole file and Run once.
--   4. Run it AFTER the host-settings, tug, ceremony and qualifier
--      incrementals. The qualifier file is still needed for the live
--      7-second glass release delay; this file keeps that delay.
--
-- Safe to re-run. Do NOT re-run older incrementals after this file.
-- Do NOT run this through a plugin, CLI or agent — paste it in the SQL editor.
-- ============================================================================

alter table public.purrfect_survival_players
    add column if not exists answer_log jsonb not null default '[]'::jsonb,
    add column if not exists glass_order jsonb not null default '[]'::jsonb;

-- Deterministic per-student glass order. One shared topic bank is handed
-- out in a different sequence to each student, so the classmate ahead cannot
-- give the answers away. Mirrors PSEngine.glassOrderForPlayer (FNV-1a seed +
-- mulberry32 + Fisher-Yates), all in uint32 arithmetic.
create or replace function public.purrfect_survival_glass_order(
    p_seed bigint,
    p_user uuid,
    p_len int
) returns jsonb
language plpgsql
immutable
as $$
declare
    v_len int := greatest(1, least(15, coalesce(p_len, 9)));
    v_text text;
    v_hash bigint := 2166136261;
    v_a bigint;
    v_t bigint;
    v_u bigint;
    v_i int;
    v_j int;
    v_tmp int;
    v_arr int[] := '{}';
    v_out jsonb := '[]'::jsonb;
begin
    v_text := coalesce(p_seed, 1)::text || '|' || coalesce(p_user::text, '') || '|glass';
    for v_i in 1..char_length(v_text) loop
        v_hash := ((v_hash # ascii(substr(v_text, v_i, 1))) * 16777619) & 4294967295;
    end loop;

    for v_i in 0..v_len - 1 loop
        v_arr := v_arr || v_i;
    end loop;

    v_a := v_hash;
    v_i := v_len - 1;
    while v_i > 0 loop
        v_a := (v_a + 1831565813) & 4294967295;
        v_t := (v_a # (v_a >> 15)) & 4294967295;
        v_t := (v_t * ((1 | v_a) & 4294967295)) & 4294967295;
        v_u := (v_t # (v_t >> 7)) & 4294967295;
        v_u := (v_u * ((61 | v_t) & 4294967295)) & 4294967295;
        v_t := ((v_t + v_u) & 4294967295) # v_t;
        v_j := floor(
            ((((v_t # (v_t >> 14)) & 4294967295)::double precision) / 4294967296.0)
            * (v_i + 1)
        )::int;
        v_tmp := v_arr[v_i + 1];
        v_arr[v_i + 1] := v_arr[v_j + 1];
        v_arr[v_j + 1] := v_tmp;
        v_i := v_i - 1;
    end loop;

    for v_i in 1..v_len loop
        v_out := v_out || to_jsonb(v_arr[v_i]);
    end loop;
    return v_out;
end;
$$;

-- Moves a round-1 room to the glass bridge. Survivors keep status=alive
-- and receive round1_rank (the queue order); the cut becomes ghosts. Each
-- player also receives their own deterministic glass_order.
create or replace function public.purrfect_survival_begin_round2(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
    v_len int;
begin
    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.status <> 'round1' then
        return v_room;
    end if;

    v_len := jsonb_array_length(coalesce(v_room.glass_steps, '[]'::jsonb));

    with ranked as (
        select
            p.user_id,
            row_number() over (
                order by
                    case when p.distance >= v_room.finish_distance or p.reached_finish then 0 else 1 end asc,
                    case when p.distance >= v_room.finish_distance or p.reached_finish
                         then coalesce(p.finished_at, 'infinity'::timestamptz)
                         else 'infinity'::timestamptz end asc,
                    p.distance desc,
                    p.user_id asc
            ) as rn
        from public.purrfect_survival_players p
        where p.room_id = p_room_id
          and p.status = 'alive'
          and p.is_playing
    )
    update public.purrfect_survival_players p
    set status = case when r.rn <= 15 then 'alive' else 'eliminated' end,
        round1_rank = case when r.rn <= 15 then r.rn else null end,
        ghost = case when r.rn <= 15 then false else true end,
        eliminated_reason = case when r.rn <= 15 then null else 'round1_cut' end,
        glass_step = 0,
        glass_side = null,
        glass_active = false,
        glass_started_at = null,
        crossed_glass = false,
        glass_order = public.purrfect_survival_glass_order(v_room.seed, p.user_id, v_len)
    from ranked r
    where p.user_id = r.user_id
      and p.room_id = p_room_id;

    update public.purrfect_survival_rooms
    set status = 'round2',
        current_round = 2,
        round2_started_at = now(),
        round2_ends_at = now() + interval '10 minutes',
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    perform public.purrfect_survival_release_glass(p_room_id);
    return v_room;
end;
$$;

-- Releases exactly one queued player onto step 0 once nobody living is
-- still standing on step 0. A player who moved to step 1+ or fell
-- unblocks the classmate behind them. The qualifier board keeps the first
-- 7 seconds clear (Round 2 starts after the board).
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
    v_seed bigint;
    v_len int;
begin
    select status, round2_started_at, seed,
           jsonb_array_length(coalesce(glass_steps, '[]'::jsonb))
      into v_status, v_started, v_seed, v_len
      from public.purrfect_survival_rooms
     where id = p_room_id;

    if v_status = 'round2'
       and v_started is not null
       and now() < v_started + interval '7 seconds' then
        return;
    end if;

    -- Late joiners / rows created before the order column get an order too.
    update public.purrfect_survival_players p
    set glass_order = public.purrfect_survival_glass_order(v_seed, p.user_id, v_len)
    where p.room_id = p_room_id
      and (p.glass_order is null or p.glass_order = '[]'::jsonb);

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

-- Glass jump. correct -> next step; wrong -> fall (correct pane is lit);
-- no jump within 5 s -> fall with no reveal. Each player is validated
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

    -- Server-side 5 second window. The pane text is logged for the
    -- post-ceremony report, but the class is not shown the answer.
    if v_player.glass_started_at is not null
       and now() - v_player.glass_started_at >= interval '5 seconds' then
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

create or replace function public.submit_purrfect_survival_answer(
    p_room_id uuid,
    p_choice int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
    v_player public.purrfect_survival_players;
    v_phase record;
    v_elapsed bigint;
    v_question jsonb;
    v_qcount int;
    v_correct boolean := false;
    v_offences int;
    v_penalty int := 0;
    v_eliminated boolean := false;
    v_distance int;
    v_state jsonb;
    v_bank jsonb;
    v_now_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
    v_team text;
    v_old_red int;
    v_old_blue int;
    v_pull int := 0;
    v_rage boolean := false;
    v_winner text;
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
    -- Round 3: tug answer against the tug bank (fallback to the main bank
    -- only when no tug bank was stored).
    if v_room.status = 'round3' then
        select * into v_player
        from public.purrfect_survival_players
        where room_id = p_room_id and user_id = auth.uid()
        for update;

        if not found
           or not v_player.is_playing
           or v_player.ghost
           or v_player.status = 'eliminated'
           or v_player.tug_team is null then
            return jsonb_build_object('ok', false, 'error', 'NOT_PLAYING');
        end if;

        v_state := coalesce(v_room.tug_state, public.purrfect_survival_empty_tug());
        if coalesce(v_state ->> 'phase', 'briefing') <> 'playing'
           or coalesce(v_state ->> 'winner', '') <> '' then
            return jsonb_build_object('ok', false, 'error', 'NOT_PLAYING');
        end if;

        v_bank := case
            when jsonb_array_length(coalesce(v_room.tug_questions, '[]'::jsonb)) > 0
                then v_room.tug_questions
            else coalesce(v_room.questions, '[]'::jsonb)
        end;
        v_qcount := jsonb_array_length(v_bank);
        if v_qcount = 0 then
            return jsonb_build_object('ok', false, 'error', 'NO_QUESTIONS');
        end if;
        v_question := v_bank -> (v_player.question_index % v_qcount);
        v_correct := (p_choice = coalesce((v_question ->> 'answer')::int, -1));

        if not v_correct then
            v_log := jsonb_build_array(jsonb_build_object(
                'round', 3,
                'kind', 'tug',
                'prompt', coalesce(v_question ->> 'prompt', ''),
                'choice', coalesce((v_question -> 'options') ->> p_choice, ''),
                'answer', coalesce((v_question -> 'options') ->> ((v_question ->> 'answer')::int), ''),
                'correct', false,
                'at', now()
            ));
        end if;

        v_team := v_player.tug_team;
        v_old_red := coalesce((v_state ->> 'redPull')::int, 0);
        v_old_blue := coalesce((v_state ->> 'bluePull')::int, 0);
        v_rage := coalesce((v_state ->> (v_team || 'RageUntil'))::bigint, 0) > v_now_ms;

        v_state := public.purrfect_survival_apply_tug(v_state, v_team, v_correct, v_now_ms);
        v_winner := nullif(v_state ->> 'winner', '');
        v_pull := case
            when v_team = 'red' then coalesce((v_state ->> 'redPull')::int, 0) - v_old_red
            else coalesce((v_state ->> 'bluePull')::int, 0) - v_old_blue
        end;

        update public.purrfect_survival_players
        set question_index = v_player.question_index + 1,
            answer_log = coalesce(answer_log, '[]'::jsonb) || v_log,
            last_seen = now()
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_player;

        update public.purrfect_survival_rooms
        set tug_state = v_state,
            server_now = now()
        where id = p_room_id
        returning * into v_room;

        if v_winner is not null then
            update public.purrfect_survival_players
            set status = 'eliminated',
                ghost = true,
                eliminated_reason = 'tug'
            where room_id = p_room_id
              and tug_team is not null
              and tug_team <> v_winner;

            update public.purrfect_survival_players
            set status = 'advanced',
                ghost = false,
                eliminated_reason = null
            where room_id = p_room_id
              and tug_team = v_winner;

            update public.purrfect_survival_rooms
            set status = 'finished',
                current_round = 3,
                finished_at = coalesce(finished_at, now()),
                server_now = now()
            where id = p_room_id
            returning * into v_room;
        end if;

        return jsonb_build_object(
            'ok', true,
            'correct', v_correct,
            'pull', v_pull,
            'combo', coalesce((v_state ->> (v_team || 'Combo'))::int, 0),
            'rage', case
                when v_rage then true
                else coalesce((v_state ->> (v_team || 'RageUntil'))::bigint, 0) > v_now_ms
            end,
            'position', coalesce((v_state ->> 'position')::int, 0),
            'winner', v_winner,
            'player', to_jsonb(v_player),
            'tug_state', v_state,
            'room', to_jsonb(v_room) - 'questions' - 'tug_questions'
        );
    end if;

    if v_room.status <> 'round1' then
        return jsonb_build_object('ok', false, 'error', 'NOT_ROUND1');
    end if;

    select * into v_player
    from public.purrfect_survival_players
    where room_id = p_room_id and user_id = auth.uid()
    for update;

    if not found or not v_player.is_playing or v_player.status <> 'alive' then
        return jsonb_build_object('ok', false, 'error', 'NOT_PLAYING');
    end if;

    v_elapsed := greatest(0, floor(extract(epoch from (now() - v_room.round1_started_at)) * 1000))::bigint;
    select * into v_phase
    from public.purrfect_survival_phase(v_room.phase_schedule, v_elapsed);

    if v_phase.phase in ('green', 'yellow') then
        v_qcount := jsonb_array_length(v_room.questions);
        if v_qcount = 0 then
            return jsonb_build_object('ok', false, 'error', 'NO_QUESTIONS');
        end if;
        v_question := v_room.questions -> (v_player.question_index % v_qcount);
        v_correct := (p_choice = coalesce((v_question ->> 'answer')::int, -1));

        if not v_correct then
            v_log := jsonb_build_array(jsonb_build_object(
                'round', 1,
                'kind', 'answer',
                'prompt', coalesce(v_question ->> 'prompt', ''),
                'choice', coalesce((v_question -> 'options') ->> p_choice, ''),
                'answer', coalesce((v_question -> 'options') ->> ((v_question ->> 'answer')::int), ''),
                'correct', false,
                'at', now()
            ));
        end if;

        v_distance := v_player.distance;
        if v_correct then
            v_distance := least(v_room.finish_distance, v_player.distance + 10);
        end if;

        update public.purrfect_survival_players
        set distance = v_distance,
            question_index = v_player.question_index + 1,
            answer_log = coalesce(answer_log, '[]'::jsonb) || v_log,
            reached_finish = (v_distance >= v_room.finish_distance),
            finished_at = case
                when v_distance >= v_room.finish_distance and finished_at is null then now()
                else finished_at
            end,
            last_seen = now()
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_player;

        return jsonb_build_object(
            'ok', true,
            'phase', v_phase.phase,
            'phase_index', v_phase.phase_index,
            'remaining_ms', v_phase.remaining_ms,
            'correct', v_correct,
            'penalty', 0,
            'eliminated', false,
            'player', to_jsonb(v_player)
        );
    end if;

    -- RED (or the schedule ran out): a press is a laser hit.
    if v_player.last_red_phase = v_phase.phase_index then
        return jsonb_build_object(
            'ok', true,
            'phase', v_phase.phase,
            'phase_index', v_phase.phase_index,
            'remaining_ms', v_phase.remaining_ms,
            'correct', false,
            'penalty', 0,
            'ignored', true,
            'eliminated', false,
            'player', to_jsonb(v_player)
        );
    end if;

    v_offences := v_player.red_offences + 1;
    v_distance := v_player.distance;

    if v_offences = 1 then
        v_penalty := -30;
        v_distance := greatest(0, v_distance - 30);
    elsif v_offences = 2 then
        v_penalty := -15;
        v_distance := greatest(0, v_distance - 15);
    else
        v_penalty := 0;
        v_eliminated := true;
    end if;

    v_log := jsonb_build_array(jsonb_build_object(
        'round', 1,
        'kind', 'red',
        'note', case when v_eliminated then 'Eliminated on red light' else 'Moved on red light' end,
        'penalty', v_penalty,
        'correct', false,
        'at', now()
    ));

    update public.purrfect_survival_players
    set distance = v_distance,
        red_offences = v_offences,
        last_red_phase = v_phase.phase_index,
        answer_log = coalesce(answer_log, '[]'::jsonb) || v_log,
        status = case when v_eliminated then 'eliminated' else status end,
        ghost = case when v_eliminated then true else ghost end,
        eliminated_reason = case when v_eliminated then 'red_light' else eliminated_reason end,
        last_seen = now()
    where room_id = p_room_id and user_id = auth.uid()
    returning * into v_player;

    return jsonb_build_object(
        'ok', true,
        'phase', v_phase.phase,
        'phase_index', v_phase.phase_index,
        'remaining_ms', v_phase.remaining_ms,
        'correct', false,
        'penalty', v_penalty,
        'eliminated', v_eliminated,
        'player', to_jsonb(v_player)
    );
end;
$$;

-- Glass jump. correct -> next step; wrong -> fall (correct pane is lit);
-- no jump within 5 s -> fall with no reveal. The next queued player is
-- released as soon as step 0 is clear.
-- Glass jump. correct -> next step; wrong -> fall (correct pane is lit);
-- no jump within 5 s -> fall with no reveal. Each player is validated
-- against their own glass_order, never the shared array as if everybody
-- had already revealed it. The shared bank is not mutated with reveal
-- flags, so the next jumper starts clean.

-- New/rematch games start with an empty mistake log.
create or replace function public.start_purrfect_survival(
    p_room_id uuid,
    p_questions jsonb,
    p_glass jsonb,
    p_schedule jsonb,
    p_round_ms int default 180000,
    p_tug_questions jsonb default '[]'::jsonb
) returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
    v_count int;
    v_item jsonb;
    v_glass jsonb := '[]'::jsonb;
    v_round_count int;
    v_tug jsonb := '[]'::jsonb;
    i int;
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
    if v_room.status <> 'waiting' then
        raise exception 'ROOM_ALREADY_STARTED';
    end if;

    v_round_count := public.purrfect_survival_round_count(v_room.settings);

    select count(*) into v_count
    from public.purrfect_survival_players
    where room_id = p_room_id and is_playing;

    if v_count < 2 then
        raise exception 'CANNOT_START';
    end if;

    if p_questions is null
       or jsonb_typeof(p_questions) <> 'array'
       or jsonb_array_length(p_questions) = 0 then
        raise exception 'NO_QUESTIONS';
    end if;
    if p_schedule is null
       or jsonb_typeof(p_schedule) <> 'array'
       or jsonb_array_length(p_schedule) = 0 then
        raise exception 'NO_SCHEDULE';
    end if;
    if v_round_count > 1 then
        if p_glass is null
           or jsonb_typeof(p_glass) <> 'array'
           or jsonb_array_length(p_glass) = 0 then
            raise exception 'NO_GLASS';
        end if;
    end if;

    for i in 0..jsonb_array_length(p_schedule) - 1 loop
        v_item := p_schedule -> i;
        if coalesce(v_item ->> 'phase', '') not in ('green', 'yellow', 'red')
           or coalesce((v_item ->> 'duration_ms')::int, 0) <= 0 then
            raise exception 'INVALID_SCHEDULE';
        end if;
    end loop;

    if p_glass is not null
       and jsonb_typeof(p_glass) = 'array'
       and jsonb_array_length(p_glass) > 0 then
        for i in 0..jsonb_array_length(p_glass) - 1 loop
            v_item := p_glass -> i;
            if coalesce(v_item ->> 'left', '') = ''
               or coalesce(v_item ->> 'right', '') = ''
               or coalesce(v_item ->> 'correct_side', '') not in ('left', 'right') then
                raise exception 'INVALID_GLASS';
            end if;
            v_item := jsonb_set(v_item, '{revealed}', 'false'::jsonb, true);
            v_item := jsonb_set(v_item, '{revealed_side}', 'null'::jsonb, true);
            v_item := jsonb_set(v_item, '{shattered_side}', 'null'::jsonb, true);
            v_glass := v_glass || jsonb_build_array(v_item);
        end loop;
    end if;

    if p_tug_questions is not null
       and jsonb_typeof(p_tug_questions) = 'array'
       and jsonb_array_length(p_tug_questions) > 0 then
        v_tug := p_tug_questions;
    else
        v_tug := coalesce(v_room.tug_questions, '[]'::jsonb);
    end if;

    update public.purrfect_survival_players
    set distance = 0,
        red_offences = 0,
        status = 'alive',
        ghost = false,
        eliminated_reason = null,
        question_index = 0,
        last_red_phase = -1,
        reached_finish = false,
        finished_at = null,
        round1_rank = null,
        glass_step = 0,
        glass_side = null,
        glass_active = false,
        glass_started_at = null,
        glass_finished_at = null,
        crossed_glass = false,
        tug_team = null,
        answer_log = '[]'::jsonb,
        glass_order = '[]'::jsonb,
        last_seen = now()
    where room_id = p_room_id and is_playing;

    update public.purrfect_survival_rooms
    set status = 'round1',
        current_round = 1,
        questions = p_questions,
        glass_steps = v_glass,
        tug_questions = v_tug,
        tug_state = '{}'::jsonb,
        phase_schedule = p_schedule,
        round1_started_at = now(),
        round1_ends_at = now() + make_interval(secs => (greatest(30, coalesce(p_round_ms, 180000)) / 1000.0)::double precision),
        round2_started_at = null,
        round2_ends_at = null,
        round3_started_at = null,
        round3_ends_at = null,
        started_at = now(),
        finished_at = null,
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$$;


notify pgrst, 'reload schema';
