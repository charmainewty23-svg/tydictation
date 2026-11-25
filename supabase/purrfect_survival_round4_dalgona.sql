-- ============================================================
-- LearniTY — Purr-fect Survival: Round 4 Dalgona Candy Carving
--
-- PASTE THIS FILE INTO THE LIVE PROJECT'S SUPABASE SQL EDITOR:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--
-- Clear the editor first.
-- Paste this AFTER all of these earlier incrementals have already run:
--   1) purrfect_survival_host_settings.sql
--   2) purrfect_survival_tug.sql
--   3) purrfect_survival_ceremony.sql
--   4) purrfect_survival_qualifier.sql
--   5) purrfect_survival_round2_answers.sql
-- Do NOT re-run any of those older incrementals.
-- Never run this from a plugin, CLI or agent: the teacher pastes it.
-- Safe to re-run.
--
-- What it adds, in teacher-friendly language:
--   * Round 4 is Dalgona Candy Carving. It only runs when the host chose
--     4 rounds; classes that chose 1–3 rounds finish exactly as before.
--   * After the Tug of War winner is known, the winning team moves into
--     Round 4 instead of the ceremony. A 7-second "Advancing to Dalgona
--     Candy Carving" board plays first; carving input is refused until
--     that board ends, and the carving clock starts after it.
--   * Each carver gets one of three stamped patterns (assigned by the
--     client at game start and stored per player):
--       Fishbone  — spell the English word from a Chinese hint
--                   (New Vocab + Dictation Master)
--       Cat paw   — build the grammar answer from word blocks
--                   (the five Grammar Quest topics)
--       Crown cat — combine two participle-clause sentences (Q251+ only)
--   * One correct letter / block carves one dash segment. The first wrong
--     carve is a black crack; a second wrong carve splits the candy and
--     that student becomes a spectator (no survivor reward).
--   * One lick per player fills the next correct unit and never cracks.
--   * When everyone has finished or shattered (or the clock runs out),
--     the class finishes and the existing prize ceremony runs. The SQL
--     ranking mirrors PSEngine.ceremonyResults for 4-round rooms; 1–3
--     round ceremonies are unchanged.
--   * Round 5 (Squid Circle) is still NOT implemented and stays coming
--     soon. Round counts above 4 clamp to 4.
-- ============================================================

-- ---------- schema ----------

alter table public.purrfect_survival_rooms
    add column if not exists round4_started_at timestamptz,
    add column if not exists round4_ends_at timestamptz;

alter table public.purrfect_survival_players
    add column if not exists dalgona_pattern text,
    add column if not exists dalgona_progress int not null default 0,
    add column if not exists dalgona_cracks int not null default 0,
    add column if not exists dalgona_lick_used boolean not null default false,
    add column if not exists dalgona_finished_at timestamptz,
    add column if not exists dalgona_units jsonb not null default '[]'::jsonb,
    add column if not exists dalgona_item jsonb not null default '{}'::jsonb,
    add column if not exists advanced_round3 boolean not null default false;

alter table public.purrfect_survival_rooms
    drop constraint if exists purrfect_survival_rooms_status_check;
alter table public.purrfect_survival_rooms
    add constraint purrfect_survival_rooms_status_check
    check (status in ('waiting', 'round1', 'round2', 'round3', 'round4', 'finished'));

-- ---------- helpers ----------

-- Implemented rounds are now 1–4. Old rooms still default to 2.
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
    return least(4, greatest(1, v_raw::int));
end;
$fn$;

-- Round-4 carving duration: default 180 s, clamped to 60–600 s. The lobby
-- saves milliseconds; a value <= 600 is treated as seconds.
create or replace function public.purrfect_survival_dalgona_duration(p_settings jsonb, p_default int default 180000)
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
        return coalesce(p_default, 180000);
    end if;
    v_raw := p_settings ->> 'dalgonaDuration';
    if v_raw is null then
        v_raw := p_settings ->> 'dalgona_duration';
    end if;
    if v_raw is null and jsonb_typeof(p_settings -> 'rounds') = 'array' then
        for v_idx in 0..jsonb_array_length(p_settings -> 'rounds') - 1 loop
            v_round := p_settings -> 'rounds' -> v_idx;
            if coalesce(v_round ->> 'round', '') = '4' then
                v_raw := v_round ->> 'dalgonaDuration';
                exit;
            end if;
        end loop;
    end if;
    if v_raw is null or v_raw !~ '^[0-9]+([.][0-9]+)?$' then
        return coalesce(p_default, 180000);
    end if;
    v_num := v_raw::numeric;
    if v_num <= 600 then
        v_num := v_num * 1000;
    end if;
    return least(600000, greatest(60000, round(v_num)::int));
