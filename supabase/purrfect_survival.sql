-- ============================================================
-- LearniTY — Purr-fect Survival (class survival game)
--
-- Paste this whole file into the LIVE project's Supabase SQL editor:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
-- Do NOT apply it from a plugin, CLI or agent. Safe to re-run.
--
-- Covers the lobby, Round 1 (1-2-3 Meow! / Red Light, Green Light) and
-- Round 2 (Glass Stepping Stones). `current_round` and `status` are
-- deliberately extensible for later rounds.
--
-- Host settings (2026-11): the host picks 1 or 2 rounds, an independent
-- subject/topic per round, the round-1 finish distance (30-300 m) and the
-- round-2 glass step count (3-15). They are stored in the versioned
-- `settings` JSON: { version, roundCount, rounds: [ ... ] }.
-- Rounds 3-5 (tug of war, second glass bridge, Squid Circle) are NOT
-- playable yet; when each one ships, its host settings must ship in the
-- same change.
--
-- Guests are anonymous, so auth.uid() is null for them: every RPC here
-- raises NOT_AUTHENTICATED. The frontend also blocks guest mode.
-- ============================================================

create table if not exists public.purrfect_survival_rooms (
    id               uuid primary key default gen_random_uuid(),
    code             text not null unique,
    host_id          uuid not null references auth.users(id) on delete cascade,
    status           text not null default 'waiting'
                     check (status in ('waiting', 'round1', 'round2', 'finished')),
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
    phase_schedule   jsonb not null default '[]'::jsonb,
    questions        jsonb not null default '[]'::jsonb,
    glass_steps      jsonb not null default '[]'::jsonb,
    settings         jsonb not null default '{}'::jsonb,
    created_at       timestamptz not null default now(),
    started_at       timestamptz,
    finished_at      timestamptz,
    server_now       timestamptz not null default now()
);

alter table public.purrfect_survival_rooms
    add column if not exists server_now timestamptz not null default now();

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
    crossed_glass    boolean not null default false,
    is_playing       boolean not null default true,
    last_seen        timestamptz not null default now(),
    primary key (room_id, user_id)
);

create index if not exists ps_rooms_created_idx on public.purrfect_survival_rooms (created_at desc);
create index if not exists ps_rooms_code_idx on public.purrfect_survival_rooms (code);
create index if not exists ps_players_room_idx on public.purrfect_survival_players (room_id);

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
-- behaviour) and the value is clamped to the implemented rounds (1 or 2).
-- Rounds 3-5 are NOT playable yet; when they ship, their host settings must
-- ship in the same change.
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

-- Releases exactly one queued player onto step 0 once nobody living is
-- still standing on step 0. A player who moved to step 1+ or fell
-- unblocks the classmate behind them.
create or replace function public.purrfect_survival_release_glass(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_blocked int;
begin
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

-- Moves a round-1 room to the glass bridge. Survivors keep status=alive
-- and receive round1_rank (the queue order); the cut becomes ghosts.
create or replace function public.purrfect_survival_begin_round2(p_room_id uuid)
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
        crossed_glass = false
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

create or replace function public.purrfect_survival_finish_if_done(p_room_id uuid)
returns public.purrfect_survival_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.purrfect_survival_rooms;
    v_alive int;
begin
    select * into v_room from public.purrfect_survival_rooms where id = p_room_id;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.status <> 'round2' then
        return v_room;
    end if;

    select count(*) into v_alive
    from public.purrfect_survival_players
    where room_id = p_room_id and status = 'alive' and is_playing;

    if v_alive = 0 then
        update public.purrfect_survival_rooms
        set status = 'finished',
            current_round = 2,
            finished_at = coalesce(finished_at, now())
        where id = p_room_id
        returning * into v_room;
    end if;
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
-- 5 s, release the next queued player and finish the room when no living
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

    -- Questions are large and never change after start; clients keep their
    -- first copy instead of downloading them on every 700 ms tick.
    v_room.questions := '[]'::jsonb;
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
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if not public.is_purrfect_survival_member(p_room_id) then
        raise exception 'NOT_A_MEMBER';
    end if;

    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
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
$$;

-- Glass jump. correct -> next step; wrong -> fall (correct pane is lit);
-- no jump within 5 s -> fall with no reveal. The next queued player is
-- released as soon as step 0 is clear.
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

    -- Server-side 5 second window.
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
            'room', to_jsonb(v_room) - 'questions'
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

-- ---------- grants ----------

revoke all on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) from public, anon;
revoke all on function public.join_purrfect_survival(text, text, jsonb) from public, anon;
revoke all on function public.rejoin_purrfect_survival(uuid) from public, anon;
revoke all on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int) from public, anon;
revoke all on function public.end_purrfect_survival_round1(uuid) from public, anon;
revoke all on function public.start_purrfect_survival_round2(uuid) from public, anon;
revoke all on function public.tick_purrfect_survival(uuid) from public, anon;
revoke all on function public.submit_purrfect_survival_answer(uuid, int) from public, anon;
revoke all on function public.glass_jump_purrfect_survival(uuid, text) from public, anon;
revoke all on function public.leave_purrfect_survival(uuid) from public, anon;

grant execute on function public.create_purrfect_survival(text, text, text, text, bigint, jsonb, boolean, text, jsonb) to authenticated;
grant execute on function public.join_purrfect_survival(text, text, jsonb) to authenticated;
grant execute on function public.rejoin_purrfect_survival(uuid) to authenticated;
grant execute on function public.start_purrfect_survival(uuid, jsonb, jsonb, jsonb, int) to authenticated;
grant execute on function public.end_purrfect_survival_round1(uuid) to authenticated;
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
revoke all on function public.purrfect_survival_finish_value(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_glass_count(jsonb, int) from public, anon, authenticated;
revoke all on function public.purrfect_survival_release_glass(uuid) from public, anon, authenticated;
revoke all on function public.purrfect_survival_begin_round2(uuid) from public, anon, authenticated;
revoke all on function public.purrfect_survival_complete_round1(uuid) from public, anon, authenticated;
revoke all on function public.purrfect_survival_finish_if_done(uuid) from public, anon, authenticated;

grant execute on function public.is_purrfect_survival_teacher() to authenticated;
grant execute on function public.is_purrfect_survival_member(uuid) to authenticated;

notify pgrst, 'reload schema';
