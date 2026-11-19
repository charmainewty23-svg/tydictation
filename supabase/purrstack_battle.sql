-- PurrStack 1v1 battle (3 minutes, garbage lines)
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists public.purrstack_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references auth.users(id) on delete cascade,
  guest_id uuid references auth.users(id) on delete cascade,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'finished')),
  seed bigint not null,
  duration_seconds int not null default 180,
  started_at timestamptz,
  finished_at timestamptz,
  winner_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.purrstack_players (
  room_id uuid not null references public.purrstack_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  nickname text,
  score int not null default 0 check (score >= 0),
  lines int not null default 0 check (lines >= 0),
  correct int not null default 0 check (correct >= 0),
  wrong int not null default 0 check (wrong >= 0),
  garbage_pending int not null default 0 check (garbage_pending >= 0),
  garbage_sent int not null default 0 check (garbage_sent >= 0),
  alive boolean not null default true,
  done boolean not null default false,
  last_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.purrstack_rooms enable row level security;
alter table public.purrstack_players enable row level security;

drop policy if exists "purrstack battle rooms read" on public.purrstack_rooms;
create policy "purrstack battle rooms read"
  on public.purrstack_rooms for select
  using (auth.uid() = host_id or auth.uid() = guest_id);

drop policy if exists "purrstack battle players read" on public.purrstack_players;
create policy "purrstack battle players read"
  on public.purrstack_players for select
  using (
    exists (
      select 1 from public.purrstack_rooms r
      where r.id = room_id and (auth.uid() = r.host_id or auth.uid() = r.guest_id)
    )
  );

create index if not exists purrstack_rooms_code_idx
  on public.purrstack_rooms (code, status);
create index if not exists purrstack_rooms_created_idx
  on public.purrstack_rooms (created_at desc);

create or replace function public.is_purrstack_member(p_room uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.purrstack_rooms r
    where r.id = p_room
      and (r.host_id = auth.uid() or r.guest_id = auth.uid())
  );
$$;

revoke all on function public.is_purrstack_member(uuid) from public, anon;
grant execute on function public.is_purrstack_member(uuid) to authenticated;

create or replace function public.purrstack_room_state(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.purrstack_rooms;
  v_players jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'AUTH'); end if;
  select * into v_room from public.purrstack_rooms where id = p_room;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if auth.uid() <> v_room.host_id and auth.uid() is distinct from v_room.guest_id then
    return jsonb_build_object('error', 'NOT_MEMBER');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id,
    'email', p.email,
    'nickname', p.nickname,
    'score', p.score,
    'lines', p.lines,
    'correct', p.correct,
    'wrong', p.wrong,
    'garbage_pending', p.garbage_pending,
    'garbage_sent', p.garbage_sent,
    'alive', p.alive,
    'done', p.done,
    'last_seen', p.last_seen
  ) order by p.user_id), '[]'::jsonb)
  into v_players
  from public.purrstack_players p
  where p.room_id = p_room;

  return jsonb_build_object(
    'id', v_room.id,
    'code', v_room.code,
    'status', v_room.status,
    'seed', v_room.seed,
    'duration', v_room.duration_seconds,
    'host_id', v_room.host_id,
    'guest_id', v_room.guest_id,
    'started_at', v_room.started_at,
    'finished_at', v_room.finished_at,
    'ends_at', case when v_room.started_at is not null
      then v_room.started_at + make_interval(secs => v_room.duration_seconds) else null end,
    'winner_id', v_room.winner_id,
    'players', v_players
  );
end;
$$;

create or replace function public.purrstack_finish_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.purrstack_rooms;
  v_host public.purrstack_players;
  v_guest public.purrstack_players;
  v_winner uuid;
begin
  select * into v_room from public.purrstack_rooms where id = p_room for update;
  if not found or v_room.status <> 'playing' then return; end if;

  select * into v_host from public.purrstack_players
    where room_id = p_room and user_id = v_room.host_id;
  select * into v_guest from public.purrstack_players
    where room_id = p_room and user_id = v_room.guest_id;

  if v_host is null and v_guest is null then
    v_winner := null;
  elsif v_guest is null then
    v_winner := v_host.user_id;
  elsif v_host is null then
    v_winner := v_guest.user_id;
  elsif not v_host.alive and v_guest.alive then
    v_winner := v_guest.user_id;
  elsif v_host.alive and not v_guest.alive then
    v_winner := v_host.user_id;
  elsif v_host.score <> v_guest.score then
    v_winner := case when v_host.score > v_guest.score then v_host.user_id else v_guest.user_id end;
  elsif v_host.lines <> v_guest.lines then
    v_winner := case when v_host.lines > v_guest.lines then v_host.user_id else v_guest.user_id end;
  elsif v_host.correct <> v_guest.correct then
    v_winner := case when v_host.correct > v_guest.correct then v_host.user_id else v_guest.user_id end;
  else
    v_winner := least(v_host.user_id::text, v_guest.user_id::text)::uuid;
  end if;

  update public.purrstack_rooms
    set status = 'finished', finished_at = now(), winner_id = v_winner
    where id = p_room;
