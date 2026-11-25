-- ============================================================
-- LearniTY — Purr-fect Survival: Round 3 Tug of War
--
-- PASTE THIS FILE INTO THE LIVE PROJECT'S SUPABASE SQL EDITOR:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--
-- Clear the editor first.
-- Paste this AFTER you have already run the PR #51 incremental
-- (purrfect_survival_host_settings.sql).
-- Do NOT re-run older incrementals (purrfect_survival.sql or
-- purrfect_survival_host_settings.sql).
-- Never run this from a plugin, CLI or agent: the teacher pastes it.
-- Safe to re-run.
--
-- What it adds, in teacher-friendly language:
--   * Round 3 is Tug of War. It is playable now, and it only
--     runs when the host chose 3 rounds. Classes that chose 1 or 2 rounds
--     finish exactly as before.
--   * Survivors of the glass bridge are split fairly into a red team and a
--     blue team (snake order by finish time, so strong players are not
--     stacked on one team).
--   * Both teams answer at the same time. Every correct answer pulls the
--     rope +1; five correct answers in a row trigger 爆走拉力 2x for 5 s
--     (each correct then pulls +2). A wrong answer breaks the combo.
--   * The golden salmon sits at (bluePull - redPull). Pulling it 20 steps
--     past the centre wins instantly, otherwise the side ahead at time-up
--     wins. An exact tie is sudden death.
--   * The host can set the tug time limit to 30–120 seconds (default 60).
--   * The losing team falls into the abyss and becomes ghost cats; the
--     winning team advances.
--   * Rounds 4–5 (a second glass bridge, Squid Circle) are still NOT
--     implemented and stay coming soon.
-- ============================================================

-- ---------- schema ----------

alter table public.purrfect_survival_rooms
    add column if not exists round3_started_at timestamptz,
    add column if not exists round3_ends_at timestamptz,
    add column if not exists tug_state jsonb not null default '{}'::jsonb,
    add column if not exists tug_questions jsonb not null default '[]'::jsonb;

alter table public.purrfect_survival_players
    add column if not exists tug_team text,
    add column if not exists glass_finished_at timestamptz;

-- The live table was created with a check that only allowed
-- waiting / round1 / round2 / finished. Re-create it with round3.
alter table public.purrfect_survival_rooms
    drop constraint if exists purrfect_survival_rooms_status_check;
alter table public.purrfect_survival_rooms
    add constraint purrfect_survival_rooms_status_check
    check (status in ('waiting', 'round1', 'round2', 'round3', 'finished'));

-- ---------- helpers ----------

-- Reads the host settings round count. Old rooms default to 2 (today's
-- behaviour) and the value is clamped to the implemented rounds (1–3).
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
    return least(3, greatest(1, v_raw::int));
end;
$fn$;

-- Round-3 tug duration: default 60 s, clamped to 30–120 s. The lobby saves
-- milliseconds; a value <= 120 is treated as seconds for old/manual rows.
create or replace function public.purrfect_survival_tug_duration(p_settings jsonb, p_default int default 60000)
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
        return coalesce(p_default, 60000);
    end if;
    v_raw := p_settings ->> 'tugDuration';
    if v_raw is null then
        v_raw := p_settings ->> 'tug_duration';
    end if;
    if v_raw is null and jsonb_typeof(p_settings -> 'rounds') = 'array' then
        for v_idx in 0..jsonb_array_length(p_settings -> 'rounds') - 1 loop
            v_round := p_settings -> 'rounds' -> v_idx;
            if coalesce(v_round ->> 'round', '') = '3' then
                v_raw := v_round ->> 'tugDuration';
                exit;
            end if;
        end loop;
    end if;
    if v_raw is null or v_raw !~ '^[0-9]+([.][0-9]+)?$' then
        return coalesce(p_default, 60000);
    end if;
    v_num := v_raw::numeric;
    if v_num <= 120 then
        v_num := v_num * 1000;
    end if;
    return least(120000, greatest(30000, round(v_num)::int));
end;
$fn$;

