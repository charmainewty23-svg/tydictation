-- ============================================================
-- LearnITY Dictation — Word Battle (1 v 1 rooms)
-- Run once in Supabase → SQL Editor (project mggnwzirjmibreimrwiq)
-- Safe to re-run.
-- ============================================================

create table if not exists public.battle_rooms (
    id             uuid primary key default gen_random_uuid(),
    code           text not null unique,
    topic          text not null default '__random__',
    seed           bigint not null,
    question_count int not null default 10,
    host_id        uuid not null references auth.users(id) on delete cascade,
    guest_id       uuid references auth.users(id) on delete set null,
    status         text not null default 'waiting'
                   check (status in ('waiting', 'playing', 'finished')),
    started_at     timestamptz,
    created_at     timestamptz not null default now()
);

create table if not exists public.battle_players (
    room_id     uuid not null references public.battle_rooms(id) on delete cascade,
    user_id     uuid not null references auth.users(id) on delete cascade,
    email       text,
    nickname    text,
    score       int not null default 0,
    correct     int not null default 0,
    total_ms    int not null default 0,
    done        boolean not null default false,
    last_seen   timestamptz not null default now(),
    primary key (room_id, user_id)
);

create index if not exists battle_rooms_created_idx on public.battle_rooms (created_at desc);
create index if not exists battle_players_room_idx on public.battle_players (room_id);

-- ---------- helpers ----------

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
    );
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
as $$
    select coalesce(auth.jwt() ->> 'email', '') = 'tywong@lstyoungkhl.edu.hk';
$$;

-- ---------- RLS ----------

alter table public.battle_rooms   enable row level security;
alter table public.battle_players enable row level security;

drop policy if exists "battle rooms read members"  on public.battle_rooms;
drop policy if exists "battle rooms read teacher"  on public.battle_rooms;
drop policy if exists "battle players read members" on public.battle_players;
drop policy if exists "battle players read teacher" on public.battle_players;
drop policy if exists "battle players update own"   on public.battle_players;

create policy "battle rooms read members" on public.battle_rooms
    for select using (host_id = auth.uid() or guest_id = auth.uid());

create policy "battle rooms read teacher" on public.battle_rooms
    for select using (public.is_teacher());

create policy "battle players read members" on public.battle_players
    for select using (public.is_battle_member(room_id));

create policy "battle players read teacher" on public.battle_players
    for select using (public.is_teacher());

-- a student may only write their own row, and only inside their own room
create policy "battle players update own" on public.battle_players
    for update
    using (user_id = auth.uid() and public.is_battle_member(room_id))
    with check (user_id = auth.uid() and public.is_battle_member(room_id));

grant select on public.battle_rooms   to authenticated;
grant select, update on public.battle_players to authenticated;

-- ---------- room lifecycle ----------

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

    -- housekeeping: rooms older than 6 hours are dead
    delete from public.battle_rooms where created_at < now() - interval '6 hours';

    loop
        v_try := v_try + 1;
        v_code := '';
        for i in 1..4 loop
            v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        end loop;
        begin
            insert into public.battle_rooms (code, topic, seed, host_id)
            values (
                v_code,
                coalesce(nullif(trim(p_topic), ''), '__random__'),
                coalesce(p_seed, floor(random() * 2000000000)::bigint),
                auth.uid()
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

create or replace function public.join_battle(p_code text)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.battle_rooms;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
    from public.battle_rooms
    where code = upper(trim(p_code))
      and created_at > now() - interval '6 hours'
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if v_room.host_id = auth.uid() then
        return next v_room;   -- re-entering your own room
        return;
    end if;

    if v_room.status <> 'waiting' then
        raise exception 'ROOM_ALREADY_STARTED';
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

create or replace function public.start_battle(p_room_id uuid)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.battle_rooms;
begin
    update public.battle_rooms
       set status = 'playing', started_at = now()
     where id = p_room_id
       and host_id = auth.uid()
       and guest_id is not null
       and status = 'waiting'
    returning * into v_room;

    if not found then
        raise exception 'CANNOT_START';
    end if;

    update public.battle_players
       set score = 0, correct = 0, total_ms = 0, done = false
     where room_id = p_room_id;

    return next v_room;
end;
$$;

create or replace function public.rematch_battle(p_room_id uuid, p_seed bigint)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room public.battle_rooms;
begin
    update public.battle_rooms
       set status = 'playing', seed = p_seed, started_at = now()
     where id = p_room_id
       and host_id = auth.uid()
       and guest_id is not null
    returning * into v_room;

    if not found then
        raise exception 'CANNOT_START';
    end if;

    update public.battle_players
       set score = 0, correct = 0, total_ms = 0, done = false
     where room_id = p_room_id;

    return next v_room;
end;
$$;

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
       set status = 'finished'
     where id = p_room_id
       and status = 'playing'
       and not exists (
           select 1 from public.battle_players
           where room_id = p_room_id and done = false
       );
end;
$$;

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

    if v_room.host_id = auth.uid() then
        delete from public.battle_rooms where id = p_room_id;
    elsif v_room.guest_id = auth.uid() then
        delete from public.battle_players
         where room_id = p_room_id and user_id = auth.uid();
        update public.battle_rooms
           set guest_id = null, status = 'waiting', started_at = null
         where id = p_room_id;
    end if;
end;
$$;

revoke all on function public.create_battle(text, bigint) from anon;
revoke all on function public.join_battle(text) from anon;
revoke all on function public.start_battle(uuid) from anon;
revoke all on function public.rematch_battle(uuid, bigint) from anon;
revoke all on function public.finish_battle(uuid) from anon;
revoke all on function public.leave_battle(uuid) from anon;

grant execute on function public.create_battle(text, bigint) to authenticated;
grant execute on function public.join_battle(text) to authenticated;
grant execute on function public.start_battle(uuid) to authenticated;
grant execute on function public.rematch_battle(uuid, bigint) to authenticated;
grant execute on function public.finish_battle(uuid) to authenticated;
grant execute on function public.leave_battle(uuid) to authenticated;

-- Quick check afterwards:
-- select code, topic, status, created_at from public.battle_rooms order by created_at desc;