end;
$$;

revoke all on function public.purrstack_finish_room(uuid) from public, anon, authenticated;

create or replace function public.create_purrstack_room()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_seed bigint;
  v_room public.purrstack_rooms;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'AUTH'); end if;

  delete from public.purrstack_rooms
    where created_at < now() - interval '2 days';

  loop
    v_code := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    exit when not exists (
      select 1 from public.purrstack_rooms where code = v_code
    );
  end loop;

  v_seed := floor(random() * 2000000000)::bigint + 1;

  insert into public.purrstack_rooms (code, host_id, seed, status)
    values (v_code, auth.uid(), v_seed, 'waiting')
    returning * into v_room;

  insert into public.purrstack_players (room_id, user_id, email, nickname)
    select v_room.id, u.id, u.email,
           coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
    from auth.users u where u.id = auth.uid()
    on conflict do nothing;

  return public.purrstack_room_state(v_room.id);
end;
$$;

create or replace function public.join_purrstack_room(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.purrstack_rooms;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'AUTH'); end if;

  select * into v_room from public.purrstack_rooms
    where code = btrim(coalesce(p_code, '')) and status <> 'finished'
    order by created_at desc limit 1;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;

  if auth.uid() = v_room.host_id or auth.uid() = v_room.guest_id then
    return public.purrstack_room_state(v_room.id);
  end if;
  if v_room.status <> 'waiting' then
    return jsonb_build_object('error', 'ROOM_ALREADY_STARTED');
  end if;
  if v_room.guest_id is not null then
    return jsonb_build_object('error', 'ROOM_FULL');
  end if;

  update public.purrstack_rooms set guest_id = auth.uid()
    where id = v_room.id returning * into v_room;

  insert into public.purrstack_players (room_id, user_id, email, nickname)
    select v_room.id, u.id, u.email,
           coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
    from auth.users u where u.id = auth.uid()
    on conflict do nothing;

  return public.purrstack_room_state(v_room.id);
end;
$$;