create or replace function public.purrfect_survival_empty_tug()
returns jsonb
language sql
immutable
as $fn$
    select jsonb_build_object(
        'phase', 'briefing',
        'redPull', 0,
        'bluePull', 0,
        'redCombo', 0,
        'blueCombo', 0,
        'redRageUntil', 0,
        'blueRageUntil', 0,
        'position', 0,
        'winner', null,
        'suddenDeath', false
    );
$fn$;

-- Pure tug answer application. Mirrors PSEngine.applyTugAnswer exactly.
create or replace function public.purrfect_survival_apply_tug(
    p_state jsonb,
    p_team text,
    p_correct boolean,
    p_now_ms bigint
) returns jsonb
language plpgsql
immutable
as $fn$
declare
    v_state jsonb := coalesce(p_state, '{}'::jsonb);
    v_team text := lower(coalesce(p_team, ''));
    v_combo int;
    v_rage bigint;
    v_red int;
    v_blue int;
    v_pull int := 0;
    v_pos int;
    v_winner text;
begin
    if v_team not in ('red', 'blue') then
        return v_state;
    end if;
    if coalesce(v_state ->> 'phase', 'briefing') <> 'playing' then
        return v_state;
    end if;

    v_red := coalesce((v_state ->> 'redPull')::int, 0);
    v_blue := coalesce((v_state ->> 'bluePull')::int, 0);
    v_combo := coalesce((v_state ->> (v_team || 'Combo'))::int, 0);
    v_rage := coalesce((v_state ->> (v_team || 'RageUntil'))::bigint, 0);

    if coalesce(p_correct, false) then
        if v_rage > coalesce(p_now_ms, 0) then
            v_pull := 2;
            v_combo := 0;
        else
            v_combo := v_combo + 1;
            if v_combo >= 5 then
                v_combo := 0;
                v_rage := coalesce(p_now_ms, 0) + 5000;
            end if;
            v_pull := 1;
        end if;
    else
        v_combo := 0;
        v_rage := 0;
    end if;

    if v_team = 'red' then
        v_red := greatest(0, v_red) + v_pull;
    else
        v_blue := greatest(0, v_blue) + v_pull;
    end if;
    v_pos := v_blue - v_red;
    v_winner := case
        when v_pos >= 20 then 'blue'
        when v_pos <= -20 then 'red'
        when coalesce((v_state ->> 'suddenDeath')::boolean, false)
             and coalesce(p_correct, false)
             and v_pos <> 0
            then case when v_pos > 0 then 'blue' else 'red' end
        else null
    end;

    return jsonb_build_object(
        'phase', case when v_winner is null then 'playing' else 'done' end,
        'redPull', v_red,
        'bluePull', v_blue,
        'redCombo', case when v_team = 'red' then v_combo else coalesce((v_state ->> 'redCombo')::int, 0) end,
        'blueCombo', case when v_team = 'blue' then v_combo else coalesce((v_state ->> 'blueCombo')::int, 0) end,
        'redRageUntil', case when v_team = 'red' then v_rage else coalesce((v_state ->> 'redRageUntil')::bigint, 0) end,
        'blueRageUntil', case when v_team = 'blue' then v_rage else coalesce((v_state ->> 'blueRageUntil')::bigint, 0) end,
        'position', v_pos,
        'winner', v_winner,
        'suddenDeath', coalesce((v_state ->> 'suddenDeath')::boolean, false)
    );
end;
$fn$;

