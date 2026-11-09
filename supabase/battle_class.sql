-- ============================================================
-- LearnITY Dictation — Class Battle + battle history fix
-- Run AFTER supabase/battle.sql, in Supabase → SQL Editor.
-- Safe to re-run.
--
-- What this changes:
--   1. battle_rooms gains `mode` ('duel' | 'class'), `max_players`,
--      `finished_at`.
--   2. Finished/abandoned rooms are KEPT (7 days) so the admin dashboard
--      actually has records. Previously leave_battle() deleted them.
--   3. New create_class_battle() / end_class_battle() for the teacher.
-- ============================================================

alter table public.battle_rooms add column if not exists mode text not null default 'duel';
alter table public.battle_rooms add column if not exists max_players int not null default 2;
alter table public.battle_rooms add column if not exists finished_at timestamptz;

-- ---------- membership now also covers class players ----------
-- (a class student has no guest_id, so the old check locked them out
--  of reading the room and of saving their own score)

create or replace function public.is_battle_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.battle_rooms r
        where r.id = p_room_id
          and (r.host_id = auth.uid() or r.guest_id = auth.uid())
    )
    or exists (
        select 1 from public.battle_players p
        where p.room_id = p_room_id and p.user_id = auth.uid()
    );
$$;

drop policy if exists "battle rooms read members" on public.battle_rooms;
create policy "battle rooms read members" on public.battle_rooms
    for select using (
        host_id = auth.uid()
        or guest_id = auth.uid()
        or public.is_battle_member(id)
    );

-- ---------- duel room (unchanged signature, longer retention) ----------

create or replace function public.create_battle(
    p_topic text default '__random__',
    p_seed  bigint default null
) returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_code  text;
    v_room  public.battle_rooms;
    v_try   int := 0;
    i       int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    -- keep 7 days of history for the admin dashboard
    delete from public.battle_rooms where created_at < now() - interval '7 days';

    loop
        v_try := v_try + 1;
        v_code := '';
        for i in 1..4 loop
            v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        end loop;
        begin
            insert into public.battle_rooms (code, topic, seed, host_id, mode, max_players)
            values (
                v_code,
                coalesce(nullif(trim(p_topic), ''), '__random__'),
                coalesce(p_seed, floor(random() * 2000000000)::bigint),
                auth.uid(),
                'duel',
                2
            )
            returning * into v_room;
            exit;
        exception when unique_violation then
            if v_try >= 10 then
                raise exception 'CODE_GENERATION_FAILED';
            end if;
        end;
    end loop;

    insert into public.battle_players (room_id, user_id, email, nickname)
    values (
        v_room.id,
        auth.uid(),
        coalesce(auth.jwt() ->> 'email', ''),
        coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name',
                 split_part(coalesce(auth.jwt() ->> 'email', 'player'), '@', 1))
    );

    return next v_room;
end;
$$;

-- ---------- class room (teacher only) ----------

create or replace function public.create_class_battle(
    p_topic       text   default '__random__',
    p_seed        bigint default null,
    p_max_players int    default 60
) returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_code  text;
    v_room  public.battle_rooms;
    v_try   int := 0;
    i       int;
begin
    if not public.is_teacher() then
        raise exception 'NOT_TEACHER';
    end if;

    delete from public.battle_rooms where created_at < now() - interval '7 days';

    loop
        v_try := v_try + 1;
        v_code := '';
        for i in 1..4 loop
            v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        end loop;
        begin
            insert into public.battle_rooms (code, topic, seed, host_id, status, mode, max_players)
            values (
                v_code,
                coalesce(nullif(trim(p_topic), ''), '__random__'),
                coalesce(p_seed, floor(random() * 2000000000)::bigint),
                auth.uid(),
                'waiting',
                'class',
                greatest(2, least(coalesce(p_max_players, 60), 200))
            )
            returning * into v_room;
            exit;
        exception when unique_violation then
            if v_try >= 10 then
                raise exception 'CODE_GENERATION_FAILED';
            end if;
        end;
    end loop;

    -- the teacher is the host but does NOT play, so no player row is created
    return next v_room;
end;
$$;

-- ---------- join (duel + class) ----------

