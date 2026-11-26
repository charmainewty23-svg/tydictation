-- ============================================================
-- LearniTY — Purr-fect Survival: Round 5 Grammar Finals
--
-- PASTE THIS FILE INTO THE LIVE PROJECT'S SUPABASE SQL EDITOR:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--
-- Clear the editor first.
-- Paste this AFTER all existing Survival incrementals have already run,
-- including:
--   purrfect_survival_round4_dalgona.sql
--   purrfect_survival_glass_order_bigint.sql
--   purrfect_survival_end_rounds.sql
--   purrfect_survival_glass_window_7s.sql
-- Do NOT re-run any older incrementals after this file.
-- Never run this from a plugin, CLI or agent: the teacher pastes it.
-- Safe to re-run.
--
-- What it adds, in teacher-friendly language:
--   * The lobby can now choose 5 rounds. Round 5 is the Grammar Finals and
--     starts automatically after Dalgona, for every Dalgona survivor.
--   * If fewer than 2 Dalgona survivors remain, Round 5 is skipped and the
--     normal prize ceremony starts immediately (same idea as the Tug skip).
--   * Finals default to 120 seconds; the host can choose 60–180 seconds in
--     the lobby. When the clock expires, cats are ranked by finals_progress
--     (farther from the electric fence is better). If only one cat remains,
--     the finals end early.
--   * Error Spotting (6 s, 4 tappable parts) and Double-Trap Cloze (8 s,
--     both blanks required) pay the existing grammar bank. A wrong answer
--     or timeout slips 25 back; a wrong answer at 0 is electrocuted.
--   * Every 3 correct answers in a row fires a paw-wave that knocks the
--     nearest living opponent back 15 (never electrocutes).
--   * Eliminated students become ghosts: two correct easy revival answers
--     earn an ink bomb that covers the current leader's question for 1.5 s.
--   * The host can press "End round 5"; end_purrfect_survival_round() now
--     handles Round 5 as well as rounds 2–4.
--   * Conditionals are NOT invented yet. When a later generated bank is
--     added to the client, it can extend the unit list without a new table.
--   * Glass Bridge thinking time stays at 7 seconds (already live after
--     PR #62). This file also replaces tick and glass_jump so pasting it
--     will not revert the window back to 5 seconds.
--   * If purrfect_survival_glass_window_7s.sql was already pasted, still
--     paste THIS file next; do not re-run the older 7s incremental after it.
-- ============================================================

-- ---------- schema ----------

alter table public.purrfect_survival_rooms
    add column if not exists round4_started_at timestamptz,
    add column if not exists round4_ends_at timestamptz,
    add column if not exists round5_started_at timestamptz,
    add column if not exists round5_ends_at timestamptz,
    add column if not exists finals_questions jsonb not null default '[]'::jsonb,
    add column if not exists ghost_questions jsonb not null default '[]'::jsonb;

alter table public.purrfect_survival_players
    add column if not exists dalgona_pattern text,
    add column if not exists dalgona_progress int not null default 0,
    add column if not exists dalgona_cracks int not null default 0,
    add column if not exists dalgona_lick_used boolean not null default false,
    add column if not exists dalgona_finished_at timestamptz,
    add column if not exists dalgona_units jsonb not null default '[]'::jsonb,
    add column if not exists dalgona_item jsonb not null default '{}'::jsonb,
    add column if not exists advanced_round3 boolean not null default false,
    add column if not exists finals_progress int not null default 100,
    add column if not exists finals_combo int not null default 0,
    add column if not exists finals_ghost_correct int not null default 0,
    add column if not exists finals_question_index int not null default 0,
    add column if not exists ink_until timestamptz,
    add column if not exists finals_eliminated_at timestamptz;

alter table public.purrfect_survival_rooms
    drop constraint if exists purrfect_survival_rooms_status_check;
alter table public.purrfect_survival_rooms
    add constraint purrfect_survival_rooms_status_check
    check (status in ('waiting', 'round1', 'round2', 'round3', 'round4', 'round5', 'finished'));

-- ---------- helpers ----------

-- Implemented rounds are now 1–5. Old rooms still default to 2.
create or replace function public.purrfect_survival_round_count(p_settings jsonb)
returns int
language plpgsql
immutable
as $fn$
declare
    v_raw text;
begin
    if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
        return 2;
    end if;
    v_raw := p_settings ->> 'roundCount';
    if v_raw is null or v_raw !~ '^[0-9]+$' then
        return 2;
    end if;
    return least(5, greatest(1, v_raw::int));
end;
$fn$;

-- Finals duration: default 120 s, clamped to 60–180 s. The lobby saves
-- milliseconds; a value <= 600 is treated as seconds.
create or replace function public.purrfect_survival_finals_duration(p_settings jsonb, p_default int default 120000)
returns int
language plpgsql
immutable
as $fn$
declare
    v_raw text;
    v_idx int;
    v_round jsonb;
    v_num numeric;
begin
    if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
        return coalesce(p_default, 120000);
    end if;
    v_raw := p_settings ->> 'finalsDuration';
    if v_raw is null then
        v_raw := p_settings ->> 'finals_duration';
    end if;
    if v_raw is null and jsonb_typeof(p_settings -> 'rounds') = 'array' then
        for v_idx in 0..jsonb_array_length(p_settings -> 'rounds') - 1 loop
            v_round := p_settings -> 'rounds' -> v_idx;
            if coalesce(v_round ->> 'round', '') = '5' then
                v_raw := v_round ->> 'finalsDuration';
                exit;
            end if;
        end loop;
    end if;
    if v_raw is null or v_raw !~ '^[0-9]+([.][0-9]+)?$' then
        return coalesce(p_default, 120000);
    end if;
    v_num := v_raw::numeric;
    if v_num <= 600 then
        v_num := v_num * 1000;
    end if;
    return greatest(60000, least(180000, round(v_num)::int));
end;
$fn$;

-- ---------- start (ships the shared finals + ghost decks) ----------

drop function if exists public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb);
drop function if exists public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb, jsonb);

