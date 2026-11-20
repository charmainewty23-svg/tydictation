-- QuizzyKitty class rooms: a teacher hosts, up to 30 students join with a
-- 4-digit code. Questions are generated on the teacher's device and stored
-- here; students receive them without the answer keys.
--
-- Safe to re-run. All table access goes through the RPCs below; the tables
-- themselves have no client policies.

create extension if not exists pgcrypto;

create table if not exists public.quizzykitty_rooms (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    host_key text not null,
    host_id uuid,
    status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
    phase text not null default 'question' check (phase in ('question', 'reveal')),
    q_index int not null default 0,
    seconds int not null default 15 check (seconds between 5 and 120),
    questions jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz
);

create table if not exists public.quizzykitty_players (
    room_id uuid not null references public.quizzykitty_rooms(id) on delete cascade,
    client_id text not null,
    user_id uuid,
    nickname text not null,
    cat text not null default 'Ginger',
    look jsonb not null default '{}'::jsonb,
    score int not null default 0,
    correct int not null default 0,
    streak int not null default 0,
    joined_at timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    primary key (room_id, client_id)
);

create table if not exists public.quizzykitty_answers (
    room_id uuid not null references public.quizzykitty_rooms(id) on delete cascade,
    client_id text not null,
    q_index int not null,
    answer jsonb,
    correct boolean not null default false,
    ms int not null default 0,
    points int not null default 0,
    created_at timestamptz not null default now(),
    primary key (room_id, client_id, q_index)
);

alter table public.quizzykitty_rooms enable row level security;
alter table public.quizzykitty_players enable row level security;
alter table public.quizzykitty_answers enable row level security;

revoke all on public.quizzykitty_rooms from anon, authenticated;
revoke all on public.quizzykitty_players from anon, authenticated;
revoke all on public.quizzykitty_answers from anon, authenticated;

-- Same punctuation/case rules as the client.
create or replace function public.qz_norm(p text)
returns text
language sql
immutable
as $$
    select regexp_replace(
        regexp_replace(lower(trim(coalesce(p, ''))), '[.,!?;:''"“”‘’()]', '', 'g'),
        '\s+', ' ', 'g'
    );
$$;
revoke all on function public.qz_norm(text) from public;
revoke all on function public.qz_norm(text) from anon, authenticated;

create or replace function public.quizzykitty_new_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v text;
    i int := 0;
begin
    loop
        v := lpad((floor(random() * 10000))::int::text, 4, '0');
        exit when not exists (select 1 from public.quizzykitty_rooms r where r.code = v);
        i := i + 1;
        if i >= 40 then
            v := substr(md5(random()::text), 1, 4);
            exit;
        end if;
    end loop;
    return v;
end;
$$;
revoke all on function public.quizzykitty_new_code() from public;
revoke all on function public.quizzykitty_new_code() from anon, authenticated;

create or replace function public.quizzykitty_is_host(p_room uuid, p_host_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.quizzykitty_rooms r
        where r.id = p_room
          and (
              (p_host_key is not null and r.host_key = p_host_key)
              or (r.host_id is not null and r.host_id = auth.uid())
          )
    );
$$;
revoke all on function public.quizzykitty_is_host(uuid, text) from public;
revoke all on function public.quizzykitty_is_host(uuid, text) from anon, authenticated;

