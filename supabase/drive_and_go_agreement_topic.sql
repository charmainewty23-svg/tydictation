-- ============================================================
-- LearniTY Dictation — Drive & Go! Agreement topic (incremental)
--
-- Run in the LIVE project SQL Editor:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--
-- Safe to re-run. This is an ADD-ON for teachers who already have Drive & Go!
-- (including scenes / boards / question counts). Do NOT paste the older
-- Drive & Go! incrementals again for this change:
--   * drive_and_go.sql
--   * drive_and_go_question_count.sql
--   * drive_and_go_scenes_and_boards.sql
--   * guest_tracking_prune.sql
--   (or any other older file)
--
-- It adds:
--   * topic ('tenses' / 'agreement') on rooms and both score tables
--   * the wider question_mode / bank_mode checks (adds gapfill / choose)
--   * create_drive_and_go_room(..., p_topic) as an 8-argument function
--     (the old 7-argument function is dropped first; p_topic defaults to
--     'tenses', so existing Tenses calls still work)
--   * both leaderboard views with a topic column and one personal best per
--     (user_id, topic), so Tenses and Agreement do not hide each other
--
-- Never run this via a plugin / CLI / agent. The teacher pastes it herself.
-- ============================================================

-- ---------- topic column ----------

alter table public.drive_and_go_rooms
    add column if not exists topic text not null default 'tenses';

alter table public.drive_and_go_solo_scores
    add column if not exists topic text not null default 'tenses';

alter table public.drive_and_go_multi_scores
    add column if not exists topic text not null default 'tenses';

-- ---------- widen question_mode / bank_mode checks ----------
-- Look the constraint up by its definition instead of assuming one inline
-- name (fresh installs and older incrementals named them differently).

do $chk$
declare
    r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.drive_and_go_rooms'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%question_mode%'
    loop
        execute format('alter table public.drive_and_go_rooms drop constraint %I', r.conname);
    end loop;

    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.drive_and_go_solo_scores'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%bank_mode%'
    loop
        execute format('alter table public.drive_and_go_solo_scores drop constraint %I', r.conname);
    end loop;

    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.drive_and_go_multi_scores'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%bank_mode%'
    loop
        execute format('alter table public.drive_and_go_multi_scores drop constraint %I', r.conname);
    end loop;
end
$chk$;

alter table public.drive_and_go_rooms
    drop constraint if exists drive_and_go_rooms_question_mode_chk;
alter table public.drive_and_go_rooms
    add constraint drive_and_go_rooms_question_mode_chk
    check (question_mode in ('av', 'pv', 'mixed', 'gapfill', 'choose'));

alter table public.drive_and_go_solo_scores
    drop constraint if exists drive_and_go_solo_scores_bank_mode_chk;
alter table public.drive_and_go_solo_scores
    add constraint drive_and_go_solo_scores_bank_mode_chk
    check (bank_mode in ('av', 'pv', 'mixed', 'gapfill', 'choose'));

alter table public.drive_and_go_multi_scores
    drop constraint if exists drive_and_go_multi_scores_bank_mode_chk;
alter table public.drive_and_go_multi_scores
    add constraint drive_and_go_multi_scores_bank_mode_chk
    check (bank_mode in ('av', 'pv', 'mixed', 'gapfill', 'choose'));

-- ---------- topic checks ----------

alter table public.drive_and_go_rooms
    drop constraint if exists drive_and_go_rooms_topic_chk;
alter table public.drive_and_go_rooms
    add constraint drive_and_go_rooms_topic_chk
    check (topic in ('tenses', 'agreement'));

alter table public.drive_and_go_solo_scores
    drop constraint if exists drive_and_go_solo_scores_topic_chk;
alter table public.drive_and_go_solo_scores
    add constraint drive_and_go_solo_scores_topic_chk
    check (topic in ('tenses', 'agreement'));

alter table public.drive_and_go_multi_scores
    drop constraint if exists drive_and_go_multi_scores_topic_chk;
alter table public.drive_and_go_multi_scores
    add constraint drive_and_go_multi_scores_topic_chk
    check (topic in ('tenses', 'agreement'));

-- ---------- create_drive_and_go_room(..., p_topic) ----------
-- CREATE OR REPLACE with an extra argument would create an overload and leave
-- the old 7-argument function in place. Drop the old signature first, then
-- create the 8-argument one with a default so existing 7-argument Tenses
-- calls still succeed.

drop function if exists public.create_drive_and_go_room(text, text, text, text, text, int, text);