create or replace function public.start_purrfect_survival(
    p_room_id uuid,
    p_questions jsonb,
    p_glass jsonb,
    p_schedule jsonb,
    p_round_ms int default 180000,
    p_tug_questions jsonb default '[]'::jsonb,
    p_dalgona jsonb default '[]'::jsonb,
    p_finals jsonb default '[]'::jsonb
) returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_count int;
    v_item jsonb;
    v_glass jsonb := '[]'::jsonb;
    v_round_count int;
    v_tug jsonb := '[]'::jsonb;
    v_finals jsonb := '[]'::jsonb;
    v_ghosts jsonb := '[]'::jsonb;
    v_uid uuid;
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
    if coalesce(v_room.settings ->> 'roundCount', '') ~ '^[0-9]+$'
       and (v_room.settings ->> 'roundCount')::int > 5 then
        raise exception 'ROUNDS_NOT_IMPLEMENTED';
    end if;

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

    if p_finals is not null and jsonb_typeof(p_finals) = 'object' then
        v_finals := coalesce(p_finals -> 'questions', '[]'::jsonb);
        v_ghosts := coalesce(p_finals -> 'ghosts', '[]'::jsonb);
    elsif p_finals is not null and jsonb_typeof(p_finals) = 'array' then
        v_finals := p_finals;
        v_ghosts := coalesce(v_room.ghost_questions, '[]'::jsonb);
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
        advanced_round3 = false,
        dalgona_pattern = null,
        dalgona_progress = 0,
        dalgona_cracks = 0,
        dalgona_lick_used = false,
        dalgona_finished_at = null,
        dalgona_units = '[]'::jsonb,
        dalgona_item = '{}'::jsonb,
        finals_progress = 100,
        finals_combo = 0,
        finals_ghost_correct = 0,
        finals_question_index = 0,
        ink_until = null,
        finals_eliminated_at = null,
        last_seen = now()
    where room_id = p_room_id and is_playing;

    if v_round_count >= 4 and p_dalgona is not null and jsonb_typeof(p_dalgona) = 'array' then
        for v_item in select * from jsonb_array_elements(p_dalgona) loop
            begin
                v_uid := (v_item ->> 'user_id')::uuid;
            exception when others then
                continue;
            end;
            update public.purrfect_survival_players
            set dalgona_pattern = coalesce(v_item ->> 'pattern', ''),
                dalgona_units = coalesce(v_item -> 'units', '[]'::jsonb),
                dalgona_item = coalesce(v_item -> 'item', v_item),
                dalgona_progress = 0,
                dalgona_cracks = 0,
                dalgona_lick_used = false,
                dalgona_finished_at = null
            where room_id = p_room_id and user_id = v_uid;
        end loop;
    end if;

    update public.purrfect_survival_rooms
    set status = 'round1',
        current_round = 1,
        questions = p_questions,
        glass_steps = v_glass,
        tug_questions = v_tug,
        tug_state = '{}'::jsonb,
        phase_schedule = p_schedule,
        settings = case
            when v_round_count >= 5 then jsonb_set(
                jsonb_set(v_room.settings, '{finalsDuration}',
                    to_jsonb(public.purrfect_survival_finals_duration(v_room.settings, 120000)), true),
                '{roundCount}', '5'::jsonb, true)
            else v_room.settings
        end,
        finals_questions = coalesce(v_finals, '[]'::jsonb),
        ghost_questions = coalesce(v_ghosts, '[]'::jsonb),
        round1_started_at = now(),
        round1_ends_at = now() + make_interval(secs => (greatest(30, coalesce(p_round_ms, 180000)) / 1000.0)::double precision),
        round2_started_at = null,
        round2_ends_at = null,
        round3_started_at = null,
        round3_ends_at = null,
        round4_started_at = null,
        round4_ends_at = null,
        round5_started_at = null,
        round5_ends_at = null,
        started_at = now(),
        finished_at = null,
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$fn$;

-- ---------- create (accept 5 rounds + store the finals duration) ----------