-- Teacher creates a room with the snapshot of questions (answers included).
create or replace function public.quizzykitty_create(
    p_questions jsonb,
    p_seconds int,
    p_host_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.quizzykitty_rooms;
begin
    if p_host_key is null or length(p_host_key) < 8 then
        raise exception 'BAD_HOST_KEY';
    end if;
    if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
        raise exception 'NO_QUESTIONS';
    end if;
    if jsonb_array_length(p_questions) > 60 then
        raise exception 'TOO_MANY_QUESTIONS';
    end if;

    delete from public.quizzykitty_rooms
    where created_at < now() - interval '2 days';

    insert into public.quizzykitty_rooms (code, host_key, host_id, seconds, questions)
    values (
        public.quizzykitty_new_code(),
        p_host_key,
        auth.uid(),
        greatest(5, least(120, coalesce(p_seconds, 15))),
        p_questions
    )
    returning * into v_room;

    return jsonb_build_object('room_id', v_room.id, 'code', v_room.code);
end;
$$;
revoke all on function public.quizzykitty_create(jsonb, int, text) from public;
grant execute on function public.quizzykitty_create(jsonb, int, text) to anon, authenticated;

-- Student joins (or re-joins) with the 4-digit code.
create or replace function public.quizzykitty_join(
    p_code text,
    p_client_id text,
    p_nickname text,
    p_cat text,
    p_look jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.quizzykitty_rooms;
    v_count int;
begin
    if p_client_id is null or length(trim(p_client_id)) < 8 then
        raise exception 'BAD_CLIENT';
    end if;

    select * into v_room
    from public.quizzykitty_rooms
    where code = trim(p_code)
    order by created_at desc
    limit 1;

    if v_room.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
    if v_room.status = 'finished' then raise exception 'ROOM_FINISHED'; end if;

    select count(*) into v_count
    from public.quizzykitty_players
    where room_id = v_room.id and client_id <> trim(p_client_id);

    if v_count >= 30 and not exists (
        select 1 from public.quizzykitty_players
        where room_id = v_room.id and client_id = trim(p_client_id)
    ) then
        raise exception 'ROOM_FULL';
    end if;

    insert into public.quizzykitty_players (room_id, client_id, user_id, nickname, cat, look)
    values (
        v_room.id,
        trim(p_client_id),
        auth.uid(),
        left(coalesce(nullif(trim(p_nickname), ''), 'Student'), 24),
        coalesce(nullif(trim(p_cat), ''), 'Ginger'),
        coalesce(p_look, '{}'::jsonb)
    )
    on conflict (room_id, client_id) do update
        set nickname = excluded.nickname,
            cat = excluded.cat,
            look = excluded.look,
            user_id = coalesce(excluded.user_id, public.quizzykitty_players.user_id),
            last_seen = now();

    return jsonb_build_object(
        'room_id', v_room.id,
        'code', v_room.code,
        'status', v_room.status
    );
end;
$$;
revoke all on function public.quizzykitty_join(text, text, text, text, jsonb) from public;
grant execute on function public.quizzykitty_join(text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.quizzykitty_start(p_room uuid, p_host_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.quizzykitty_is_host(p_room, p_host_key) then raise exception 'NOT_HOST'; end if;
    update public.quizzykitty_rooms
    set status = 'playing', phase = 'question', q_index = 0,
        started_at = now(), finished_at = null
    where id = p_room and status = 'waiting';
    return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.quizzykitty_start(uuid, text) from public;
grant execute on function public.quizzykitty_start(uuid, text) to anon, authenticated;

create or replace function public.quizzykitty_reveal(p_room uuid, p_host_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.quizzykitty_is_host(p_room, p_host_key) then raise exception 'NOT_HOST'; end if;
    update public.quizzykitty_rooms
    set phase = 'reveal'
    where id = p_room and status = 'playing';
    return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.quizzykitty_reveal(uuid, text) from public;
grant execute on function public.quizzykitty_reveal(uuid, text) to anon, authenticated;

create or replace function public.quizzykitty_next(p_room uuid, p_host_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.quizzykitty_rooms;
    v_next int;
    v_total int;
begin
    if not public.quizzykitty_is_host(p_room, p_host_key) then raise exception 'NOT_HOST'; end if;
    select * into v_room from public.quizzykitty_rooms where id = p_room;
    if v_room.id is null or v_room.status <> 'playing' then raise exception 'NOT_PLAYING'; end if;
    v_total := jsonb_array_length(v_room.questions);
    v_next := v_room.q_index + 1;
    if v_next >= v_total then
        update public.quizzykitty_rooms
        set status = 'finished', finished_at = now(), phase = 'reveal'
        where id = p_room;
        return jsonb_build_object('finished', true, 'q_index', v_next);
    end if;
    update public.quizzykitty_rooms
    set q_index = v_next, phase = 'question', started_at = now()
    where id = p_room;
    return jsonb_build_object('finished', false, 'q_index', v_next);
end;
$$;
revoke all on function public.quizzykitty_next(uuid, text) from public;
grant execute on function public.quizzykitty_next(uuid, text) to anon, authenticated;

create or replace function public.quizzykitty_finish(p_room uuid, p_host_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.quizzykitty_is_host(p_room, p_host_key) then raise exception 'NOT_HOST'; end if;
    update public.quizzykitty_rooms
    set status = 'finished', phase = 'reveal', finished_at = now()
    where id = p_room;
    return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.quizzykitty_finish(uuid, text) from public;
grant execute on function public.quizzykitty_finish(uuid, text) to anon, authenticated;

-- Host or a joined student reads the room. Students get the current question
-- without answer/accept, plus the correct text once the teacher reveals.
create or replace function public.quizzykitty_state(
    p_room uuid,
    p_client_id text,
    p_host_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.quizzykitty_rooms;
    v_host boolean;
    v_player public.quizzykitty_players;
    v_question jsonb;
    v_questions jsonb;
    v_total int;
    v_players jsonb;
    v_counts jsonb;
    v_answer jsonb;
    v_correct text;
begin
    select * into v_room from public.quizzykitty_rooms where id = p_room;
    if v_room.id is null then return null; end if;

    v_host := public.quizzykitty_is_host(p_room, p_host_key);
    if not v_host then
        select * into v_player
        from public.quizzykitty_players
        where room_id = p_room and client_id = trim(coalesce(p_client_id, ''));
        if v_player.client_id is null then raise exception 'NOT_IN_ROOM'; end if;
        update public.quizzykitty_players
        set last_seen = now()
        where room_id = p_room and client_id = v_player.client_id;
    end if;

    v_questions := v_room.questions;
    v_total := jsonb_array_length(v_questions);
    if v_room.status = 'playing' and v_room.q_index < v_total then
        v_question := v_questions -> v_room.q_index;
        if not v_host then
            v_question := v_question - 'answer' - 'accept';
            if v_room.phase = 'reveal' then
                if (v_questions -> v_room.q_index ->> 'type') in ('mc', 'gap') then
                    v_correct := (v_questions -> v_room.q_index -> 'choices')
                        ->> ((v_questions -> v_room.q_index ->> 'answer')::int);
                elsif (v_questions -> v_room.q_index ->> 'type') = 'tf' then
                    v_correct := case when (v_questions -> v_room.q_index ->> 'answer')::boolean
                                      then 'True' else 'False' end;
                else
                    v_correct := coalesce((v_questions -> v_room.q_index -> 'accept') ->> 0, '');
                end if;
                v_question := v_question || jsonb_build_object('correct_text', coalesce(v_correct, ''));
            end if;
        end if;
    else
        v_question := null;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'client_id', p.client_id,
        'nickname', p.nickname,
        'cat', p.cat,
        'look', p.look,
        'score', p.score,
        'correct', p.correct,
        'answered', exists (
            select 1 from public.quizzykitty_answers a
            where a.room_id = p.room_id and a.client_id = p.client_id
              and a.q_index = v_room.q_index
        )
    ) order by p.score desc, p.joined_at asc), '[]'::jsonb)
    into v_players
    from public.quizzykitty_players p
    where p.room_id = p_room;

    select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
    into v_counts
    from (
        select coalesce(answer ->> 'v', '') as k, count(*) as n
        from public.quizzykitty_answers
        where room_id = p_room and q_index = v_room.q_index
        group by 1
    ) s;

    select to_jsonb(a) into v_answer
    from public.quizzykitty_answers a
    where a.room_id = p_room and a.client_id = v_player.client_id
      and a.q_index = v_room.q_index;

    return jsonb_build_object(
        'room', jsonb_build_object(
            'id', v_room.id,
            'code', v_room.code,
            'status', v_room.status,
            'phase', v_room.phase,
            'q_index', v_room.q_index,
            'seconds', v_room.seconds,
            'question_count', v_total,
            'started_ms', coalesce((extract(epoch from v_room.started_at) * 1000)::bigint, 0),
            'now_ms', (extract(epoch from now()) * 1000)::bigint,
            'host', v_host
        ),
        'question', v_question,
        'players', v_players,
        'counts', v_counts,
        'my_answer', v_answer
    );
end;
$$;
revoke all on function public.quizzykitty_state(uuid, text, text) from public;
grant execute on function public.quizzykitty_state(uuid, text, text) to anon, authenticated;

-- Student answers. The server checks the answer key and keeps the score.
create or replace function public.quizzykitty_submit(
    p_room uuid,
    p_client_id text,
    p_index int,
    p_answer jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.quizzykitty_rooms;
    v_player public.quizzykitty_players;
    v_question jsonb;
    v_ok boolean := false;
    v_ms int;
    v_streak int;
    v_points int := 0;
    v_score int;
    v_existing public.quizzykitty_answers;
begin
    select * into v_room from public.quizzykitty_rooms where id = p_room;
    if v_room.id is null
       or v_room.status <> 'playing'
       or v_room.phase <> 'question'
       or p_index <> v_room.q_index then
        raise exception 'NOT_ACCEPTING';
    end if;

    select * into v_player
    from public.quizzykitty_players
    where room_id = p_room and client_id = trim(coalesce(p_client_id, ''))
    for update;
    if v_player.client_id is null then raise exception 'NOT_IN_ROOM'; end if;

    select * into v_existing
    from public.quizzykitty_answers
    where room_id = p_room and client_id = v_player.client_id and q_index = p_index;
    if v_existing.client_id is not null then
        return jsonb_build_object(
            'correct', v_existing.correct,
            'points', v_existing.points,
            'score', v_player.score
        );
    end if;

    v_question := v_room.questions -> p_index;
    v_ms := greatest(0, least(
        v_room.seconds * 1000,
        round(extract(epoch from (now() - v_room.started_at)) * 1000)::int
    ));

    if (v_question ->> 'type') in ('mc', 'gap') then
        v_ok := (p_answer ->> 'v')::int = (v_question ->> 'answer')::int;
    elsif (v_question ->> 'type') = 'tf' then
        v_ok := (p_answer ->> 'v')::boolean = (v_question ->> 'answer')::boolean;
    else
        v_ok := exists (
            select 1
            from jsonb_array_elements_text(coalesce(v_question -> 'accept', '[]'::jsonb)) t
            where public.qz_norm(t) = public.qz_norm(coalesce(p_answer ->> 'v', ''))
        );
    end if;

    if v_ok then
        v_streak := v_player.streak + 1;
        v_points := 500
            + round(500 * (1 - v_ms::numeric / (v_room.seconds * 1000)))::int
            + least(200, (v_streak - 1) * 50);
    else
        v_streak := 0;
        v_points := 0;
    end if;

    insert into public.quizzykitty_answers (room_id, client_id, q_index, answer, correct, ms, points)
    values (p_room, v_player.client_id, p_index, p_answer, v_ok, v_ms, v_points)
    on conflict (room_id, client_id, q_index) do nothing;

    update public.quizzykitty_players
    set score = score + v_points,
        correct = correct + case when v_ok then 1 else 0 end,
        streak = v_streak,
        last_seen = now()
    where room_id = p_room and client_id = v_player.client_id
    returning score into v_score;

    return jsonb_build_object('correct', v_ok, 'points', v_points, 'score', v_score);
end;
$$;
revoke all on function public.quizzykitty_submit(uuid, text, int, jsonb) from public;
grant execute on function public.quizzykitty_submit(uuid, text, int, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
