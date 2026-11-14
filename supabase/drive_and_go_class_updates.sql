-- LearniTY — Drive & Go! class room updates:
--   1. late students may join a class race that is already playing
--   2. Drive & Go! Class leaderboard view (rooms with 10+ players)
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table public.drive_and_go_rooms
    add column if not exists max_players int not null default 5;

-- ---------- join: late join is allowed for class rooms (max_players > 5) ----------
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
