-- ============================================================
-- LearnITY Dictation — Drive & Go! question count + new win rules
-- Run AFTER supabase/drive_and_go.sql, in the live project
-- https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
-- Safe to re-run.
--
-- Adds question_count (20 / 25 / 30 / 35 / 40 / 50, default 20) to
-- drive_and_go_rooms, extends create_drive_and_go_room with
-- p_question_count, stores composite score fields on players, and
-- changes the room finish rule: each racer finishes at N correct;
-- the room ends when every remaining racer has finished (or left);
-- the winner is the highest composite score (tie-break: faster
-- finish, then higher accuracy). The old first-to-4200 m and
-- 3-minute "highest score wins" rules are removed.
--
-- Teachers who already pasted drive_and_go.sql should paste THIS
-- file. A brand-new setup can paste the updated drive_and_go.sql
-- instead. Never run this via a plugin.
-- ============================================================

-- Re-running this file on an existing database will not alter CREATE TABLE,
-- so also add any new columns if they are missing.
alter table public.drive_and_go_rooms
    add column if not exists question_count int not null default 20;
alter table public.drive_and_go_players
    add column if not exists wrong int not null default 0;
alter table public.drive_and_go_players
    add column if not exists composite_score int not null default 0;
alter table public.drive_and_go_players
    add column if not exists elapsed_ms int not null default 0;

do $chk$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'drive_and_go_rooms_question_count_chk'
          and conrelid = 'public.drive_and_go_rooms'::regclass
    ) then
        begin
            alter table public.drive_and_go_rooms
                add constraint drive_and_go_rooms_question_count_chk
                check (question_count in (20, 25, 30, 35, 40, 50));
        exception when others then
            -- Fresh tables already have the same check inline on the column.
            null;
        end;
    end if;
end
$chk$;


drop function if exists public.create_drive_and_go_room(text, text, text, text, text);

