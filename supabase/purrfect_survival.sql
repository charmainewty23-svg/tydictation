-- ============================================================
-- LearniTY — Purr-fect Survival (class survival game)
--
-- Paste this whole file into the LIVE project's Supabase SQL editor:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
-- Do NOT apply it from a plugin, CLI or agent. Safe to re-run.
--
-- Covers the lobby, Round 1 (1-2-3 Meow! / Red Light, Green Light),
-- Round 2 (Glass Stepping Stones), Round 3 (Tug of War), Round 4
-- (Dalgona Candy Carving) and Round 5 (Grammar Finals). The prize ceremony
-- awards Paws and is folded in near the end of the file.
-- `current_round` and `status` are deliberately extensible for later rounds.
--
-- Host settings (2026-11): the host picks 1–5 rounds, an independent
-- subject/topic per round (Rounds 4–5 use fixed banks), the round-1 finish
-- distance (30-300 m), the round-2 glass step count (3-15), the round-3 tug
-- time limit (30-120 s), the Round-4 carving time (60-600 s) and the
-- Round-5 finals time (60-180 s). They are stored in the versioned
-- `settings` JSON: { version, roundCount, rounds: [ ... ] }.
-- Round 5 starts only when at least 2 Dalgona survivors remain; otherwise
-- the prize ceremony starts immediately.
--
-- Guests are anonymous, so auth.uid() is null for them: every RPC here
-- raises NOT_AUTHENTICATED. The frontend also blocks guest mode.
-- ============================================================

create table if not exists public.purrfect_survival_rooms (
    id               uuid primary key default gen_random_uuid(),
    code             text not null unique,
    host_id          uuid not null references auth.users(id) on delete cascade,
    status           text not null default 'waiting'
                     check (status in ('waiting', 'round1', 'round2', 'round3', 'finished')),
    subject          text not null default 'vocab'
                     check (subject in ('vocab', 'grammar')),
    source           text not null default '',
    topic            text not null default '',
    bank_mode        text not null default '',
    seed             bigint not null,
    max_players      int not null default 31,
    finish_distance  int not null default 100,
    current_round    int not null default 0,
    round1_started_at timestamptz,
    round1_ends_at   timestamptz,
    round2_started_at timestamptz,
    round2_ends_at   timestamptz,
    round3_started_at timestamptz,
    round3_ends_at   timestamptz,
    phase_schedule   jsonb not null default '[]'::jsonb,
    questions        jsonb not null default '[]'::jsonb,
    glass_steps      jsonb not null default '[]'::jsonb,
    tug_state        jsonb not null default '{}'::jsonb,
    tug_questions    jsonb not null default '[]'::jsonb,
    settings         jsonb not null default '{}'::jsonb,
    created_at       timestamptz not null default now(),
    started_at       timestamptz,
    finished_at      timestamptz,
    server_now       timestamptz not null default now()
);

alter table public.purrfect_survival_rooms
    add column if not exists server_now timestamptz not null default now();

alter table public.purrfect_survival_rooms
    add column if not exists round3_started_at timestamptz,
    add column if not exists round3_ends_at timestamptz,
    add column if not exists tug_state jsonb not null default '{}'::jsonb,
    add column if not exists tug_questions jsonb not null default '[]'::jsonb;

create table if not exists public.purrfect_survival_players (
    room_id          uuid not null references public.purrfect_survival_rooms(id) on delete cascade,
    user_id          uuid not null references auth.users(id) on delete cascade,
    email            text,
    nickname         text,
    cat              text default 'Ginger',
    glasses          text default 'None',
    hat              text default 'None',
    outfit           text default 'None',
    distance         int not null default 0,
    red_offences     int not null default 0,
    status           text not null default 'alive'
                     check (status in ('alive', 'eliminated', 'advanced')),
    ghost            boolean not null default false,
    eliminated_reason text,
    question_index   int not null default 0,
    last_red_phase   int not null default -1,
    reached_finish   boolean not null default false,
    finished_at      timestamptz,
    round1_rank      int,
    glass_step       int not null default 0,
    glass_side       text,
    glass_active     boolean not null default false,
    glass_started_at timestamptz,
    glass_finished_at timestamptz,
    crossed_glass    boolean not null default false,
    tug_team         text,
    answer_log       jsonb not null default '[]'::jsonb,
    glass_order      jsonb not null default '[]'::jsonb,
    is_playing       boolean not null default true,
    last_seen        timestamptz not null default now(),
    primary key (room_id, user_id)
);

