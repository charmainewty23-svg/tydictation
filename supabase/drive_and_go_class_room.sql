-- LearniTY — Drive & Go! teacher class room (30 students + the teacher).
-- Run once in the Supabase SQL editor of the live project. Safe to re-run.
--
-- The room has 31 seats: 30 students plus the host/teacher. Existing rooms
-- default to 5 players. The new create_drive_and_go_class_room() RPC is
-- teacher-only and sets max_players = 31. join / start now use the room's own
-- max_players, so old 5-player rooms keep working.

alter table public.drive_and_go_rooms
    add column if not exists max_players int not null default 5;

-- ---------- join: use the room's cap instead of hardcoded 5 ----------
create or replace function public.join_drive_and_go_room(
    p_code text,
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null
) returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room    public.drive_and_go_rooms;
    v_member  boolean;
    v_count   int;
    v_email   text := coalesce(auth.jwt() ->> 'email', '');
    v_nick    text;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
      from public.drive_and_go_rooms
     where code = upper(trim(p_code))
     for update;

    if v_room.id is null then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    select exists (
        select 1 from public.drive_and_go_players p
        where p.room_id = v_room.id and p.user_id = auth.uid()
    ) into v_member;

    if not v_member and v_room.status <> 'waiting' then
        -- Class rooms (max_players > 5) let a late student join a race that is
        -- already playing. Normal 5-player rooms keep the old behaviour.
        if not (v_room.status = 'playing' and coalesce(v_room.max_players, 5) > 5) then
            raise exception 'ROOM_ALREADY_STARTED';
        end if;
    end if;

    select count(distinct p.user_id) into v_count
      from public.drive_and_go_players p
     where p.room_id = v_room.id;

    if not v_member and v_count >= coalesce(v_room.max_players, 5) then
        raise exception 'ROOM_FULL';
    end if;

    v_nick := coalesce(
        nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
        nullif(split_part(v_email, '@', 1), ''),
        'Player'
    );

    if v_member then
        update public.drive_and_go_players
           set cat = left(coalesce(p_cat, cat, 'Ginger'), 30),
               glasses = left(coalesce(p_glasses, glasses, 'None'), 30),
               hat = left(coalesce(p_hat, hat, 'None'), 30),
               outfit = left(coalesce(p_outfit, outfit, 'None'), 40),
               last_seen = now()
         where room_id = v_room.id and user_id = auth.uid();
    else
        insert into public.drive_and_go_players
            (room_id, user_id, email, nickname, cat, glasses, hat, outfit)
        values
            (v_room.id, auth.uid(), v_email, v_nick,
             left(coalesce(p_cat, 'Ginger'), 30),
             left(coalesce(p_glasses, 'None'), 30),
             left(coalesce(p_hat, 'None'), 30),
             left(coalesce(p_outfit, 'None'), 40));
    end if;

    return next v_room;
end;
$dg$;

-- ---------- start: use the room's cap ----------
create or replace function public.start_drive_and_go_room(p_room_id uuid)
returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room  public.drive_and_go_rooms;
    v_count int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
      from public.drive_and_go_rooms
     where id = p_room_id
     for update;

    if v_room.id is null then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.host_id <> auth.uid() then
        raise exception 'NOT_HOST';
    end if;
    if v_room.status = 'playing' then
        return next v_room;
        return;
    end if;
    if v_room.status = 'finished' then
        raise exception 'ROOM_ALREADY_STARTED';
    end if;

    select count(distinct p.user_id) into v_count
      from public.drive_and_go_players p
     where p.room_id = v_room.id;
    if v_count < 2 then
        raise exception 'START_NEEDS_TWO';
    end if;
    if v_count > coalesce(v_room.max_players, 5) then
        raise exception 'ROOM_FULL';
    end if;

    update public.drive_and_go_rooms
       set status = 'playing', started_at = now()
     where id = v_room.id
     returning * into v_room;

    return next v_room;
end;
$dg$;

-- ---------- teacher-only class room: 30 students + optional teacher seat ----------
-- The old 8-arg version (before p_teacher_plays) is dropped so PostgREST
-- cannot see two overloads with defaults.
drop function if exists public.create_drive_and_go_class_room(text, text, text, text, text, int, text, text);

create or replace function public.create_drive_and_go_class_room(
    p_question_mode text default 'av',
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null,
    p_question_count int default 20,
    p_scene text default 'desert',
    p_topic text default 'tenses',
    p_teacher_plays boolean default true
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
    v_plays  boolean := coalesce(p_teacher_plays, true);
    v_max    int := case when coalesce(p_teacher_plays, true) then 31 else 30 end;
    v_email  text := coalesce(auth.jwt() ->> 'email', '');
    v_nick   text;
    i        int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if not public.is_drive_and_go_teacher() then
        raise exception 'NOT_TEACHER';
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
        (code, host_id, topic, question_mode, question_count, seed, scene, max_players)
    values
        (v_code, auth.uid(), v_topic, v_mode, v_count,
         floor(random() * 2147483646)::bigint + 1, v_scene, v_max)
    returning * into v_room;

    if v_plays then
        insert into public.drive_and_go_players
            (room_id, user_id, email, nickname, cat, glasses, hat, outfit)
        values
            (v_room.id, auth.uid(), v_email, v_nick,
             left(coalesce(p_cat, 'Ginger'), 30),
             left(coalesce(p_glasses, 'None'), 30),
             left(coalesce(p_hat, 'None'), 30),
             left(coalesce(p_outfit, 'None'), 40));
    end if;

    return next v_room;
end;
$dg$;

-- ---------- class-only multiplayer leaderboard ----------
-- player_count is written by the results screen: 30/31 for a class room,
-- 5 for a normal room. 10+ keeps the class board separate.
drop view if exists public.drive_and_go_class_leaderboard;

create view public.drive_and_go_class_leaderboard
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
    plays,
    player_count
from (
    select
        s.*,
        count(*) over (partition by s.user_id, s.topic) as plays,
        row_number() over (
            partition by s.user_id, s.topic
            order by s.composite desc, s.elapsed_ms asc, s.accuracy desc, s.created_at asc
        ) as rn
    from public.drive_and_go_multi_scores s
    where coalesce(s.player_count, 0) >= 10
) ranked
where rn = 1;

grant select on public.drive_and_go_class_leaderboard to anon, authenticated;