end;
$fn$;

-- Narrow helper: only the current student's row and only the round-4
-- columns. The general class poll deliberately never reads dalgona_item /
-- dalgona_units, so classmates cannot see the rest of an answer.
create or replace function public.purrfect_survival_dalgona_item(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_row public.purrfect_survival_players;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if not public.is_purrfect_survival_member(p_room_id) then
        raise exception 'NOT_A_MEMBER';
    end if;
    select * into v_row
    from public.purrfect_survival_players
    where room_id = p_room_id and user_id = auth.uid();
    if not found then
        return '{}'::jsonb;
    end if;
    return jsonb_build_object(
        'user_id', v_row.user_id,
        'pattern', v_row.dalgona_pattern,
        'units', coalesce(v_row.dalgona_units, '[]'::jsonb),
        'item', coalesce(v_row.dalgona_item, '{}'::jsonb),
        'progress', v_row.dalgona_progress,
        'cracks', v_row.dalgona_cracks,
        'lick_used', v_row.dalgona_lick_used,
        'finished_at', v_row.dalgona_finished_at
    );
end;
$fn$;

-- Moves the tug winners into Round 4 (or finishes when Round 4 is not in
-- the room plan / no candy was assigned). Idempotent.
create or replace function public.purrfect_survival_enter_round4(p_room_id uuid, p_winner text)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_count int;
    v_duration int;
    v_carvers int;
begin
    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    v_count := public.purrfect_survival_round_count(v_room.settings);

    /* The winning team advances and the losing team falls, whatever the
       room's round count (this keeps 3-round ceremonies identical). */
    if p_winner in ('red', 'blue') then
        update public.purrfect_survival_players
        set status = 'eliminated',
            ghost = true,
            eliminated_reason = 'tug',
            advanced_round3 = false
        where room_id = p_room_id
          and tug_team is not null
          and tug_team <> p_winner;

        update public.purrfect_survival_players
        set status = 'advanced',
            ghost = false,
            eliminated_reason = null,
            advanced_round3 = true
        where room_id = p_room_id
          and tug_team = p_winner;
    end if;

    if v_count < 4 or p_winner is null or p_winner not in ('red', 'blue') then
        update public.purrfect_survival_rooms
        set status = 'finished',
            current_round = 3,
            finished_at = coalesce(finished_at, now()),
            server_now = now()
        where id = p_room_id
        returning * into v_room;
        return v_room;
    end if;

    select count(*) into v_carvers
    from public.purrfect_survival_players
    where room_id = p_room_id
      and tug_team = p_winner
      and is_playing
      and coalesce(jsonb_array_length(dalgona_units), 0) > 0;

    if v_carvers = 0 then
        update public.purrfect_survival_rooms
        set status = 'finished',
            current_round = 3,
            finished_at = coalesce(finished_at, now()),
            server_now = now()
        where id = p_room_id
        returning * into v_room;
        return v_room;
    end if;

    v_duration := public.purrfect_survival_dalgona_duration(v_room.settings, 180000);

    update public.purrfect_survival_players
    set dalgona_progress = 0,
        dalgona_cracks = 0,
        dalgona_lick_used = false,
        dalgona_finished_at = null
    where room_id = p_room_id
      and tug_team = p_winner;

    update public.purrfect_survival_rooms
    set status = 'round4',
        current_round = 4,
        round4_started_at = now(),
        round4_ends_at = now()
            + interval '7 seconds'
            + make_interval(secs => (v_duration / 1000.0)::double precision),
        finished_at = null,
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$fn$;

-- Host-controlled start (optional; the tick also enters Round 4 by itself
-- after the 7-second qualifier). Stores any assignments the host sends and
-- is idempotent when the room is already carving.
create or replace function public.start_purrfect_survival_round4(
    p_room_id uuid,
    p_dalgona jsonb default '[]'::jsonb
) returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_item jsonb;
    v_uid uuid;
    v_winner text;
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
    if v_room.status = 'round4' then
        return v_room;
    end if;

    if p_dalgona is not null and jsonb_typeof(p_dalgona) = 'array' then
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

    v_winner := nullif(v_room.tug_state ->> 'winner', '');
    if v_winner is null or v_winner not in ('red', 'blue') then
        return v_room;
    end if;
    if v_room.status <> 'round3' then
        return v_room;
    end if;

    return public.purrfect_survival_enter_round4(p_room_id, v_winner);
end;
$fn$;

-- ---------- start (now ships per-player round-4 assignments) ----------

drop function if exists public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb);