-- Mid-round flow. When the last player leaves the glass bridge:
--   * 1–2 round classes finish exactly as before;
--   * a 3-round class with 2+ survivors moves to status='round3' in the
--     briefing phase (the host starts the clock);
--   * a 3-round class with 0–1 survivors skips the tug and finishes.
create or replace function public.purrfect_survival_finish_if_done(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_alive int;
    v_survivors int;
    v_count int;
begin
    select * into v_room from public.purrfect_survival_rooms where id = p_room_id for update;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.status <> 'round2' then
        return v_room;
    end if;

    select count(*) into v_alive
    from public.purrfect_survival_players
    where room_id = p_room_id and status = 'alive' and is_playing;

    if v_alive > 0 then
        return v_room;
    end if;

    v_count := public.purrfect_survival_round_count(v_room.settings);

    if v_count >= 3 then
        select count(*) into v_survivors
        from public.purrfect_survival_players
        where room_id = p_room_id
          and status = 'advanced'
          and is_playing;

        if v_survivors >= 2 then
            update public.purrfect_survival_rooms
            set status = 'round3',
                current_round = 3,
                round3_started_at = null,
                round3_ends_at = null,
                tug_state = public.purrfect_survival_empty_tug(),
                finished_at = null,
                server_now = now()
            where id = p_room_id
            returning * into v_room;
            return v_room;
        end if;
    end if;

    update public.purrfect_survival_rooms
    set status = 'finished',
        current_round = 2,
        finished_at = coalesce(finished_at, now()),
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$fn$;

-- Host starts the Tug of War. Assigns the fair snake teams from the final
-- survivor list, stores the tug questions/timer and opens scoring.
create or replace function public.start_purrfect_survival_round3(
    p_room_id uuid,
    p_questions jsonb default '[]'::jsonb
) returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_survivors int;
    v_tug_questions jsonb;
    v_duration int;
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
    if v_room.status = 'finished' then
        return v_room;
    end if;
    if v_room.status <> 'round3' then
        return v_room;
    end if;
    if coalesce(v_room.tug_state ->> 'phase', 'briefing') = 'playing' then
        return v_room;
    end if;

    select count(*) into v_survivors
    from public.purrfect_survival_players
    where room_id = p_room_id
      and status = 'advanced'
      and is_playing
      and not ghost;

    if v_survivors < 2 then
        update public.purrfect_survival_rooms
        set status = 'finished',
            current_round = 2,
            finished_at = coalesce(finished_at, now()),
            server_now = now()
        where id = p_room_id
        returning * into v_room;
        return v_room;
    end if;

    -- Snake split by glass finish time, then round-1 rank, then user id.
    with ranked as (
        select
            p.user_id,
            row_number() over (
                order by
                    p.glass_finished_at asc nulls last,
                    p.round1_rank asc nulls last,
                    p.user_id asc
            ) as rn
        from public.purrfect_survival_players p
        where p.room_id = p_room_id
          and p.status = 'advanced'
          and p.is_playing
          and not p.ghost
    )
    update public.purrfect_survival_players p
    set tug_team = case when (r.rn - 1) % 4 in (0, 3) then 'red' else 'blue' end,
        question_index = 0,
        last_seen = now()
    from ranked r
    where p.user_id = r.user_id
      and p.room_id = p_room_id;

    update public.purrfect_survival_players
    set tug_team = null
    where room_id = p_room_id
      and (status <> 'advanced' or not is_playing or ghost);

    if p_questions is not null
       and jsonb_typeof(p_questions) = 'array'
       and jsonb_array_length(p_questions) > 0 then
        v_tug_questions := p_questions;
    else
        v_tug_questions := coalesce(v_room.tug_questions, '[]'::jsonb);
    end if;
    if jsonb_array_length(v_tug_questions) = 0 then
        v_tug_questions := coalesce(v_room.questions, '[]'::jsonb);
    end if;

    v_duration := public.purrfect_survival_tug_duration(v_room.settings, 60000);

    update public.purrfect_survival_rooms
    set tug_questions = v_tug_questions,
        tug_state = public.purrfect_survival_empty_tug()
            || jsonb_build_object('phase', 'playing'),
        round3_started_at = now(),
        round3_ends_at = now() + make_interval(secs => (v_duration / 1000.0)::double precision),
        finished_at = null,
        server_now = now()
    where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$fn$;

-- ---------- create / start ----------

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
       and (v_settings ->> 'roundCount')::int > 3 then
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

-- Drop the old 5-argument start overload first so PostgREST never sees two.
drop function if exists public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int);

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
as $fn$
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
$fn$;

-- ---------- heartbeat ----------

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

        -- This now either finishes the class or moves a 3-round class to
        -- the Round-3 briefing (no clock yet).
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
                tug_state = v_state,
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

    -- Large banks are cached by the client after the first fetch.
    v_room.questions := '[]'::jsonb;
    v_room.tug_questions := '[]'::jsonb;
    return v_room;