create or replace function public.create_purrfect_survival(
    p_subject text default 'vocab',
    p_source text default '',
    p_topic text default '',
    p_bank_mode text default '',
    p_seed bigint default null,
    p_settings jsonb default '{}'::jsonb,
    p_teacher_plays boolean default true,
    p_nickname text default null,
    p_look jsonb default '{}'::jsonb
) returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_code text;
    v_room public.purrfect_survival_rooms;
    v_seed bigint;
    v_try int := 0;
    v_is_teacher boolean;
    v_plays boolean;
    v_max int;
    v_look jsonb;
    v_settings jsonb;
    v_finish int;
    v_round jsonb;
    v_idx int;
    i int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    if coalesce(p_subject, '') not in ('vocab', 'grammar') then
        raise exception 'INVALID_SUBJECT';
    end if;

    v_settings := coalesce(p_settings, '{}'::jsonb);
    if jsonb_typeof(v_settings) <> 'object' then
        v_settings := '{}'::jsonb;
    end if;
    if coalesce(v_settings ->> 'roundCount', '') ~ '^[0-9]+$'
       and (v_settings ->> 'roundCount')::int > 5 then
        raise exception 'ROUNDS_NOT_IMPLEMENTED';
    end if;
    v_finish := public.purrfect_survival_finish_value(v_settings, 100);
    v_settings := jsonb_set(v_settings, '{finishDistance}', to_jsonb(v_finish), true);
    if public.purrfect_survival_round_count(v_settings) > 1 then
        v_settings := jsonb_set(v_settings, '{glassSteps}',
            to_jsonb(public.purrfect_survival_glass_count(v_settings, 9)), true);
    end if;
    if public.purrfect_survival_round_count(v_settings) >= 3 then
        v_settings := jsonb_set(v_settings, '{tugDuration}',
            to_jsonb(public.purrfect_survival_tug_duration(v_settings, 60000)), true);
    end if;
    if public.purrfect_survival_round_count(v_settings) >= 4 then
        v_settings := jsonb_set(v_settings, '{dalgonaDuration}',
            to_jsonb(public.purrfect_survival_dalgona_duration(v_settings, 180000)), true);
    end if;
    if public.purrfect_survival_round_count(v_settings) >= 5 then
        v_settings := jsonb_set(v_settings, '{finalsDuration}',
            to_jsonb(public.purrfect_survival_finals_duration(v_settings, 120000)), true);
    end if;

    if v_settings ? 'rounds' and jsonb_typeof(v_settings -> 'rounds') = 'array' then
        for v_idx in 0..jsonb_array_length(v_settings -> 'rounds') - 1 loop
            v_round := v_settings -> 'rounds' -> v_idx;
            if coalesce(v_round ->> 'subject', '') not in ('vocab', 'grammar') then
                raise exception 'INVALID_SUBJECT';
            end if;
            if coalesce(v_round ->> 'topic', '') = '' then
                raise exception 'INVALID_TOPIC';
            end if;
        end loop;
    end if;

    delete from public.purrfect_survival_rooms
    where created_at < now() - interval '12 hours';

    v_seed := coalesce(p_seed, floor(random() * 2000000000)::bigint + 1);
    v_is_teacher := public.is_purrfect_survival_teacher();
    v_plays := (not v_is_teacher) or coalesce(p_teacher_plays, true);
    v_max := case when v_is_teacher and v_plays then 31 else 30 end;
    v_look := coalesce(p_look, '{}'::jsonb);

    loop
        v_try := v_try + 1;
        v_code := '';
        for i in 1..4 loop
            v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        end loop;
        exit when not exists (
            select 1 from public.purrfect_survival_rooms where code = v_code
        );
        if v_try > 40 then
            raise exception 'ROOM_CODE_FAILED';
        end if;
    end loop;

    insert into public.purrfect_survival_rooms (
        code, host_id, subject, source, topic, bank_mode, seed,
        max_players, finish_distance, settings
    ) values (
        v_code, auth.uid(), p_subject, coalesce(p_source, ''), coalesce(p_topic, ''),
        coalesce(p_bank_mode, ''), v_seed, v_max, v_finish, v_settings
    ) returning * into v_room;

    if v_plays then
        insert into public.purrfect_survival_players (
            room_id, user_id, email, nickname, cat, glasses, hat, outfit
        ) values (
            v_room.id, auth.uid(), coalesce(auth.jwt() ->> 'email', ''),
            coalesce(p_nickname, auth.jwt() ->> 'email', 'Player'),
            coalesce(v_look ->> 'cat', 'Ginger'),
            coalesce(v_look ->> 'glasses', 'None'),
            coalesce(v_look ->> 'hat', 'None'),
            coalesce(v_look ->> 'outfit', 'None')
        );
    end if;

    return v_room;
end;
$fn$;

-- ---------- enter Round 5 (survivors only; skip if fewer than 2) ----------