create or replace function public.create_drive_and_go_room(
    p_question_mode text default 'av',
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null,
    p_question_count int default 20
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
    v_mode   text := lower(coalesce(p_question_mode, 'av'));
    v_count  int := coalesce(p_question_count, 20);
    v_email  text := coalesce(auth.jwt() ->> 'email', '');
    v_nick   text;
    i        int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if v_mode not in ('av', 'pv', 'mixed') then
        v_mode := 'av';
    end if;
    if v_count not in (20, 25, 30, 35, 40, 50) then
        v_count := 20;
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

    insert into public.drive_and_go_rooms (code, host_id, question_mode, question_count, seed)
    values (v_code, auth.uid(), v_mode, v_count, floor(random() * 2147483646)::bigint + 1)
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


create or replace function public.leave_drive_and_go_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room     public.drive_and_go_rooms;
    v_new_host uuid;
begin
    if auth.uid() is null then
        return;
    end if;

    select * into v_room
      from public.drive_and_go_rooms
     where id = p_room_id
     for update;
    if v_room.id is null then
        return;
    end if;

    delete from public.drive_and_go_players
     where room_id = v_room.id and user_id = auth.uid();

    -- Keep a waiting room alive by handing the host badge to the next player.
    if v_room.host_id = auth.uid() then
        select p.user_id into v_new_host
          from public.drive_and_go_players p
         where p.room_id = v_room.id
         order by p.created_at
         limit 1;
        if v_new_host is null then
            delete from public.drive_and_go_rooms where id = v_room.id;
        else
            update public.drive_and_go_rooms
               set host_id = v_new_host
             where id = v_room.id;
        end if;
    elsif not exists (select 1 from public.drive_and_go_players p where p.room_id = v_room.id)
          and v_room.status = 'waiting' then
        delete from public.drive_and_go_rooms where id = v_room.id;
    end if;

    -- A mid-race leave should end the room once every remaining racer has
    -- reached N correct (or also left).
    if exists (
        select 1 from public.drive_and_go_rooms r
         where r.id = p_room_id and r.status = 'playing'
    ) then
        perform public.maybe_finish_drive_and_go_room(p_room_id);
    end if;
end;
$dg$;

-- Room ends when every remaining racer has finished (N correct) or left.
-- Winner is the highest composite score; tie-break: faster finish, then
-- higher accuracy (correct / (correct + wrong)).
create or replace function public.maybe_finish_drive_and_go_room(p_room_id uuid)
returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room       public.drive_and_go_rooms;
    v_winner     uuid;
    v_remaining  int;
    v_unfinished int;
begin
    select * into v_room
      from public.drive_and_go_rooms
     where id = p_room_id
     for update;

    if v_room.id is null then
        return;
    end if;
    if v_room.status <> 'playing' then
        return next v_room;
        return;
    end if;

    select count(*), count(*) filter (where finished_at is null)
      into v_remaining, v_unfinished
      from public.drive_and_go_players
     where room_id = p_room_id;

    if v_remaining = 0 then
        delete from public.drive_and_go_rooms where id = p_room_id;
        return;
    end if;
    if v_unfinished > 0 then
        return next v_room;
        return;
    end if;

    select p.user_id into v_winner
      from public.drive_and_go_players p
     where p.room_id = v_room.id
     order by p.composite_score desc,
              p.finished_at asc nulls last,
              (p.correct::double precision / nullif(p.correct + p.wrong, 0)) desc nulls last,
              p.score desc,
              p.user_id
     limit 1;

    update public.drive_and_go_rooms
       set status = 'finished',
           winner_id = v_winner,
           result_reason = 'finish',
           finished_at = now()
     where id = v_room.id
     returning * into v_room;

    return next v_room;
end;
$dg$;

create or replace function public.cross_drive_and_go_finish(p_room_id uuid)
returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room public.drive_and_go_rooms;
begin
    if auth.uid() is null or not public.is_drive_and_go_member(p_room_id) then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    update public.drive_and_go_players
       set finished_at = coalesce(finished_at, now()),
           last_seen = now()
     where room_id = p_room_id and user_id = auth.uid();

    return query
        select * from public.maybe_finish_drive_and_go_room(p_room_id);
end;
$dg$;

create or replace function public.time_up_drive_and_go_room(p_room_id uuid)
returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room   public.drive_and_go_rooms;
    v_winner uuid;
begin
    if auth.uid() is null or not public.is_drive_and_go_member(p_room_id) then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
      from public.drive_and_go_rooms
     where id = p_room_id
     for update;

    if v_room.id is null then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    -- The 3-minute "highest score wins" rule has been removed. Rooms now end
    -- when every remaining racer has N correct answers (or has left).
    return next v_room;
end;
$dg$;

revoke all on function public.create_drive_and_go_room(text, text, text, text, text, int) from public, anon;
revoke all on function public.join_drive_and_go_room(text, text, text, text, text) from public, anon;
revoke all on function public.start_drive_and_go_room(uuid) from public, anon;
revoke all on function public.leave_drive_and_go_room(uuid) from public, anon;
revoke all on function public.cross_drive_and_go_finish(uuid) from public, anon;
revoke all on function public.time_up_drive_and_go_room(uuid) from public, anon;
revoke all on function public.apply_drive_and_go_effect(uuid, uuid, text, int) from public, anon;
grant execute on function public.create_drive_and_go_room(text, text, text, text, text, int) to authenticated;
grant execute on function public.join_drive_and_go_room(text, text, text, text, text) to authenticated;
grant execute on function public.start_drive_and_go_room(uuid) to authenticated;
grant execute on function public.leave_drive_and_go_room(uuid) to authenticated;
grant execute on function public.cross_drive_and_go_finish(uuid) to authenticated;
grant execute on function public.time_up_drive_and_go_room(uuid) to authenticated;
grant execute on function public.apply_drive_and_go_effect(uuid, uuid, text, int) to authenticated;