create index if not exists ps_rooms_created_idx on public.purrfect_survival_rooms (created_at desc);
create index if not exists ps_rooms_code_idx on public.purrfect_survival_rooms (code);
create index if not exists ps_players_room_idx on public.purrfect_survival_players (room_id);

alter table public.purrfect_survival_players
    add column if not exists glass_finished_at timestamptz,
    add column if not exists tug_team text,
    add column if not exists answer_log jsonb not null default '[]'::jsonb,
    add column if not exists glass_order jsonb not null default '[]'::jsonb;

-- ---------- helpers ----------

create or replace function public.is_purrfect_survival_teacher()
returns boolean
language sql
stable
as $$
    select coalesce(auth.jwt() ->> 'email', '') = 'tywong@lstyoungkhl.edu.hk';
$$;

create or replace function public.is_purrfect_survival_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.purrfect_survival_rooms r
        where r.id = p_room_id and r.host_id = auth.uid()
    ) or exists (
        select 1 from public.purrfect_survival_players p
        where p.room_id = p_room_id and p.user_id = auth.uid()
    );
$$;

-- Mirrors PSEngine.phaseAt(): walks the persisted schedule using server
-- time, so every phone sees the same green / yellow / red phase.
create or replace function public.purrfect_survival_phase(
    p_schedule jsonb,
    p_elapsed_ms bigint
) returns table (
    phase text,
    phase_index int,
    phase_elapsed_ms bigint,
    remaining_ms bigint
)
language plpgsql
immutable
as $$
declare
    v_item jsonb;
    v_dur bigint;
    v_acc bigint := 0;
    i int;
begin
    if p_schedule is null
       or jsonb_typeof(p_schedule) <> 'array'
       or jsonb_array_length(p_schedule) = 0 then
        return query select 'done'::text, 0, 0::bigint, 0::bigint;
        return;
    end if;

    for i in 0..jsonb_array_length(p_schedule) - 1 loop
        v_item := p_schedule -> i;
        v_dur := greatest(0, coalesce((v_item ->> 'duration_ms')::bigint, 0));
        if p_elapsed_ms < v_acc + v_dur then
            return query select
                coalesce(v_item ->> 'phase', 'green')::text,
                i,
                p_elapsed_ms - v_acc,
                v_acc + v_dur - p_elapsed_ms;
            return;
        end if;
        v_acc := v_acc + v_dur;
    end loop;

    return query select 'done'::text, jsonb_array_length(p_schedule), 0::bigint, 0::bigint;
end;
$$;

-- Reads the host settings round count. Old rooms default to 2 (today's
-- behaviour). This historical three-round definition is kept for older
-- tests; a later create-or-replace near the end of this file clamps the live
-- definition to the implemented rounds (1–5).
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
    return least(3, greatest(1, v_raw::int));
end;
$$;

-- Rounds-1 finish distance from settings: default 100 m, clamped to
-- 30-300 m on the 10 m step used by the lobby.
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

-- Round-2 glass step count: default 9, clamped to 3-15.
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

-- Round-3 tug duration: default 60 s, clamped to 30–120 s. The lobby saves
-- milliseconds; a value <= 120 is treated as seconds for old/manual rows.
create or replace function public.purrfect_survival_tug_duration(p_settings jsonb, p_default int default 60000)
returns int
language plpgsql
immutable
as $$
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
$$;

create or replace function public.purrfect_survival_empty_tug()
returns jsonb
language sql
immutable
as $$
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
$$;

-- Pure tug answer application. Mirrors PSEngine.applyTugAnswer.
create or replace function public.purrfect_survival_apply_tug(
    p_state jsonb,
    p_team text,
    p_correct boolean,
    p_now_ms bigint
) returns jsonb
language plpgsql
immutable
as $$
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
$$;

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

