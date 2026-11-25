-- ============================================================
-- LearniTY — Purr-fect Survival: host settings for rounds 1 & 2
--
-- PASTE THIS FILE INTO THE LIVE PROJECT'S SUPABASE SQL EDITOR:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--
-- Clear the editor first.
-- Do NOT re-run older incrementals (purrfect_survival.sql or any earlier
-- file) — this file only adds/updates the host-settings functions.
-- Never run this from a plugin, CLI or agent: the teacher pastes it.
-- Safe to re-run.
--
-- What it changes, in teacher-friendly language:
--   * The host can choose 1 or 2 rounds for a class.
--   * Each round can use its own subject + topic, so round 1 may be Vocab
--     while round 2 is Grammar (a single round still cannot mix them).
--   * Round 1 has a custom finish distance (30–300 m, step 10) and the time
--     cap scales with it (100 m = 180 s; 50 m = 90 s; 200 m = 360 s;
--     minimum 60 s).
--   * Round 2 has a custom glass step count (3–15).
--   * With only 1 round, the game ends in a survivor victory after
--     1-2-3 Meow! — no top-15 cut and no glass bridge.
--   * Old rooms keep working: missing settings mean 2 rounds, 100 m and
--     9 glass steps, exactly like before.
--
-- Rounds 3–5 (tug of war, second glass bridge, Squid Circle) are NOT
-- implemented yet. When each later round ships, its host settings MUST ship
-- in the same change; the settings JSON already has a roundCount plus one
-- entry per round so this does not need a redesign.
-- ============================================================

-- Reads the host settings round count. Old rooms default to 2 (today's
-- behaviour) and the value is clamped to the implemented rounds (1 or 2).
create or replace function public.purrfect_survival_round_count(p_settings jsonb)
returns int
language plpgsql
immutable
as $$
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
    return least(2, greatest(1, v_raw::int));
end;
$$;

-- Round-1 finish distance from settings: default 100 m, clamped to
-- 30–300 m on the 10 m step used by the lobby.
create or replace function public.purrfect_survival_finish_value(p_settings jsonb, p_default int default 100)
returns int
language plpgsql
immutable
as $$
declare
    v_raw text;
    v_num numeric;
begin
    if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
        return coalesce(p_default, 100);
    end if;
    v_raw := p_settings ->> 'finishDistance';
    if v_raw is null then
        v_raw := p_settings ->> 'finish_distance';
    end if;
    if v_raw is null
       and jsonb_typeof(p_settings -> 'rounds') = 'array'
       and jsonb_array_length(p_settings -> 'rounds') > 0 then
        v_raw := p_settings -> 'rounds' -> 0 ->> 'finishDistance';
    end if;
    if v_raw is null or v_raw !~ '^[0-9]+([.][0-9]+)?$' then
        return coalesce(p_default, 100);
    end if;
    v_num := round((v_raw::numeric) / 10) * 10;
    return least(300, greatest(30, v_num::int));
end;
$$;

-- Round-2 glass step count: default 9, clamped to 3–15.
create or replace function public.purrfect_survival_glass_count(p_settings jsonb, p_default int default 9)
returns int
language plpgsql
immutable
as $$
declare
    v_raw text;
    v_idx int;
    v_round jsonb;
begin
    if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
        return coalesce(p_default, 9);
    end if;
    v_raw := p_settings ->> 'glassSteps';
    if v_raw is null then
        v_raw := p_settings ->> 'glass_steps';
    end if;
    if v_raw is null and jsonb_typeof(p_settings -> 'rounds') = 'array' then
        for v_idx in 0..jsonb_array_length(p_settings -> 'rounds') - 1 loop
            v_round := p_settings -> 'rounds' -> v_idx;
            if coalesce(v_round ->> 'round', '') = '2' then
                v_raw := v_round ->> 'glassSteps';
                exit;
            end if;
        end loop;
    end if;
    if v_raw is null or v_raw !~ '^[0-9]+$' then
        return coalesce(p_default, 9);
    end if;
    return least(15, greatest(3, v_raw::int));
end;
$$;