create or replace function public.join_battle(p_code text)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room  public.battle_rooms;
    v_count int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
    from public.battle_rooms
    where code = upper(trim(p_code))
      and created_at > now() - interval '7 days'
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if v_room.host_id = auth.uid() then
        return next v_room;   -- teacher re-entering their own class room
        return;
    end if;

    if v_room.status <> 'waiting' then
        raise exception 'ROOM_ALREADY_STARTED';
    end if;

    if v_room.mode = 'class' then
        select count(*) into v_count
        from public.battle_players
        where room_id = v_room.id;

        if v_count >= v_room.max_players then
            raise exception 'ROOM_FULL';
        end if;

        insert into public.battle_players (room_id, user_id, email, nickname)
        values (
            v_room.id,
            auth.uid(),
            coalesce(auth.jwt() ->> 'email', ''),
            coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name',
                     split_part(coalesce(auth.jwt() ->> 'email', 'player'), '@', 1))
        )
        on conflict (room_id, user_id) do nothing;

        return next v_room;
        return;
    end if;

    if v_room.guest_id is not null and v_room.guest_id <> auth.uid() then
        raise exception 'ROOM_FULL';
    end if;

    update public.battle_rooms
       set guest_id = auth.uid()
     where id = v_room.id
    returning * into v_room;

    insert into public.battle_players (room_id, user_id, email, nickname)
    values (
        v_room.id,
        auth.uid(),
        coalesce(auth.jwt() ->> 'email', ''),
        coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name',
                 split_part(coalesce(auth.jwt() ->> 'email', 'player'), '@', 1))
    )
    on conflict (room_id, user_id) do nothing;

    return next v_room;
end;
$$;

-- ---------- start (duel needs a guest, class needs >=1 student) ----------

create or replace function public.start_battle(p_room_id uuid)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.battle_rooms;
    v_mode text;
begin
    select mode into v_mode from public.battle_rooms where id = p_room_id;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if v_mode = 'class' then
        update public.battle_rooms
           set status = 'playing', started_at = now()
         where id = p_room_id
           and host_id = auth.uid()
           and mode = 'class'
           and status = 'waiting'
           and exists (select 1 from public.battle_players where room_id = p_room_id)
        returning * into v_room;
    else
        update public.battle_rooms
           set status = 'playing', started_at = now()
         where id = p_room_id
           and host_id = auth.uid()
           and guest_id is not null
           and status = 'waiting'
        returning * into v_room;
    end if;

    if not found then
        raise exception 'CANNOT_START';
    end if;

    update public.battle_players
       set score = 0, correct = 0, total_ms = 0, done = false
     where room_id = p_room_id;

    return next v_room;
end;
$$;

-- ---------- teacher ends a class battle early ----------

create or replace function public.end_class_battle(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.battle_rooms
       set status = 'finished', finished_at = now()
     where id = p_room_id
       and host_id = auth.uid()
       and mode = 'class';

    if not found then
        raise exception 'CANNOT_END';
    end if;
end;
$$;

-- ---------- finish ----------

create or replace function public.finish_battle(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_battle_member(p_room_id) then
        raise exception 'NOT_A_MEMBER';
    end if;

    update public.battle_rooms
       set status = 'finished',
           finished_at = coalesce(finished_at, now())
     where id = p_room_id
       and status = 'playing'
       and not exists (
           select 1 from public.battle_players
           where room_id = p_room_id and done = false
       );
end;
$$;

-- ---------- leave: WAITING rooms are deleted, played rooms are kept ----------

create or replace function public.leave_battle(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.battle_rooms;
begin
    select * into v_room from public.battle_rooms where id = p_room_id;
    if not found then
        return;
    end if;

    if v_room.status = 'waiting' then
        if v_room.host_id = auth.uid() then
            delete from public.battle_rooms where id = p_room_id;
        elsif v_room.guest_id = auth.uid() then
            delete from public.battle_players
             where room_id = p_room_id and user_id = auth.uid();
            update public.battle_rooms
               set guest_id = null, status = 'waiting', started_at = null
             where id = p_room_id;
        elsif v_room.mode = 'class' then
            delete from public.battle_players
             where room_id = p_room_id and user_id = auth.uid();
        end if;
        return;
    end if;

    -- game already started: keep the row so the teacher can see what happened
    if v_room.mode = 'class' then
        update public.battle_players
           set done = true, last_seen = now()
         where room_id = p_room_id and user_id = auth.uid();

        if v_room.host_id = auth.uid() then
            update public.battle_rooms
               set status = 'finished', finished_at = now()
             where id = p_room_id;
        end if;
    else
        update public.battle_rooms
           set status = 'finished', finished_at = coalesce(finished_at, now())
         where id = p_room_id;
    end if;
end;
$$;

revoke all on function public.create_class_battle(text, bigint, int) from anon;
revoke all on function public.end_class_battle(uuid) from anon;
grant execute on function public.create_class_battle(text, bigint, int) to authenticated;
grant execute on function public.end_class_battle(uuid) to authenticated;

-- Check:
-- select code, mode, status, created_at from public.battle_rooms order by created_at desc limit 10;