create or replace function public.start_purrfect_survival(
    p_room_id uuid,
    p_questions jsonb,
    p_glass jsonb,
    p_schedule jsonb,
    p_round_ms int default 180000,
    p_tug_questions jsonb default '[]'::jsonb,
    p_dalgona jsonb default '[]'::jsonb
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
        advanced_round3 = false,
        dalgona_pattern = null,
        dalgona_progress = 0,
        dalgona_cracks = 0,
        dalgona_lick_used = false,
        dalgona_finished_at = null,
        dalgona_units = '[]'::jsonb,
        dalgona_item = '{}'::jsonb,
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
        round1_started_at = now(),
        round1_ends_at = now() + make_interval(secs => (greatest(30, coalesce(p_round_ms, 180000)) / 1000.0)::double precision),
        round2_started_at = null,
        round2_ends_at = null,
        round3_started_at = null,
        round3_ends_at = null,
        round4_started_at = null,
        round4_ends_at = null,
        started_at = now(),
        finished_at = null,
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$fn$;

-- ---------- create (accept 4 rounds + store the carving duration) ----------

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
       and (v_settings ->> 'roundCount')::int > 4 then
        raise exception 'ROUNDS_NOT_IMPLEMENTED';
    end if;
    v_finish := public.purrfect_survival_finish_value(v_settings, 100);
    v_settings := jsonb_set(v_settings, '{finishDistance}', to_jsonb(v_finish), true);
    if public.purrfect_survival_round_count(v_settings) > 1 then
        v_settings := jsonb_set(
            v_settings,
            '{glassSteps}',
            to_jsonb(public.purrfect_survival_glass_count(v_settings, 9)),
            true
        );
    end if;
    if public.purrfect_survival_round_count(v_settings) >= 3 then
        v_settings := jsonb_set(
            v_settings,
            '{tugDuration}',
            to_jsonb(public.purrfect_survival_tug_duration(v_settings, 60000)),
            true
        );
    end if;
    if public.purrfect_survival_round_count(v_settings) >= 4 then
        v_settings := jsonb_set(
            v_settings,
            '{dalgonaDuration}',
            to_jsonb(public.purrfect_survival_dalgona_duration(v_settings, 180000)),
            true
        );
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

-- ---------- tick (round 3 -> round 4 -> finished) ----------

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
          and v_now - glass_started_at >= interval '5 seconds';

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

-- ---------- submit one letter / word block ----------

create or replace function public.submit_purrfect_survival_dalgona(
    p_room_id uuid,
    p_value text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_player public.purrfect_survival_players;
    v_units jsonb;
    v_len int;
    v_idx int;
    v_expected text;
    v_correct boolean;
    v_progress int;
    v_cracks int;
    v_new_progress int;
    v_finished boolean := false;
    v_eliminated boolean := false;
    v_prompt text;
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
    if v_room.status <> 'round4' then
        return jsonb_build_object('ok', false, 'error', 'NOT_ROUND4');
    end if;
    if v_room.round4_started_at is null
       or now() < v_room.round4_started_at + interval '7 seconds' then
        return jsonb_build_object('ok', false, 'error', 'QUALIFIER');
    end if;
    if v_room.round4_ends_at is not null and now() >= v_room.round4_ends_at then
        return jsonb_build_object('ok', false, 'error', 'TIME_UP');
    end if;

    select * into v_player
    from public.purrfect_survival_players
    where room_id = p_room_id and user_id = auth.uid()
    for update;

    if not found
       or not v_player.is_playing
       or v_player.ghost
       or v_player.status = 'eliminated'
       or v_player.dalgona_pattern is null then
        return jsonb_build_object('ok', false, 'error', 'NOT_CARVING');
    end if;
    if v_player.dalgona_finished_at is not null then
        return jsonb_build_object('ok', false, 'error', 'FINISHED');
    end if;
    if v_player.dalgona_cracks >= 2 then
        return jsonb_build_object('ok', false, 'error', 'SHATTERED');
    end if;

    v_units := coalesce(v_player.dalgona_units, '[]'::jsonb);
    v_len := jsonb_array_length(v_units);
    v_idx := greatest(0, v_player.dalgona_progress);
    if v_idx >= v_len then
        return jsonb_build_object('ok', false, 'error', 'FINISHED');
    end if;
    v_expected := v_units ->> v_idx;
    v_correct := lower(btrim(coalesce(p_value, ''))) = lower(btrim(coalesce(v_expected, '')));
    v_progress := v_player.dalgona_progress;
    v_cracks := v_player.dalgona_cracks;
    v_prompt := coalesce(v_player.dalgona_item ->> 'prompt', '');

    if v_correct then
        v_new_progress := v_idx + 1;
        if v_new_progress >= v_len then
            v_finished := true;
        end if;
        update public.purrfect_survival_players
        set dalgona_progress = v_new_progress,
            dalgona_finished_at = case when v_finished then now() else dalgona_finished_at end,
            last_seen = now()
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_player;
        v_progress := v_new_progress;
    else
        v_cracks := v_cracks + 1;
        if v_cracks >= 2 then
            v_eliminated := true;
        end if;
        update public.purrfect_survival_players
        set dalgona_cracks = v_cracks,
            status = case when v_eliminated then 'eliminated' else status end,
            ghost = case when v_eliminated then true else ghost end,
            eliminated_reason = case when v_eliminated then 'dalgona' else eliminated_reason end,
            answer_log = coalesce(answer_log, '[]'::jsonb) || jsonb_build_array(
                jsonb_build_object(
                    'round', 4,
                    'kind', 'dalgona',
                    'pattern', v_player.dalgona_pattern,
                    'prompt', v_prompt,
                    'choice', coalesce(p_value, ''),
                    'answer', coalesce(v_expected, ''),
                    'note', case when v_eliminated then 'candy split' else 'crack' end
                )
            ),
            last_seen = now()
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_player;
    end if;

    update public.purrfect_survival_rooms
    set server_now = now()
    where id = p_room_id
    returning * into v_room;

    return jsonb_build_object(
        'ok', true,
        'correct', v_correct,
        'expected', coalesce(v_expected, ''),
        'progress', v_progress,
        'total', v_len,
        'cracks', v_cracks,
        'finished', v_finished,
        'eliminated', v_eliminated,
        'player', to_jsonb(v_player),
        'room', to_jsonb(v_room) - 'questions' - 'tug_questions'
    );
end;
$fn$;

-- ---------- lick (one per player) ----------

create or replace function public.lick_purrfect_survival_dalgona(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_player public.purrfect_survival_players;
    v_units jsonb;
    v_len int;
    v_idx int;
    v_progress int;
    v_finished boolean := false;
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
    if v_room.status <> 'round4' then
        return jsonb_build_object('applied', false, 'ok', false, 'error', 'NOT_ROUND4');
    end if;
    if v_room.round4_started_at is null
       or now() < v_room.round4_started_at + interval '7 seconds' then
        return jsonb_build_object('applied', false, 'ok', false, 'error', 'QUALIFIER');
    end if;
    if v_room.round4_ends_at is not null and now() >= v_room.round4_ends_at then
        return jsonb_build_object('applied', false, 'ok', false, 'error', 'TIME_UP');
    end if;

    select * into v_player
    from public.purrfect_survival_players
    where room_id = p_room_id and user_id = auth.uid()
    for update;

    if not found
       or not v_player.is_playing
       or v_player.ghost
       or v_player.status = 'eliminated'
       or v_player.dalgona_pattern is null then
        return jsonb_build_object('applied', false, 'ok', false, 'error', 'NOT_CARVING');
    end if;
    if v_player.dalgona_finished_at is not null then
        return jsonb_build_object('applied', false, 'ok', false, 'error', 'FINISHED');
    end if;
    if v_player.dalgona_cracks >= 2 then
        return jsonb_build_object('applied', false, 'ok', false, 'error', 'SHATTERED');
    end if;
    if v_player.dalgona_lick_used then
        return jsonb_build_object('applied', false, 'ok', false, 'error', 'LICK_USED');
    end if;

    v_units := coalesce(v_player.dalgona_units, '[]'::jsonb);
    v_len := jsonb_array_length(v_units);
    v_idx := greatest(0, v_player.dalgona_progress);
    if v_idx >= v_len then
        return jsonb_build_object('applied', false, 'ok', false, 'error', 'NO_UNIT');
    end if;

    v_progress := v_idx + 1;
    if v_progress >= v_len then
        v_finished := true;
    end if;

    update public.purrfect_survival_players
    set dalgona_progress = v_progress,
        dalgona_lick_used = true,
        dalgona_finished_at = case when v_finished then now() else dalgona_finished_at end,
        last_seen = now()
    where room_id = p_room_id and user_id = auth.uid()
    returning * into v_player;

    update public.purrfect_survival_rooms
    set server_now = now()
    where id = p_room_id
    returning * into v_room;

    return jsonb_build_object(
        'applied', true,
        'ok', true,
        'correct', true,
        'unit', v_units ->> v_idx,
        'progress', v_progress,
        'total', v_len,
        'finished', v_finished,
        'player', to_jsonb(v_player)
    );
end;
$fn$;

-- ---------- answer press (round 3 winner -> Round 4) ----------

create or replace function public.submit_purrfect_survival_answer(
    p_room_id uuid,
    p_choice int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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

    -- Round 3: a tug answer against the tug bank (fallback to the
    -- round-1/questions bank only when no tug bank was stored).
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
                eliminated_reason = null,
                advanced_round3 = true
            where room_id = p_room_id
              and tug_team = v_winner;

            update public.purrfect_survival_rooms
            set tug_state = v_state,
                server_now = now()
            where id = p_room_id
            returning * into v_room;
            v_room := public.purrfect_survival_enter_round4(p_room_id, v_winner);
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

        v_distance := v_player.distance;
        if v_correct then
            v_distance := least(v_room.finish_distance, v_player.distance + 10);
        end if;

        update public.purrfect_survival_players
        set distance = v_distance,
            question_index = v_player.question_index + 1,
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

    update public.purrfect_survival_players
    set distance = v_distance,
        red_offences = v_offences,
        last_red_phase = v_phase.phase_index,
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
$fn$;

-- ---------- ceremony ranking (4-round rooms; 1–3 unchanged) ----------

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
    dalgona_finished_at timestamptz
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
               r.dalgona_pattern, r.dalgona_progress, r.dalgona_cracks, r.dalgona_finished_at
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
               null::text, null::int, null::int, null::timestamptz
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
               null::text, null::int, null::int, null::timestamptz
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
           null::text, null::int, null::int, null::timestamptz
      from ranked r
     order by r.place;
end;
$fn$;

-- The ceremony payload now carries rounds.r4 for 4-round rooms.
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

revoke all on function public.purrfect_survival_dalgona_duration(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_dalgona_item(uuid) from public, anon;
revoke all on function public.purrfect_survival_enter_round4(uuid, text) from public, anon, authenticated;
revoke all on function public.start_purrfect_survival_round4(uuid, jsonb) from public, anon;
revoke all on function public.submit_purrfect_survival_dalgona(uuid, text) from public, anon;
revoke all on function public.lick_purrfect_survival_dalgona(uuid) from public, anon;

revoke all on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb, jsonb) from public, anon;
revoke all on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) from public, anon;
revoke all on function public.tick_purrfect_survival(uuid) from public, anon;
revoke all on function public.submit_purrfect_survival_answer(uuid, int) from public, anon;
revoke all on function public.purrfect_survival_ceremony_rows(uuid) from public, anon, authenticated;
revoke all on function public.purrfect_survival_ceremony(uuid) from public, anon;

grant execute on function public.purrfect_survival_dalgona_item(uuid) to authenticated;
grant execute on function public.start_purrfect_survival_round4(uuid, jsonb) to authenticated;
grant execute on function public.submit_purrfect_survival_dalgona(uuid, text) to authenticated;
grant execute on function public.lick_purrfect_survival_dalgona(uuid) to authenticated;
grant execute on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb, jsonb) to authenticated;
grant execute on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) to authenticated;
grant execute on function public.tick_purrfect_survival(uuid) to authenticated;
grant execute on function public.submit_purrfect_survival_answer(uuid, int) to authenticated;
grant execute on function public.purrfect_survival_ceremony(uuid) to authenticated;

notify pgrst, 'reload schema';