create or replace function public.purrfect_survival_finish_if_done(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- Host starts the Tug of War: assigns the fair snake teams from the final
-- survivor list, stores the bank/timer and opens scoring immediately.
create or replace function public.start_purrfect_survival_round3(
    p_room_id uuid,
    p_questions jsonb default '[]'::jsonb
) returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ---------- RLS ----------

alter table public.purrfect_survival_rooms enable row level security;
alter table public.purrfect_survival_players enable row level security;

drop policy if exists "ps rooms read members" on public.purrfect_survival_rooms;
drop policy if exists "ps rooms read teacher" on public.purrfect_survival_rooms;
drop policy if exists "ps players read members" on public.purrfect_survival_players;
drop policy if exists "ps players read teacher" on public.purrfect_survival_players;

create policy "ps rooms read members" on public.purrfect_survival_rooms
    for select using (public.is_purrfect_survival_member(id));

create policy "ps rooms read teacher" on public.purrfect_survival_rooms
    for select using (public.is_purrfect_survival_teacher());

create policy "ps players read members" on public.purrfect_survival_players
    for select using (public.is_purrfect_survival_member(room_id));

create policy "ps players read teacher" on public.purrfect_survival_players
    for select using (public.is_purrfect_survival_teacher());

grant select on public.purrfect_survival_rooms to authenticated;
grant select on public.purrfect_survival_players to authenticated;

-- ---------- room lifecycle ----------

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

    -- Host settings are a versioned JSON blob. Missing/legacy settings keep
    -- today's defaults (2 rounds, 100 m, 9 glass steps). Mixed subjects are
    -- allowed ACROSS rounds; each individual round is still one subject.
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

create or replace function public.join_purrfect_survival(
    p_code text,
    p_nickname text default null,
    p_look jsonb default '{}'::jsonb
) returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
    v_count int;
    v_look jsonb;
    v_code text;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    v_code := upper(trim(coalesce(p_code, '')));
    select * into v_room
    from public.purrfect_survival_rooms
    where code = v_code
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    -- Rejoining your own room is always fine.
    if exists (
        select 1 from public.purrfect_survival_players
        where room_id = v_room.id and user_id = auth.uid()
    ) then
        update public.purrfect_survival_players
        set last_seen = now()
        where room_id = v_room.id and user_id = auth.uid();
        return v_room;
    end if;

    if v_room.status = 'finished' then
        raise exception 'ROOM_FINISHED';
    end if;
    if v_room.status <> 'waiting' then
        raise exception 'ROOM_ALREADY_STARTED';
    end if;

    select count(*) into v_count
    from public.purrfect_survival_players
    where room_id = v_room.id;

    if v_count >= v_room.max_players then
        raise exception 'ROOM_FULL';
    end if;

    v_look := coalesce(p_look, '{}'::jsonb);
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

    return v_room;
end;
$$;

create or replace function public.rejoin_purrfect_survival(p_room_id uuid)
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
    if not public.is_purrfect_survival_member(p_room_id) then
        raise exception 'NOT_A_MEMBER';
    end if;
    select * into v_room from public.purrfect_survival_rooms where id = p_room_id;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    update public.purrfect_survival_players
    set last_seen = now()
    where room_id = p_room_id and user_id = auth.uid();
    return v_room;
end;
$$;

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

-- Host early-end for rounds 2–4. Round 1 keeps using the older
-- end_purrfect_survival_round1() above while this one mirrors the time-up
-- rules in tick_purrfect_survival(). The current live body also ships as
-- supabase/purrfect_survival_end_rounds.sql (run after the incrementals).
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

        v_room := public.purrfect_survival_finish_if_done(p_room_id);
        return v_room;
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
    -- A 1-round class never crosses to the bridge: finish instead.
    if public.purrfect_survival_round_count(v_room.settings) <= 1 then
        if v_room.status = 'round1' then
            return public.purrfect_survival_complete_round1(p_room_id);
        end if;
        return v_room;
    end if;
    return public.purrfect_survival_begin_round2(p_room_id);
end;
$$;

-- Idempotent heartbeat: callable by any member. Uses server time to end
-- round 1 at 15 finishers / the time limit, time out glass jumpers after
-- 7 s, release the next queued player and finish the room when no living
-- player remains.
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
            -- 2 rounds: first 15 finishers (or time up) cross to the bridge.
            if v_finished >= 15
               or (v_room.round1_ends_at is not null and v_now >= v_room.round1_ends_at) then
                v_room := public.purrfect_survival_complete_round1(p_room_id);
            end if;
        else
            -- 1 round: no top-15 cut. Finish when every living player has
            -- reached the finish, or when the scaled time cap is reached.
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

        -- Finishes a 1–2 round class or moves a 3-round class to Round 3
        -- briefing (no clock yet).
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

    -- Questions are large and never change after start; clients keep their
    -- first copy instead of downloading them on every 700 ms tick.
    v_room.questions := '[]'::jsonb;
    v_room.tug_questions := '[]'::jsonb;
    return v_room;
end;
$$;

-- Answer press. Green / yellow: compare with the player's current
-- question, sprint +10 m on a correct answer, no movement on a wrong one.
-- Red (or schedule done): first press -30 m, second -15 m, third out.
-- The same red phase cannot penalise twice.
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
-- no jump within 7 s -> fall with no reveal. The next queued player is
-- released as soon as step 0 is clear.
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

create or replace function public.leave_purrfect_survival(p_room_id uuid)
returns jsonb
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

    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id
    for update;

    if not found then
        return jsonb_build_object('ok', true, 'closed', true);
    end if;

    if v_room.host_id = auth.uid() and v_room.status = 'waiting' then
        delete from public.purrfect_survival_rooms where id = p_room_id;
        return jsonb_build_object('ok', true, 'closed', true);
    end if;

    delete from public.purrfect_survival_players
    where room_id = p_room_id and user_id = auth.uid();

    if v_room.status = 'round2' then
        perform public.purrfect_survival_release_glass(p_room_id);
        perform public.purrfect_survival_finish_if_done(p_room_id);
    end if;

    return jsonb_build_object('ok', true, 'closed', false);
end;
$$;

-- ---------- Prize ceremony: English titles, Paws table, ranking + awards ----------
-- The same block also ships as supabase/purrfect_survival_ceremony.sql so
-- existing live projects can apply it without re-running this whole file.
-- Paws: 1st +20, 2nd +13, 3rd +8, other survivors +5, other participants +2.

-- ---------- Paws table helper ----------

create or replace function public.purrfect_survival_ceremony_paws(
    p_place int,
    p_survived boolean
) returns int
language sql
immutable
as $fn$
    select case
        when p_place = 1 then 20
        when p_place = 2 then 13
        when p_place = 3 then 8
        when coalesce(p_survived, false) then 5
        else 2
    end;
$fn$;

-- ---------- Official ranking (mirrors PSEngine.ceremonyResults) ----------

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
    tug_won boolean
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
               r.tug_team, r.tug_won
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
               r.tug_team, null::boolean
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
           r.tug_team, null::boolean
      from ranked r
     order by r.place;
end;
$fn$;

-- ---------- Idempotent ledger award ----------

create or replace function public.paw_trg_purrfect_survival()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if new.status <> 'finished'
       or old.status is not distinct from 'finished' then
        return new;
    end if;
    if to_regclass('public.paw_ledger') is null then
        return new;
    end if;

    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    select r.user_id,
           r.paws,
           'purrfect_survival',
           'purrfect_survival:' || new.id::text || ':' || r.user_id::text
      from public.purrfect_survival_ceremony_rows(new.id) r
     where r.paws > 0
    on conflict (user_id, ref_key) do nothing;

    return new;
end;
$fn$;

drop trigger if exists paw_trg_purrfect_survival_after_update on public.purrfect_survival_rooms;
create trigger paw_trg_purrfect_survival_after_update
after update on public.purrfect_survival_rooms
for each row execute function public.paw_trg_purrfect_survival();

-- ---------- Callable ceremony RPC ----------

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

-- ---------- Paws "today" now includes Purr-fect Survival ----------

create or replace function public.my_paws_today()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_day_start timestamptz :=
        ((now() at time zone 'Asia/Hong_Kong')::date::timestamp at time zone 'Asia/Hong_Kong');
    v_total int := 0;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    select coalesce(sum(amount), 0)::int into v_total
      from public.paw_ledger
     where user_id = v_me
       and amount > 0
       and created_at >= v_day_start
       and (reason like 'practice:%'
            or reason = 'class_battle'
            or reason = 'purrfect_survival');
    return v_total;
end;
$fn$;

create or replace function public.friend_paws_daily(p_user_id uuid, p_days int default 7)
returns table (day date, earned int)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_days int := greatest(1, least(coalesce(p_days, 7), 31));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_start timestamptz :=
        ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Hong_Kong');
begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_user_id is null then return; end if;
    return query
    with days as (
        select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as d
    ),
    daily as (
        select (l.created_at at time zone 'Asia/Hong_Kong')::date as d,
               sum(l.amount)::int as earned
          from public.paw_ledger l
         where l.user_id = p_user_id
           and l.amount > 0
           and l.created_at >= v_start
           and (l.reason like 'practice:%'
                or l.reason = 'class_battle'
                or l.reason = 'purrfect_survival')
         group by (l.created_at at time zone 'Asia/Hong_Kong')::date
    )
    select days.d as day, coalesce(daily.earned, 0)::int as earned
      from days
      left join daily on daily.d = days.d
     order by days.d;
end;
$fn$;

-- ---------- grants ----------

revoke all on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) from public, anon;
revoke all on function public.join_purrfect_survival(text, text, jsonb) from public, anon;
revoke all on function public.rejoin_purrfect_survival(uuid) from public, anon;
revoke all on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb) from public, anon;
revoke all on function public.start_purrfect_survival_round3(uuid, jsonb) from public, anon;
revoke all on function public.end_purrfect_survival_round1(uuid) from public, anon;
revoke all on function public.end_purrfect_survival_round(uuid) from public, anon;
revoke all on function public.start_purrfect_survival_round2(uuid) from public, anon;
revoke all on function public.tick_purrfect_survival(uuid) from public, anon;
revoke all on function public.submit_purrfect_survival_answer(uuid, int) from public, anon;
revoke all on function public.glass_jump_purrfect_survival(uuid, text) from public, anon;
revoke all on function public.leave_purrfect_survival(uuid) from public, anon;