create or replace function public.purrfect_survival_enter_round5(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_rounds int;
    v_survivors int;
    v_duration int;
begin
    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    v_rounds := public.purrfect_survival_round_count(v_room.settings);

    select count(*) into v_survivors
    from public.purrfect_survival_players
    where room_id = p_room_id
      and coalesce(is_playing, true)
      and dalgona_finished_at is not null;

    -- Fewer than 2 Dalgona survivors: skip the finals and go straight to
    -- the prize ceremony (same skip pattern as Tug with too few survivors).
    if v_rounds < 5 or v_survivors < 2 then
        update public.purrfect_survival_rooms
        set status = 'finished',
            current_round = case when v_rounds >= 5 then 5 else 4 end,
            finished_at = coalesce(finished_at, now()),
            server_now = now()
        where id = p_room_id
        returning * into v_room;
        return v_room;
    end if;

    v_duration := public.purrfect_survival_finals_duration(v_room.settings, 120000);

    update public.purrfect_survival_players
    set status = 'advanced',
        ghost = false,
        eliminated_reason = null,
        finals_progress = 100,
        finals_combo = 0,
        finals_ghost_correct = 0,
        finals_question_index = 0,
        ink_until = null,
        finals_eliminated_at = null
    where room_id = p_room_id
      and coalesce(is_playing, true)
      and dalgona_finished_at is not null;

    update public.purrfect_survival_rooms
    set status = 'round5',
        current_round = 5,
        round5_started_at = now(),
        round5_ends_at = now() + make_interval(secs => (v_duration / 1000.0)::double precision),
        finished_at = null,
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$fn$;

-- ---------- tick (round 3 -> round 4 -> round 5 -> finished) ----------

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
        -- Glass thinking time is 7 seconds (live after PR #62).
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
                -- 5-round rooms move to the finals; 1–4 round rooms finish.
                v_room := public.purrfect_survival_enter_round5(p_room_id);
            end if;
        end if;
    end if;

    if v_room.status = 'round5' then
        select count(*) into v_alive
        from public.purrfect_survival_players
        where room_id = p_room_id
          and coalesce(is_playing, true)
          and dalgona_finished_at is not null
          and finals_eliminated_at is null
          and status <> 'eliminated'
          and not ghost;

        if v_alive <= 1
           or (v_room.round5_ends_at is not null and v_now >= v_room.round5_ends_at) then
            update public.purrfect_survival_rooms
            set status = 'finished',
                current_round = 5,
                finished_at = coalesce(finished_at, v_now),
                server_now = now()
            where id = p_room_id
            returning * into v_room;
        end if;
    end if;

    update public.purrfect_survival_rooms
    set server_now = now()
    where id = p_room_id
    returning * into v_room;

    v_room.questions := '[]'::jsonb;
    v_room.tug_questions := '[]'::jsonb;
    v_room.finals_questions := '[]'::jsonb;
    v_room.ghost_questions := '[]'::jsonb;
    return v_room;
end;
$fn$;

-- ---------- submit one finals answer ----------

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

create or replace function public.submit_purrfect_survival_finals(
    p_room_id uuid,
    p_answer jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_me public.purrfect_survival_players;
    v_target public.purrfect_survival_players;
    v_q jsonb;
    v_count int;
    v_idx int;
    v_ok boolean := false;
    v_before int;
    v_after int;
    v_combo int;
    v_eliminated boolean := false;
    v_bi int;
    v_n int;
    v_text text;
    v_exp text;
    v_knock jsonb := null;
    v_living int;
    i int;
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
    if v_room.status <> 'round5' then
        return jsonb_build_object('ok', false, 'error', 'NOT_PLAYING');
    end if;

    select * into v_me
    from public.purrfect_survival_players
    where room_id = p_room_id and user_id = auth.uid()
    for update;

    if not found then
        raise exception 'NOT_A_MEMBER';
    end if;
    if not coalesce(v_me.is_playing, true)
       or v_me.ghost
       or v_me.status = 'eliminated'
       or v_me.finals_eliminated_at is not null
       or v_me.dalgona_finished_at is null then
        return jsonb_build_object('ok', false, 'error', 'NOT_FINALIST');
    end if;

    v_count := coalesce(jsonb_array_length(v_room.finals_questions), 0);
    if v_count = 0 then
        return jsonb_build_object('ok', false, 'error', 'NO_FINALS_BANK');
    end if;
    v_idx := (coalesce(v_me.finals_question_index, 0) % v_count);
    v_q := v_room.finals_questions -> v_idx;

    if coalesce(v_q ->> 'type', '') = 'error_spotting' then
        begin
            v_n := (p_answer #>> '{}')::int;
        exception when others then
            v_n := -1;
        end;
        v_ok := v_n = coalesce((v_q ->> 'answer')::int, 1);
    elsif coalesce(v_q ->> 'type', '') = 'double_trap' then
        v_ok := jsonb_typeof(p_answer) = 'array'
            and jsonb_array_length(p_answer) = jsonb_array_length(v_q -> 'blanks');
        if v_ok then
            for i in 0..jsonb_array_length(v_q -> 'blanks') - 1 loop
                v_bi := coalesce(((v_q -> 'blanks' -> i) ->> 'answerIndex')::int, 0);
                if jsonb_typeof(p_answer -> i) = 'number' then
                    v_n := ((p_answer -> i) #>> '{}')::int;
                    -- Double-Trap sends 0-based option indices; both blanks
                    -- must match exactly.
                    if v_n <> v_bi then
                        v_ok := false;
                    end if;
                else
                    v_text := lower(btrim(both '"' from (p_answer -> i)::text));
                    v_exp := lower(coalesce(((v_q -> 'blanks' -> i -> 'options' -> v_bi) #>> '{}'), ''));
                    if v_text <> v_exp then
                        v_ok := false;
                    end if;
                end if;
            end loop;
        end if;
    end if;

    v_before := coalesce(v_me.finals_progress, 100);

    if v_ok then
        v_combo := coalesce(v_me.finals_combo, 0) + 1;
        update public.purrfect_survival_players
        set finals_combo = v_combo,
            finals_question_index = coalesce(finals_question_index, 0) + 1,
            last_seen = now()
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_me;

        if v_combo % 3 = 0 then
            select * into v_target
            from public.purrfect_survival_players p
            where p.room_id = p_room_id
              and p.user_id <> auth.uid()
              and coalesce(p.is_playing, true)
              and p.dalgona_finished_at is not null
              and p.finals_eliminated_at is null
              and p.status <> 'eliminated'
              and not p.ghost
            order by abs(coalesce(p.finals_progress, 100) - v_before) asc,
                     coalesce(p.finals_progress, 100) desc,
                     p.user_id asc
            limit 1;

            if found then
                v_bi := coalesce(v_target.finals_progress, 100);
                v_after := greatest(0, v_bi - 15);
                update public.purrfect_survival_players
                set finals_progress = v_after,
                    last_seen = now()
                where room_id = p_room_id and user_id = v_target.user_id;
                v_knock := jsonb_build_object(
                    'user_id', v_target.user_id,
                    'from', v_bi,
                    'to', v_after,
                    'amount', v_bi - v_after
                );
            end if;
        end if;
    else
        v_combo := 0;
        if v_before <= 0 then
            v_eliminated := true;
            update public.purrfect_survival_players
            set finals_progress = 0,
                finals_combo = 0,
                finals_question_index = coalesce(finals_question_index, 0) + 1,
                finals_eliminated_at = now(),
                status = 'eliminated',
                ghost = true,
                eliminated_reason = 'finals',
                last_seen = now()
            where room_id = p_room_id and user_id = auth.uid()
            returning * into v_me;
        else
            update public.purrfect_survival_players
            set finals_progress = greatest(0, v_before - 25),
                finals_combo = 0,
                finals_question_index = coalesce(finals_question_index, 0) + 1,
                last_seen = now()
            where room_id = p_room_id and user_id = auth.uid()
            returning * into v_me;
        end if;
    end if;

    select count(*) into v_living
    from public.purrfect_survival_players p
    where p.room_id = p_room_id
      and coalesce(p.is_playing, true)
      and p.dalgona_finished_at is not null
      and p.finals_eliminated_at is null
      and p.status <> 'eliminated'
      and not p.ghost;

    if v_living <= 1 then
        update public.purrfect_survival_rooms
        set status = 'finished',
            current_round = 5,
            finished_at = coalesce(finished_at, now()),
            server_now = now()
        where id = p_room_id
        returning * into v_room;
    else
        update public.purrfect_survival_rooms
        set server_now = now()
        where id = p_room_id
        returning * into v_room;
    end if;

    return jsonb_build_object(
        'ok', true,
        'correct', v_ok,
        'eliminated', v_eliminated,
        'progress', coalesce(v_me.finals_progress, 0),
        'combo', coalesce(v_me.finals_combo, 0),
        'knockback', v_knock,
        'player', to_jsonb(v_me),
        'room', to_jsonb(v_room)
    );
end;
$fn$;

-- ---------- ghost revival answer ----------

create or replace function public.submit_purrfect_survival_ghost(
    p_room_id uuid,
    p_answer jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_me public.purrfect_survival_players;
    v_q jsonb;
    v_count int;
    v_idx int;
    v_expected int;
    v_n int;
    v_ok boolean := false;
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
    if v_room.status <> 'round5' then
        return jsonb_build_object('ok', false, 'error', 'NOT_PLAYING');
    end if;

    select * into v_me
    from public.purrfect_survival_players
    where room_id = p_room_id and user_id = auth.uid()
    for update;

    if not found then
        raise exception 'NOT_A_MEMBER';
    end if;
    if not (v_me.ghost or v_me.status = 'eliminated' or v_me.finals_eliminated_at is not null) then
        return jsonb_build_object('ok', false, 'error', 'NOT_GHOST');
    end if;

    v_count := coalesce(jsonb_array_length(v_room.ghost_questions), 0);
    if v_count = 0 then
        return jsonb_build_object('ok', false, 'error', 'NO_GHOST_BANK');
    end if;
    v_idx := (coalesce(v_me.finals_question_index, 0) % v_count);
    v_q := v_room.ghost_questions -> v_idx;
    v_expected := coalesce((v_q ->> 'answer')::int, 0);
    begin
        v_n := (p_answer #>> '{}')::int;
    exception when others then
        v_n := -1;
    end;

    -- Accept the 0-based index or a 1–2 answer.
    v_ok := v_n = v_expected or v_n = v_expected + 1;

    if v_ok then
        update public.purrfect_survival_players
        set finals_ghost_correct = coalesce(finals_ghost_correct, 0) + 1,
            finals_question_index = coalesce(finals_question_index, 0) + 1,
            last_seen = now()
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_me;
    else
        update public.purrfect_survival_players
        set finals_question_index = coalesce(finals_question_index, 0) + 1,
            last_seen = now()
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_me;
    end if;

    return jsonb_build_object(
        'ok', true,
        'correct', v_ok,
        'player', to_jsonb(v_me)
    );
end;
$fn$;

-- ---------- ghost ink bomb ----------

create or replace function public.throw_purrfect_survival_ink(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_me public.purrfect_survival_players;
    v_leader public.purrfect_survival_players;
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
    if v_room.status <> 'round5' then
        return jsonb_build_object('ok', false, 'error', 'NOT_PLAYING');
    end if;

    select * into v_me
    from public.purrfect_survival_players
    where room_id = p_room_id and user_id = auth.uid()
    for update;

    if not found then
        raise exception 'NOT_A_MEMBER';
    end if;
    if not (v_me.ghost or v_me.status = 'eliminated' or v_me.finals_eliminated_at is not null) then
        return jsonb_build_object('ok', false, 'error', 'NOT_GHOST');
    end if;
    if coalesce(v_me.finals_ghost_correct, 0) < 2 then
        return jsonb_build_object('ok', false, 'error', 'NEED_MORE_REVIVALS', 'player', to_jsonb(v_me));
    end if;

    select * into v_leader
    from public.purrfect_survival_players p
    where p.room_id = p_room_id
      and coalesce(p.is_playing, true)
      and p.dalgona_finished_at is not null
      and p.finals_eliminated_at is null
      and p.status <> 'eliminated'
      and not p.ghost
    order by coalesce(p.finals_progress, 100) desc, p.user_id asc
    limit 1;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'NO_LEADER', 'player', to_jsonb(v_me));
    end if;

    update public.purrfect_survival_players
    set ink_until = now() + interval '1.5 seconds',
        last_seen = now()
    where room_id = p_room_id and user_id = v_leader.user_id;

    update public.purrfect_survival_players
    set finals_ghost_correct = greatest(0, coalesce(finals_ghost_correct, 0) - 2),
        last_seen = now()
    where room_id = p_room_id and user_id = auth.uid()
    returning * into v_me;

    return jsonb_build_object(
        'ok', true,
        'leader', jsonb_build_object(
            'user_id', v_leader.user_id,
            'nickname', v_leader.nickname,
            'ink_until', now() + interval '1.5 seconds'
        ),
        'player', to_jsonb(v_me)
    );
end;
$fn$;

-- ---------- host early-end (rounds 2–5; round 1 keeps its own RPC) ----------

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

    if v_room.status in ('waiting', 'finished') then
        return v_room;
    end if;

    if v_room.status = 'round1' then
        return public.purrfect_survival_complete_round1(p_room_id);
    end if;

    if v_room.status = 'round2' then
        update public.purrfect_survival_players
        set status = 'eliminated',
            ghost = true,
            eliminated_reason = 'round2_timeout',
            glass_active = false
        where room_id = p_room_id
          and status = 'alive'
          and is_playing;

        return public.purrfect_survival_finish_if_done(p_room_id);
    end if;

    if v_room.status = 'round3' then
        v_state := coalesce(v_room.tug_state, public.purrfect_survival_empty_tug());

        if coalesce(v_state ->> 'phase', 'briefing') <> 'playing' then
            return v_room;
        end if;
        if coalesce((v_state ->> 'suddenDeath')::boolean, false) then
            return v_room;
        end if;

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

        return public.purrfect_survival_enter_round4(p_room_id, v_winner);
    end if;

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
            -- 5-round rooms continue to the finals; enter_round5 also
            -- finishes immediately when fewer than 2 survivors remain.
            return public.purrfect_survival_enter_round5(p_room_id);
        end if;

        return v_room;
    end if;

    if v_room.status = 'round5' then
        update public.purrfect_survival_rooms
        set status = 'finished',
            current_round = 5,
            finished_at = coalesce(finished_at, v_now),
            server_now = now()
        where id = p_room_id
        returning * into v_room;
        return v_room;
    end if;

    return v_room;
end;
$fn$;

-- ---------- ceremony ranking (5-round rooms; 1–4 unchanged) ----------

drop function if exists public.purrfect_survival_ceremony_rows(uuid);

create or replace function public.purrfect_survival_ceremony_rows(p_room_id uuid)
returns table (
    user_id uuid,
    nickname text,
    place int,
    paws int,
    role_name text,
    survived boolean,
    round1_survived boolean,
    distance int,
    reached_finish boolean,
    finished_at timestamptz,
    round1_rank int,
    eliminated_reason text,
    glass_step int,
    glass_finished_at timestamptz,
    crossed_glass boolean,
    tug_team text,
    tug_won boolean,
    dalgona_pattern text,
    dalgona_progress int,
    dalgona_cracks int,
    dalgona_finished_at timestamptz,
    finals_progress int,
    finals_combo int,
    finals_eliminated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_rounds int;
    v_finish int;
    v_winner text;
begin
    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id;

    if not found then
        return;
    end if;

    v_rounds := public.purrfect_survival_round_count(v_room.settings);
    v_finish := coalesce(v_room.finish_distance, 100);
    v_winner := nullif(v_room.tug_state ->> 'winner', '');
    if v_winner is not null and v_winner not in ('red', 'blue') then
        v_winner := null;
    end if;

    if v_rounds >= 5 then
        return query
        with base as (
            select p.user_id,
                   coalesce(nullif(btrim(p.nickname), ''),
                            split_part(coalesce(p.email, ''), '@', 1),
                            'Player') as nickname,
                   p.distance,
                   coalesce(p.reached_finish, false) as reached_finish,
                   p.finished_at,
                   p.round1_rank,
                   p.eliminated_reason,
                   p.glass_step,
                   p.glass_finished_at,
                   coalesce(p.crossed_glass, false) as crossed_glass,
                   p.tug_team,
                   (p.status <> 'eliminated'
                    and p.status <> 'out'
                    and coalesce(p.ghost, false) = false) as round1_survived,
                   (p.dalgona_finished_at is not null) as finalist,
                   (p.dalgona_finished_at is not null
                    and p.finals_eliminated_at is null
                    and p.status <> 'eliminated'
                    and coalesce(p.ghost, false) = false) as survived,
                   p.dalgona_pattern,
                   coalesce(p.dalgona_progress, 0) as dalgona_progress,
                   coalesce(p.dalgona_cracks, 0) as dalgona_cracks,
                   p.dalgona_finished_at,
                   coalesce(p.finals_progress, 100) as finals_progress,
                   coalesce(p.finals_combo, 0) as finals_combo,
                   p.finals_eliminated_at,
                   case when v_winner is null then null
                        else coalesce(p.tug_team = v_winner, false)
                   end as tug_won,
                   case
                       when p.dalgona_finished_at is not null
                            and p.finals_eliminated_at is null
                            and p.status <> 'eliminated'
                            and coalesce(p.ghost, false) = false then 0
                       when p.dalgona_finished_at is not null then 1
                       else 2
                   end as grp
              from public.purrfect_survival_players p
             where p.room_id = p_room_id
               and coalesce(p.is_playing, true)
        ),
        ranked as (
            select b.*,
                   (row_number() over (
                       order by b.grp asc,
                                case when b.grp in (0, 1) then b.finals_progress end desc nulls last,
                                case when b.grp in (0, 1) then b.dalgona_finished_at end asc nulls last,
                                case when b.grp = 2 then b.dalgona_progress end desc nulls last,
                                b.user_id
                   ))::int as place
              from base b
        )
        select r.user_id, r.nickname, r.place,
               public.purrfect_survival_ceremony_paws(r.place, r.survived),
               case r.place when 1 then 'first' when 2 then 'second'
                    when 3 then 'third'
                    else case when r.survived then 'survivor' else 'participant' end
               end,
               r.survived, r.round1_survived, r.distance, r.reached_finish,
               r.finished_at, r.round1_rank, r.eliminated_reason,
               r.glass_step, r.glass_finished_at, r.crossed_glass,
               r.tug_team, r.tug_won,
               r.dalgona_pattern, r.dalgona_progress, r.dalgona_cracks, r.dalgona_finished_at,
               r.finals_progress, r.finals_combo, r.finals_eliminated_at
          from ranked r
         order by r.place;
        return;
    end if;

    if v_rounds >= 4 then
        return query
        with base as (
            select p.user_id,
                   coalesce(nullif(btrim(p.nickname), ''),
                            split_part(coalesce(p.email, ''), '@', 1),
                            'Player') as nickname,
                   p.distance,
                   coalesce(p.reached_finish, false) as reached_finish,
                   p.finished_at,
                   p.round1_rank,
                   p.eliminated_reason,
                   p.glass_step,
                   p.glass_finished_at,
                   coalesce(p.crossed_glass, false) as crossed_glass,
                   p.tug_team,
                   (p.status <> 'eliminated'
                    and p.status <> 'out'
                    and coalesce(p.ghost, false) = false) as round1_survived,
                   (p.dalgona_finished_at is not null) as survived,
                   (p.advanced_round3 = true
                    or p.dalgona_finished_at is not null
                    or p.eliminated_reason in ('dalgona', 'dalgona_timeout')) as carver,
                   p.dalgona_pattern,
                   coalesce(p.dalgona_progress, 0) as dalgona_progress,
                   coalesce(p.dalgona_cracks, 0) as dalgona_cracks,
                   p.dalgona_finished_at,
                   case when v_winner is null then null
                        else coalesce(p.tug_team = v_winner, false)
                   end as tug_won,
                   case
                       when p.dalgona_finished_at is not null then 0
                       when p.advanced_round3 = true
                            or p.eliminated_reason in ('dalgona', 'dalgona_timeout') then 1
                       else 2
                   end as grp
              from public.purrfect_survival_players p
             where p.room_id = p_room_id
               and coalesce(p.is_playing, true)
        ),
        ranked as (
            select b.*,
                   (row_number() over (
                       order by b.grp asc,
                                case when b.grp = 0 then b.dalgona_finished_at end asc nulls last,
                                case when b.grp = 1 then b.dalgona_progress end desc nulls last,
                                b.user_id
                   ))::int as place
              from base b
        )
        select r.user_id, r.nickname, r.place,
               public.purrfect_survival_ceremony_paws(r.place, r.survived),
               case r.place when 1 then 'first' when 2 then 'second'
                    when 3 then 'third'
                    else case when r.survived then 'survivor' else 'participant' end
               end,
               r.survived, r.round1_survived, r.distance, r.reached_finish,
               r.finished_at, r.round1_rank, r.eliminated_reason,
               r.glass_step, r.glass_finished_at, r.crossed_glass,
               r.tug_team, r.tug_won,
               r.dalgona_pattern, r.dalgona_progress, r.dalgona_cracks, r.dalgona_finished_at,
               null::int, null::int, null::timestamptz
          from ranked r
         order by r.place;
        return;
    end if;

    if v_rounds >= 3 then
        return query
        with base as (
            select p.user_id,
                   coalesce(nullif(btrim(p.nickname), ''),
                            split_part(coalesce(p.email, ''), '@', 1),
                            'Player') as nickname,
                   p.distance,
                   coalesce(p.reached_finish, false) as reached_finish,
                   p.finished_at,
                   p.round1_rank,
                   p.eliminated_reason,
                   p.glass_step,
                   p.glass_finished_at,
                   coalesce(p.crossed_glass, false) as crossed_glass,
                   p.tug_team,
                   (p.status <> 'eliminated'
                    and p.status <> 'out'
                    and coalesce(p.ghost, false) = false) as round1_survived,
                   case when v_winner is not null then
                        case
                            when p.tug_team = v_winner then 0
                            when p.tug_team in ('red', 'blue') then 1
                            else 2
                        end
                   else
                        case
                            when coalesce(p.crossed_glass, false)
                                 or p.status = 'advanced' then 0
                            else 1
                        end
                   end as grp,
                   case when v_winner is not null then
                        coalesce(p.tug_team = v_winner, false)
                   else
                        (coalesce(p.crossed_glass, false) or p.status = 'advanced')
                   end as survived,
                   case when v_winner is null then null
                        else coalesce(p.tug_team = v_winner, false)
                   end as tug_won
              from public.purrfect_survival_players p
             where p.room_id = p_room_id
               and coalesce(p.is_playing, true)
        ),
        ranked as (
            select b.*,
                   (row_number() over (
                       order by b.grp asc,
                                b.glass_finished_at asc nulls last,
                                b.round1_rank asc nulls last,
                                b.user_id
                   ))::int as place
              from base b
        )
        select r.user_id, r.nickname, r.place,
               public.purrfect_survival_ceremony_paws(r.place, r.survived),
               case r.place when 1 then 'first' when 2 then 'second'
                    when 3 then 'third'
                    else case when r.survived then 'survivor' else 'participant' end
               end,
               r.survived, r.round1_survived, r.distance, r.reached_finish,
               r.finished_at, r.round1_rank, r.eliminated_reason,
               r.glass_step, r.glass_finished_at, r.crossed_glass,
               r.tug_team, r.tug_won,
               null::text, null::int, null::int, null::timestamptz,
               null::int, null::int, null::timestamptz
          from ranked r
         order by r.place;
        return;
    end if;

    if v_rounds = 2 then
        return query
        with base as (
            select p.user_id,
                   coalesce(nullif(btrim(p.nickname), ''),
                            split_part(coalesce(p.email, ''), '@', 1),
                            'Player') as nickname,
                   p.distance,
                   coalesce(p.reached_finish, false) as reached_finish,
                   p.finished_at,
                   p.round1_rank,
                   p.eliminated_reason,
                   p.glass_step,
                   p.glass_finished_at,
                   coalesce(p.crossed_glass, false) as crossed_glass,
                   p.tug_team,
                   (p.status <> 'eliminated'
                    and p.status <> 'out'
                    and coalesce(p.ghost, false) = false) as round1_survived,
                   (coalesce(p.crossed_glass, false) or p.status = 'advanced') as survived
              from public.purrfect_survival_players p
             where p.room_id = p_room_id
               and coalesce(p.is_playing, true)
        ),
        ranked as (
            select b.*,
                   (row_number() over (
                       order by b.survived desc,
                                case when b.survived then b.glass_finished_at end asc nulls last,
                                case when b.survived then b.round1_rank end asc nulls last,
                                case when not b.survived then b.glass_step end desc nulls last,
                                case when not b.survived then b.round1_rank end asc nulls last,
                                case when not b.survived then b.distance end desc nulls last,
                                b.user_id
                   ))::int as place
              from base b
        )
        select r.user_id, r.nickname, r.place,
               public.purrfect_survival_ceremony_paws(r.place, r.survived),
               case r.place when 1 then 'first' when 2 then 'second'
                    when 3 then 'third'
                    else case when r.survived then 'survivor' else 'participant' end
               end,
               r.survived, r.round1_survived, r.distance, r.reached_finish,
               r.finished_at, r.round1_rank, r.eliminated_reason,
               r.glass_step, r.glass_finished_at, r.crossed_glass,
               r.tug_team, null::boolean,
               null::text, null::int, null::int, null::timestamptz,
               null::int, null::int, null::timestamptz
          from ranked r
         order by r.place;
        return;
    end if;

    return query
    with base as (
        select p.user_id,
               coalesce(nullif(btrim(p.nickname), ''),
                        split_part(coalesce(p.email, ''), '@', 1),
                        'Player') as nickname,
               p.distance,
               coalesce(p.reached_finish, false) as reached_finish,
               p.finished_at,
               p.round1_rank,
               p.eliminated_reason,
               p.glass_step,
               p.glass_finished_at,
               coalesce(p.crossed_glass, false) as crossed_glass,
               p.tug_team,
               (p.status <> 'eliminated'
                and p.status <> 'out'
                and coalesce(p.ghost, false) = false) as round1_survived,
               (p.status <> 'eliminated'
                and p.status <> 'out'
                and coalesce(p.ghost, false) = false) as survived,
               (coalesce(p.reached_finish, false) or p.distance >= v_finish) as finisher
          from public.purrfect_survival_players p
         where p.room_id = p_room_id
           and coalesce(p.is_playing, true)
    ),
    ranked as (
        select b.*,
               (row_number() over (
                   order by b.survived desc,
                            case when b.survived then b.finisher end desc nulls last,
                            case when b.survived then b.finished_at end asc nulls last,
                            b.distance desc,
                            b.user_id
               ))::int as place
          from base b
    )
    select r.user_id, r.nickname, r.place,
           public.purrfect_survival_ceremony_paws(r.place, r.survived),
           case r.place when 1 then 'first' when 2 then 'second'
                when 3 then 'third'
                else case when r.survived then 'survivor' else 'participant' end
           end,
           r.survived, r.round1_survived, r.distance, r.reached_finish,
           r.finished_at, r.round1_rank, r.eliminated_reason,
           r.glass_step, r.glass_finished_at, r.crossed_glass,
           r.tug_team, null::boolean,
           null::text, null::int, null::int, null::timestamptz,
           null::int, null::int, null::timestamptz
      from ranked r
     order by r.place;
end;
$fn$;

-- The ceremony payload carries rounds.r5 for 5-round rooms.
create or replace function public.purrfect_survival_ceremony(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_rounds int;
    v_winner text;
    v_results jsonb;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if not (public.is_purrfect_survival_member(p_room_id)
            or public.is_purrfect_survival_teacher()) then
        raise exception 'NOT_ALLOWED';
    end if;

    if v_room.status <> 'finished' then
        raise exception 'ROOM_NOT_FINISHED';
    end if;

    v_rounds := public.purrfect_survival_round_count(v_room.settings);
    v_winner := nullif(v_room.tug_state ->> 'winner', '');
    if v_winner is not null and v_winner not in ('red', 'blue') then
        v_winner := null;
    end if;

    if to_regclass('public.paw_ledger') is not null then
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        select r.user_id,
               r.paws,
               'purrfect_survival',
               'purrfect_survival:' || p_room_id::text || ':' || r.user_id::text
          from public.purrfect_survival_ceremony_rows(p_room_id) r
         where r.paws > 0
        on conflict (user_id, ref_key) do nothing;
    end if;

    select coalesce(jsonb_agg(
               jsonb_build_object(
                   'place', r.place,
                   'user_id', r.user_id,
                   'nickname', r.nickname,
                   'paws', r.paws,
                   'role', r.role_name,
                   'survived', r.survived,
                   'rounds',
                       jsonb_build_object('r1', jsonb_build_object(
                           'distance', r.distance,
                           'reached_finish', r.reached_finish,
                           'finished_at', r.finished_at,
                           'round1_rank', r.round1_rank,
                           'eliminated', not r.round1_survived,
                           'eliminated_reason', r.eliminated_reason
                       ))
                       || case when v_rounds >= 2 then jsonb_build_object('r2', jsonb_build_object(
                              'glass_step', r.glass_step,
                              'glass_finished_at', r.glass_finished_at,
                              'crossed_glass', r.crossed_glass
                          )) else '{}'::jsonb end
                       || case when v_rounds >= 3 then jsonb_build_object('r3', jsonb_build_object(
                              'tug_team', r.tug_team,
                              'won', r.tug_won
                          )) else '{}'::jsonb end
                       || case when v_rounds >= 4 then jsonb_build_object('r4', jsonb_build_object(
                              'pattern', r.dalgona_pattern,
                              'progress', r.dalgona_progress,
                              'cracks', r.dalgona_cracks,
                              'finished_at', r.dalgona_finished_at,
                              'status', case
                                  when r.dalgona_finished_at is not null then 'finished'
                                  when r.dalgona_cracks >= 2 then 'shattered'
                                  when r.dalgona_cracks = 1 then 'danger'
                                  else 'carving'
                              end
                          )) else '{}'::jsonb end
                       || case when v_rounds >= 5 then jsonb_build_object('r5', jsonb_build_object(
                              'progress', r.finals_progress,
                              'combo', r.finals_combo,
                              'eliminated', r.finals_eliminated_at is not null
                                  or not r.survived,
                              'eliminated_reason', case
                                  when r.finals_eliminated_at is not null then 'finals'
                                  else r.eliminated_reason
                              end,
                              'entered', r.dalgona_finished_at is not null
                          )) else '{}'::jsonb end
               ) order by r.place
           ), '[]'::jsonb)
      into v_results
      from public.purrfect_survival_ceremony_rows(p_room_id) r;

    return jsonb_build_object(
        'room_id', p_room_id,
        'round_count', v_rounds,
        'tug_winner', v_winner,
        'paws_table', jsonb_build_object(
            'first', 20, 'second', 13, 'third', 8,
            'survivor', 5, 'participant', 2
        ),
        'results', v_results
    );
end;
$fn$;

-- ---------- grants ----------

revoke all on function public.purrfect_survival_finals_duration(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_enter_round5(uuid) from public, anon, authenticated;
revoke all on function public.submit_purrfect_survival_finals(uuid, jsonb) from public, anon;
revoke all on function public.submit_purrfect_survival_ghost(uuid, jsonb) from public, anon;
revoke all on function public.throw_purrfect_survival_ink(uuid) from public, anon;

revoke all on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) from public, anon;
revoke all on function public.tick_purrfect_survival(uuid) from public, anon;
revoke all on function public.glass_jump_purrfect_survival(uuid, text) from public, anon;
revoke all on function public.end_purrfect_survival_round(uuid) from public, anon;
revoke all on function public.purrfect_survival_ceremony_rows(uuid) from public, anon, authenticated;
revoke all on function public.purrfect_survival_ceremony(uuid) from public, anon;

grant execute on function public.submit_purrfect_survival_finals(uuid, jsonb) to authenticated;
grant execute on function public.submit_purrfect_survival_ghost(uuid, jsonb) to authenticated;
grant execute on function public.throw_purrfect_survival_ink(uuid) to authenticated;
grant execute on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) to authenticated;
grant execute on function public.tick_purrfect_survival(uuid) to authenticated;
grant execute on function public.glass_jump_purrfect_survival(uuid, text) to authenticated;
grant execute on function public.end_purrfect_survival_round(uuid) to authenticated;
grant execute on function public.purrfect_survival_ceremony(uuid) to authenticated;

notify pgrst, 'reload schema';