-- Ends round 1 correctly for the selected round count. A 2-round class
-- advances the first 15 survivors to the glass bridge; a 1-round class
-- finishes immediately and every living player (still status='alive')
-- wins. No top-15 cut is applied to a 1-round room.
create or replace function public.purrfect_survival_complete_round1(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
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
    if public.purrfect_survival_round_count(v_room.settings) > 1 then
        return public.purrfect_survival_begin_round2(p_room_id);
    end if;

    update public.purrfect_survival_rooms
    set status = 'finished',
        current_round = 1,
        finished_at = coalesce(finished_at, now()),
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$$;

-- Create a room with host settings. Mixed subjects are allowed ACROSS
-- rounds (round 1 vocab, round 2 grammar) but each single round is one
-- subject. Missing/legacy settings keep 2 rounds, 100 m and 9 glass steps.
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
as $$
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
       and (v_settings ->> 'roundCount')::int > 2 then
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

    -- Housekeeping: stale rooms from earlier lessons.
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
$$;

-- Start the class. A 1-round room may pass an empty glass array (no
-- bridge); a 2-round room still needs valid glass steps. The scaled
-- p_round_ms is used as before and a valid finish_distance is kept.
create or replace function public.start_purrfect_survival(
    p_room_id uuid,
    p_questions jsonb,
    p_glass jsonb,
    p_schedule jsonb,
    p_round_ms int default 180000
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
        crossed_glass = false,
        last_seen = now()
    where room_id = p_room_id and is_playing;

    update public.purrfect_survival_rooms
    set status = 'round1',
        current_round = 1,
        questions = p_questions,
        glass_steps = v_glass,
        phase_schedule = p_schedule,
        round1_started_at = now(),
        round1_ends_at = now() + make_interval(secs => (greatest(30, coalesce(p_round_ms, 180000)) / 1000.0)::double precision),
        round2_started_at = null,
        round2_ends_at = null,
        started_at = now(),
        finished_at = null,
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$$;

-- Host "End round 1". For a 1-round class this finishes with a survivor
-- victory; for a 2-round class it moves the first 15 to the bridge.
create or replace function public.end_purrfect_survival_round1(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    select * into v_room from public.purrfect_survival_rooms where id = p_room_id;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.host_id <> auth.uid() then
        raise exception 'NOT_HOST';
    end if;
    return public.purrfect_survival_complete_round1(p_room_id);
end;
$$;

-- Kept for older clients. A 1-round room finishes (or no-ops if already
-- finished) instead of forcing the glass bridge.
create or replace function public.start_purrfect_survival_round2(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    select * into v_room from public.purrfect_survival_rooms where id = p_room_id;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.host_id <> auth.uid() then
        raise exception 'NOT_HOST';
    end if;
    if v_room.status = 'finished' then
        return v_room;
    end if;
    if public.purrfect_survival_round_count(v_room.settings) <= 1 then
        if v_room.status = 'round1' then
            return public.purrfect_survival_complete_round1(p_room_id);
        end if;
        return v_room;
    end if;
    return public.purrfect_survival_begin_round2(p_room_id);
end;
$$;

-- Heartbeat: a 2-round room still advances at 15 finishers or time up; a
-- 1-round room finishes when time is up or every living player finishes.
create or replace function public.tick_purrfect_survival(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
    v_finished int;
    v_alive int;
    v_now timestamptz := now();
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

        select count(*) into v_alive
        from public.purrfect_survival_players
        where room_id = p_room_id and status = 'alive' and is_playing;

        if v_alive = 0 then
            update public.purrfect_survival_rooms
            set status = 'finished',
                current_round = 2,
                finished_at = coalesce(finished_at, v_now)
            where id = p_room_id
            returning * into v_room;
        else
            select * into v_room from public.purrfect_survival_rooms where id = p_room_id;
        end if;
    end if;

    update public.purrfect_survival_rooms
    set server_now = now()
    where id = p_room_id
    returning * into v_room;

    v_room.questions := '[]'::jsonb;
    return v_room;
end;
$$;

-- ---------- grants ----------

revoke all on function public.purrfect_survival_round_count(jsonb) from public, anon, authenticated;
revoke all on function public.purrfect_survival_finish_value(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_glass_count(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_complete_round1(uuid) from public, anon, authenticated;

revoke all on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) from public, anon;
revoke all on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int) from public, anon;
revoke all on function public.end_purrfect_survival_round1(uuid) from public, anon;
revoke all on function public.start_purrfect_survival_round2(uuid) from public, anon;
revoke all on function public.tick_purrfect_survival(uuid) from public, anon;

grant execute on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) to authenticated;
grant execute on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int) to authenticated;
grant execute on function public.end_purrfect_survival_round1(uuid) to authenticated;
grant execute on function public.start_purrfect_survival_round2(uuid) to authenticated;
grant execute on function public.tick_purrfect_survival(uuid) to authenticated;

notify pgrst, 'reload schema';