grant execute on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) to authenticated;
grant execute on function public.join_purrfect_survival(text, text, jsonb) to authenticated;
grant execute on function public.rejoin_purrfect_survival(uuid) to authenticated;
grant execute on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb) to authenticated;
grant execute on function public.start_purrfect_survival_round3(uuid, jsonb) to authenticated;
grant execute on function public.end_purrfect_survival_round1(uuid) to authenticated;
grant execute on function public.end_purrfect_survival_round(uuid) to authenticated;
grant execute on function public.start_purrfect_survival_round2(uuid) to authenticated;
grant execute on function public.tick_purrfect_survival(uuid) to authenticated;
grant execute on function public.submit_purrfect_survival_answer(uuid, int) to authenticated;
grant execute on function public.glass_jump_purrfect_survival(uuid, text) to authenticated;
grant execute on function public.leave_purrfect_survival(uuid) to authenticated;

-- Helpers used by policies / other RPCs.
revoke all on function public.is_purrfect_survival_teacher() from public, anon;
revoke all on function public.is_purrfect_survival_member(uuid) from public, anon;
revoke all on function public.purrfect_survival_phase(jsonb, bigint) from public, anon;
revoke all on function public.purrfect_survival_round_count(jsonb) from public, anon, authenticated;
revoke all on function public.purrfect_survival_tug_duration(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_empty_tug() from public, anon, authenticated;
revoke all on function public.purrfect_survival_apply_tug(jsonb, text, boolean, bigint) from public, anon, authenticated;
revoke all on function public.purrfect_survival_finish_value(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_glass_count(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_release_glass(uuid) from public, anon, authenticated;
revoke all on function public.purrfect_survival_begin_round2(uuid) from public, anon, authenticated;
revoke all on function public.purrfect_survival_complete_round1(uuid) from public, anon, authenticated;
revoke all on function public.purrfect_survival_finish_if_done(uuid) from public, anon, authenticated;
create or replace function public.admin_paw_daily(p_days int default 7)
returns table (
    user_id uuid,
    email text,
    nickname text,
    form text,
    day date,
    earned int,
    spent int,
    balance int
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_days int := greatest(1, least(coalesce(p_days, 7), 31));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_start timestamptz :=
        ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Hong_Kong');
begin
    if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'tywong@lstyoungkhl.edu.hk' then
        raise exception 'NOT_ADMIN';
    end if;

    return query
    with days as (
        select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as d
    ),
    students as (
        select sl.user_id, sl.email, sl.nickname, sl.form
          from public.student_logins sl
    ),
    daily as (
        select l.user_id,
               (l.created_at at time zone 'Asia/Hong_Kong')::date as d,
               sum(case when l.amount > 0
                         and (l.reason like 'practice:%'
                              or l.reason = 'class_battle'
                              or l.reason = 'purrfect_survival')
                        then l.amount else 0 end)::int as earned,
               sum(case when l.amount < 0 then -l.amount else 0 end)::int as spent
          from public.paw_ledger l
         where l.created_at >= v_start
         group by l.user_id, (l.created_at at time zone 'Asia/Hong_Kong')::date
    )
    select s.user_id,
           s.email,
           s.nickname,
           s.form,
           d.d as day,
           coalesce(x.earned, 0) as earned,
           coalesce(x.spent, 0) as spent,
           coalesce((select sum(l2.amount)::int from public.paw_ledger l2
                      where l2.user_id = s.user_id), 0) as balance
      from students s
      cross join days d
      left join daily x on x.user_id = s.user_id and x.d = d.d
     order by s.form nulls last, s.email, d.d;
end;
$fn$;

revoke all on function public.purrfect_survival_ceremony_paws(int, boolean) from public, anon, authenticated;
revoke all on function public.purrfect_survival_ceremony_rows(uuid) from public, anon, authenticated;
revoke all on function public.paw_trg_purrfect_survival() from public, anon, authenticated;
revoke all on function public.purrfect_survival_ceremony(uuid) from public, anon;
revoke all on function public.my_paws_today() from public, anon;
revoke all on function public.friend_paws_daily(uuid, int) from public, anon;
revoke all on function public.admin_paw_daily(int) from public, anon;

grant execute on function public.is_purrfect_survival_teacher() to authenticated;
grant execute on function public.is_purrfect_survival_member(uuid) to authenticated;
grant execute on function public.purrfect_survival_ceremony(uuid) to authenticated;
grant execute on function public.my_paws_today() to authenticated;
grant execute on function public.friend_paws_daily(uuid, int) to authenticated;
grant execute on function public.admin_paw_daily(int) to authenticated;

notify pgrst, 'reload schema';
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
        -- Glass thinking time stays 5 seconds on purpose.
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
revoke all on function public.end_purrfect_survival_round(uuid) from public, anon;
revoke all on function public.purrfect_survival_ceremony_rows(uuid) from public, anon, authenticated;
revoke all on function public.purrfect_survival_ceremony(uuid) from public, anon;

grant execute on function public.submit_purrfect_survival_finals(uuid, jsonb) to authenticated;
grant execute on function public.submit_purrfect_survival_ghost(uuid, jsonb) to authenticated;
grant execute on function public.throw_purrfect_survival_ink(uuid) to authenticated;
grant execute on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) to authenticated;
grant execute on function public.tick_purrfect_survival(uuid) to authenticated;
grant execute on function public.end_purrfect_survival_round(uuid) to authenticated;
grant execute on function public.purrfect_survival_ceremony(uuid) to authenticated;

notify pgrst, 'reload schema';