create or replace function public.start_purrstack_room(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.purrstack_rooms;
begin
  select * into v_room from public.purrstack_rooms where id = p_room;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if auth.uid() <> v_room.host_id then return jsonb_build_object('error', 'NOT_HOST'); end if;
  if v_room.guest_id is null then return jsonb_build_object('error', 'WAITING_GUEST'); end if;

  if v_room.status = 'playing' then
    return public.purrstack_room_state(p_room);
  end if;

  update public.purrstack_rooms
    set status = 'playing', started_at = now(), finished_at = null, winner_id = null
    where id = p_room;

  update public.purrstack_players
    set score = 0, lines = 0, correct = 0, wrong = 0,
        garbage_pending = 0, garbage_sent = 0,
        alive = true, done = false,
        last_seen = now(), updated_at = now()
    where room_id = p_room;

  return public.purrstack_room_state(p_room);
end;
$$;

create or replace function public.purrstack_send_garbage(p_room uuid, p_lines int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.purrstack_rooms;
  v_to uuid;
  v_lines int;
begin
  select * into v_room from public.purrstack_rooms where id = p_room;
  if not found or v_room.status <> 'playing' then return; end if;
  if auth.uid() = v_room.host_id then
    v_to := v_room.guest_id;
  elsif auth.uid() = v_room.guest_id then
    v_to := v_room.host_id;
  else
    return;
  end if;
  if v_to is null then return; end if;

  v_lines := greatest(0, least(20, coalesce(p_lines, 0)));
  if v_lines = 0 then return; end if;

  update public.purrstack_players
    set garbage_pending = garbage_pending + v_lines, updated_at = now()
    where room_id = p_room and user_id = v_to;

  update public.purrstack_players
    set garbage_sent = garbage_sent + v_lines, updated_at = now()
    where room_id = p_room and user_id = auth.uid();
end;
$$;

create or replace function public.purrstack_ack_garbage(p_room uuid, p_count int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_purrstack_member(p_room) then return; end if;
  update public.purrstack_players
    set garbage_pending = greatest(0, garbage_pending - greatest(0, least(50, coalesce(p_count, 0)))),
        updated_at = now()
    where room_id = p_room and user_id = auth.uid();
end;
$$;

create or replace function public.purrstack_report(
  p_room uuid,
  p_score int,
  p_lines int,
  p_correct int,
  p_wrong int,
  p_alive boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.purrstack_rooms;
begin
  select * into v_room from public.purrstack_rooms where id = p_room;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if auth.uid() <> v_room.host_id and auth.uid() is distinct from v_room.guest_id then
    return jsonb_build_object('error', 'NOT_MEMBER');
  end if;

  update public.purrstack_players
    set score = greatest(0, coalesce(p_score, 0)),
        lines = greatest(0, coalesce(p_lines, 0)),
        correct = greatest(0, coalesce(p_correct, 0)),
        wrong = greatest(0, coalesce(p_wrong, 0)),
        alive = coalesce(p_alive, true),
        done = not coalesce(p_alive, true),
        last_seen = now(),
        updated_at = now()
    where room_id = p_room and user_id = auth.uid();

  if v_room.status = 'playing' then
    if not coalesce(p_alive, true)
       or (v_room.started_at is not null
           and now() >= v_room.started_at + make_interval(secs => v_room.duration_seconds)) then
      perform public.purrstack_finish_room(p_room);
    end if;
  end if;

  return public.purrstack_room_state(p_room);
end;
$$;

create or replace function public.purrstack_finish(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_purrstack_member(p_room) then
    return jsonb_build_object('error', 'NOT_MEMBER');
  end if;
  perform public.purrstack_finish_room(p_room);
  return public.purrstack_room_state(p_room);
end;
$$;

create or replace function public.purrstack_leave(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.purrstack_rooms;
begin
  select * into v_room from public.purrstack_rooms where id = p_room;
  if not found then return; end if;

  if auth.uid() = v_room.host_id then
    if v_room.status = 'waiting' then
      delete from public.purrstack_rooms where id = p_room;
      return;
    end if;
    update public.purrstack_players
      set alive = false, done = true, last_seen = now(), updated_at = now()
      where room_id = p_room and user_id = auth.uid();
    perform public.purrstack_finish_room(p_room);
    return;
  end if;

  if auth.uid() = v_room.guest_id then
    if v_room.status = 'waiting' then
      update public.purrstack_rooms set guest_id = null where id = p_room;
      delete from public.purrstack_players
        where room_id = p_room and user_id = auth.uid();
      return;
    end if;
    update public.purrstack_players
      set alive = false, done = true, last_seen = now(), updated_at = now()
      where room_id = p_room and user_id = auth.uid();
    perform public.purrstack_finish_room(p_room);
  end if;
end;
$$;

create or replace function public.purrstack_rematch(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.purrstack_rooms;
begin
  select * into v_room from public.purrstack_rooms where id = p_room;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if auth.uid() <> v_room.host_id then return jsonb_build_object('error', 'NOT_HOST'); end if;
  if v_room.guest_id is null then return jsonb_build_object('error', 'WAITING_GUEST'); end if;

  update public.purrstack_rooms
    set status = 'playing',
        seed = floor(random() * 2000000000)::bigint + 1,
        started_at = now(),
        finished_at = null,
        winner_id = null
    where id = p_room;

  update public.purrstack_players
    set score = 0, lines = 0, correct = 0, wrong = 0,
        garbage_pending = 0, garbage_sent = 0,
        alive = true, done = false,
        last_seen = now(), updated_at = now()
    where room_id = p_room;

  return public.purrstack_room_state(p_room);
end;
$$;

revoke all on function public.create_purrstack_room() from public, anon;
revoke all on function public.join_purrstack_room(text) from public, anon;
revoke all on function public.start_purrstack_room(uuid) from public, anon;
revoke all on function public.purrstack_room_state(uuid) from public, anon;
revoke all on function public.purrstack_send_garbage(uuid, int) from public, anon;
revoke all on function public.purrstack_ack_garbage(uuid, int) from public, anon;
revoke all on function public.purrstack_report(uuid, int, int, int, int, boolean) from public, anon;
revoke all on function public.purrstack_finish(uuid) from public, anon;
revoke all on function public.purrstack_leave(uuid) from public, anon;
revoke all on function public.purrstack_rematch(uuid) from public, anon;

grant execute on function public.create_purrstack_room() to authenticated;
grant execute on function public.join_purrstack_room(text) to authenticated;
grant execute on function public.start_purrstack_room(uuid) to authenticated;
grant execute on function public.purrstack_room_state(uuid) to authenticated;
grant execute on function public.purrstack_send_garbage(uuid, int) to authenticated;
grant execute on function public.purrstack_ack_garbage(uuid, int) to authenticated;
grant execute on function public.purrstack_report(uuid, int, int, int, int, boolean) to authenticated;
grant execute on function public.purrstack_finish(uuid) to authenticated;
grant execute on function public.purrstack_leave(uuid) to authenticated;
grant execute on function public.purrstack_rematch(uuid) to authenticated;