create or replace function public.create_drive_and_go_room(
    p_question_mode text default 'av',
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null,
    p_question_count int default 20,
    p_scene text default 'desert',
    p_topic text default 'tenses'
) returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_code   text;
    v_room   public.drive_and_go_rooms;
    v_try    int := 0;
    v_topic  text := lower(coalesce(p_topic, 'tenses'));
    v_mode   text := lower(coalesce(p_question_mode, 'av'));
    v_count  int := coalesce(p_question_count, 20);
    v_scene  text := lower(coalesce(p_scene, 'desert'));
    v_email  text := coalesce(auth.jwt() ->> 'email', '');
    v_nick   text;
    i        int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if v_topic not in ('tenses', 'agreement') then
        v_topic := 'tenses';
    end if;
    if v_topic = 'agreement' then
        if v_mode not in ('gapfill', 'choose', 'mixed') then
            v_mode := 'gapfill';
        end if;
    else
        if v_mode not in ('av', 'pv', 'mixed') then
            v_mode := 'av';
        end if;
    end if;
    if v_count not in (20, 25, 30, 35, 40, 50) then
        v_count := 20;
    end if;
    if v_scene not in ('desert', 'stadium', 'jungle') then
        v_scene := 'desert';
    end if;

    -- Housekeeping: abandoned rooms are dead after 12 hours.
    delete from public.drive_and_go_rooms
     where created_at < now() - interval '12 hours';

    v_nick := coalesce(
        nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
        nullif(split_part(v_email, '@', 1), ''),
        'Player'
    );

    loop
        v_try := v_try + 1;
        v_code := '';
        for i in 1..4 loop
            v_code := v_code || substr(v_chars, floor(random() * length(v_chars))::int + 1, 1);
        end loop;
        exit when not exists (select 1 from public.drive_and_go_rooms r where r.code = v_code);
        if v_try > 40 then
            raise exception 'CODE_GENERATION_FAILED';
        end if;
    end loop;

    insert into public.drive_and_go_rooms
        (code, host_id, topic, question_mode, question_count, seed, scene)
    values
        (v_code, auth.uid(), v_topic, v_mode, v_count,
         floor(random() * 2147483646)::bigint + 1, v_scene)
    returning * into v_room;

    insert into public.drive_and_go_players
        (room_id, user_id, email, nickname, cat, glasses, hat, outfit)
    values
        (v_room.id, auth.uid(), v_email, v_nick,
         left(coalesce(p_cat, 'Ginger'), 30),
         left(coalesce(p_glasses, 'None'), 30),
         left(coalesce(p_hat, 'None'), 30),
         left(coalesce(p_outfit, 'None'), 40));

    return next v_room;
end;
$dg$;

revoke all on function public.create_drive_and_go_room(text, text, text, text, text, int, text, text) from public, anon;
grant execute on function public.create_drive_and_go_room(text, text, text, text, text, int, text, text) to authenticated;

-- ---------- Solo leaderboard view (one PB per user + topic) ----------

drop view if exists public.drive_and_go_solo_leaderboard;

create view public.drive_and_go_solo_leaderboard
with (security_invoker = true)
as
select
    user_id,
    email,
    nickname,
    topic,
    bank_mode,
    question_count,
    scene,
    composite,
    race_score,
    time_bonus,
    correct,
    wrong,
    accuracy,
    elapsed_ms,
    created_at,
    plays
from (
    select
        s.*,
        count(*) over (partition by s.user_id, s.topic) as plays,
        row_number() over (
            partition by s.user_id, s.topic
            order by s.composite desc, s.elapsed_ms asc, s.accuracy desc, s.created_at asc
        ) as rn
    from public.drive_and_go_solo_scores s
) ranked
where rn = 1;

grant select on public.drive_and_go_solo_leaderboard to anon, authenticated;

-- ---------- Multiplayer leaderboard view (one PB per user + topic) ----------

drop view if exists public.drive_and_go_multi_leaderboard;

create view public.drive_and_go_multi_leaderboard
with (security_invoker = true)
as
select
    user_id,
    email,
    nickname,
    topic,
    bank_mode,
    question_count,
    scene,
    composite,
    race_score,
    time_bonus,
    correct,
    wrong,
    accuracy,
    elapsed_ms,
    created_at,
    plays
from (
    select
        s.*,
        count(*) over (partition by s.user_id, s.topic) as plays,
        row_number() over (
            partition by s.user_id, s.topic
            order by s.composite desc, s.elapsed_ms asc, s.accuracy desc, s.created_at asc
        ) as rn
    from public.drive_and_go_multi_scores s
) ranked
where rn = 1;

grant select on public.drive_and_go_multi_leaderboard to anon, authenticated;

-- Ask PostgREST to pick up the new column / function signature immediately.
notify pgrst, 'reload schema';

-- Check it worked:
-- select nickname, topic, bank_mode, composite, elapsed_ms, accuracy, plays
-- from public.drive_and_go_solo_leaderboard
-- order by topic, composite desc limit 10;