end;
$fn$;

-- ---------- answer press (round 1 + tug) ----------

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

-- ---------- glass jump (stamp glass_finished_at) ----------

create or replace function public.glass_jump_purrfect_survival(
    p_room_id uuid,
    p_side text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_player public.purrfect_survival_players;
    v_side text;
    v_index int;
    v_steps jsonb;
    v_step jsonb;
    v_correct_side text;
    v_outcome text;
    v_new_step int;
    v_len int;
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

    if v_player.glass_started_at is not null
       and now() - v_player.glass_started_at >= interval '5 seconds' then
        update public.purrfect_survival_players
        set status = 'eliminated',
            ghost = true,
            eliminated_reason = 'glass_timeout',
            glass_active = false
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
            'room', to_jsonb(v_room) - 'questions' - 'tug_questions'
        );
    end if;

    v_side := lower(trim(coalesce(p_side, '')));
    if v_side not in ('left', 'right') then
        return jsonb_build_object('ok', false, 'error', 'INVALID_SIDE');
    end if;

    v_steps := coalesce(v_room.glass_steps, '[]'::jsonb);
    v_len := jsonb_array_length(v_steps);
    v_index := v_player.glass_step;

    if v_index < 0 or v_index >= v_len then
        return jsonb_build_object('ok', false, 'error', 'INVALID_STEP');
    end if;

    v_step := v_steps -> v_index;
    v_correct_side := v_step ->> 'correct_side';
    v_outcome := case when v_side = v_correct_side then 'correct' else 'wrong' end;

    v_step := jsonb_set(v_step, '{revealed}', 'true'::jsonb, true);
    v_step := jsonb_set(v_step, '{revealed_side}', to_jsonb(v_correct_side), true);
    v_step := jsonb_set(
        v_step,
        '{shattered_side}',
        case when v_outcome = 'wrong'
             then to_jsonb(case when v_correct_side = 'left' then 'right' else 'left' end)
             else 'null'::jsonb end,
        true
    );
    v_steps := jsonb_set(v_steps, array[v_index::text], v_step, false);

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
            last_seen = now()
        where room_id = p_room_id and user_id = auth.uid()
        returning * into v_player;
    end if;

    update public.purrfect_survival_rooms
    set glass_steps = v_steps
    where id = p_room_id
    returning * into v_room;

    perform public.purrfect_survival_release_glass(p_room_id);
    v_room := public.purrfect_survival_finish_if_done(p_room_id);

    return jsonb_build_object(
        'ok', true,
        'outcome', v_outcome,
        'finished_bridge', v_finished,
        'correct_side', v_correct_side,
        'revealed', true,
        'step_index', v_index,
        'player', to_jsonb(v_player),
        'room', to_jsonb(v_room) - 'questions' - 'tug_questions'
    );
end;
$fn$;

-- ---------- grants ----------

revoke all on function public.purrfect_survival_round_count(jsonb) from public, anon, authenticated;
revoke all on function public.purrfect_survival_tug_duration(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_empty_tug() from public, anon, authenticated;
revoke all on function public.purrfect_survival_apply_tug(jsonb, text, boolean, bigint) from public, anon, authenticated;
revoke all on function public.purrfect_survival_finish_if_done(uuid) from public, anon, authenticated;

revoke all on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) from public, anon;
revoke all on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb) from public, anon;
revoke all on function public.start_purrfect_survival_round3(uuid, jsonb) from public, anon;
revoke all on function public.tick_purrfect_survival(uuid) from public, anon;
revoke all on function public.submit_purrfect_survival_answer(uuid, int) from public, anon;
revoke all on function public.glass_jump_purrfect_survival(uuid, text) from public, anon;

grant execute on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) to authenticated;
grant execute on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb) to authenticated;
grant execute on function public.start_purrfect_survival_round3(uuid, jsonb) to authenticated;
grant execute on function public.tick_purrfect_survival(uuid) to authenticated;
grant execute on function public.submit_purrfect_survival_answer(uuid, int) to authenticated;
grant execute on function public.glass_jump_purrfect_survival(uuid, text) to authenticated;

notify pgrst, 'reload schema';
