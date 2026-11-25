-- QuizzyKitty › Type the word: teacher first-letter hint (live class rooms).
--
-- Paste this in the Supabase SQL editor for project mggnwzirjmibreimrwiq.
-- Agents must NOT run it. Safe to re-run.
--
-- If you already ran quizzykitty_gap_hint.sql, still run THIS file: it
-- replaces the gap-only RPC with Type-the-word behaviour. It is also safe on
-- a fresh project that only has the original quizzykitty.sql.
--
-- Adds rooms.hint_on, a host-only quizzykitty_hint() RPC, resets the flag in
-- start/next, and exposes only the single letter (hint_letter) through
-- quizzykitty_state. Students never receive answer/accept before Reveal.

alter table public.quizzykitty_rooms
    add column if not exists hint_on boolean not null default false;

-- First A-Z letter of a word, uppercased. Mirrors qkFirstLetter() on the
-- client: leading spaces, punctuation and digits are skipped.
create or replace function public.qz_first_letter(p_word text)
returns text
language sql
immutable
as $$
    select upper(substring(coalesce(p_word, '') from '[A-Za-z]'));
$$;
revoke all on function public.qz_first_letter(text) from public;
revoke all on function public.qz_first_letter(text) from anon, authenticated;

-- The official short answer students must type: accept[0]. Returns '' for
-- every other question type (gap and fallback MC included).
create or replace function public.qz_short_answer_word(p_question jsonb)
returns text
language sql
immutable
as $$
    select case
        when p_question is null then ''
        when coalesce(p_question ->> 'type', '') <> 'short' then ''
        when jsonb_typeof(p_question -> 'accept') <> 'array' then ''
        when jsonb_array_length(p_question -> 'accept') = 0 then ''
        else trim(coalesce((p_question -> 'accept') ->> 0, ''))
    end;
$$;
revoke all on function public.qz_short_answer_word(jsonb) from public;
revoke all on function public.qz_short_answer_word(jsonb) from anon, authenticated;

-- Only the single letter is ever returned; never the full answer.
create or replace function public.qz_short_first_letter(p_question jsonb)
returns text
language sql
immutable
as $$
    select coalesce(public.qz_first_letter(public.qz_short_answer_word(p_question)), '');
$$;
revoke all on function public.qz_short_first_letter(jsonb) from public;
revoke all on function public.qz_short_first_letter(jsonb) from anon, authenticated;

-- Starting a room clears any hint from a previous run.
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
        started_at = now(), finished_at = null, hint_on = false
    where id = p_room and status = 'waiting';
    return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.quizzykitty_start(uuid, text) from public;
grant execute on function public.quizzykitty_start(uuid, text) to anon, authenticated;

-- Next question (and the finished path) clears the hint too.
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
        set status = 'finished', finished_at = now(), phase = 'reveal', hint_on = false
        where id = p_room;
        return jsonb_build_object('finished', true, 'q_index', v_next);
    end if;
    update public.quizzykitty_rooms
    set q_index = v_next, phase = 'question', started_at = now(), hint_on = false
    where id = p_room;
    return jsonb_build_object('finished', false, 'q_index', v_next);
end;
$$;
revoke all on function public.quizzykitty_next(uuid, text) from public;
grant execute on function public.quizzykitty_next(uuid, text) to anon, authenticated;

-- Teacher shows the first letter of the current Type-the-word answer.
-- Only valid during the question phase of a real short question; the full
-- answer is never returned. Students only ever see the single letter.
create or replace function public.quizzykitty_hint(p_room uuid, p_host_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.quizzykitty_rooms;
    v_question jsonb;
    v_letter text;
begin
    if not public.quizzykitty_is_host(p_room, p_host_key) then raise exception 'NOT_HOST'; end if;
    select * into v_room from public.quizzykitty_rooms where id = p_room for update;
    if v_room.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
    if v_room.status <> 'playing' or v_room.phase <> 'question' then
        raise exception 'NOT_ACCEPTING';
    end if;
    v_question := v_room.questions -> v_room.q_index;
    if v_question is null or coalesce(v_question ->> 'type', '') <> 'short' then
        raise exception 'NOT_SHORT';
    end if;
    v_letter := public.qz_short_first_letter(v_question);
    if coalesce(v_letter, '') = '' then raise exception 'NOT_SHORT'; end if;
    update public.quizzykitty_rooms
    set hint_on = true
    where id = p_room;
    return jsonb_build_object('ok', true, 'hint_letter', v_letter);
end;
$$;
revoke all on function public.quizzykitty_hint(uuid, text) from public;
grant execute on function public.quizzykitty_hint(uuid, text) to anon, authenticated;

-- Host or a joined student reads the room. Students get the current question
-- without answer/accept, plus the correct text once the teacher reveals.
-- hint_letter is the only extra pre-Reveal information: one uppercase A-Z
-- letter, and only while hint_on is true on an open Type-the-word question.
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
    v_hint text := '';
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

    -- Reveal the first letter only while a Type-the-word question is open and
    -- the teacher has switched the hint on. Never send the full answer here.
    -- The gate is repeated here so an old room with a stale hint_on flag from
    -- a gap question can never leak a letter.
    if v_room.status = 'playing'
       and v_room.phase = 'question'
       and v_room.hint_on
       and v_room.q_index < v_total
       and coalesce((v_questions -> v_room.q_index) ->> 'type', '') = 'short' then
        v_hint := public.qz_short_first_letter(v_questions -> v_room.q_index);
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
            'hint_letter', coalesce(v_hint, ''),
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

-- Leave a clean schema if the earlier gap-only helpers were installed.
drop function if exists public.qz_gap_first_letter(jsonb);
drop function if exists public.qz_gap_answer_word(jsonb);

notify pgrst, 'reload schema';
