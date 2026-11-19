-- PurrStack 1v1 lifetime results + leaderboard
-- Run after supabase/purrstack_battle.sql. Safe to re-run.

create table if not exists public.purrstack_match_results (
  room_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  nickname text,
  opponent_id uuid,
  score int not null default 0 check (score >= 0),
  lines int not null default 0 check (lines >= 0),
  correct int not null default 0 check (correct >= 0),
  won boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.purrstack_match_results enable row level security;

drop policy if exists "purrstack results read all" on public.purrstack_match_results;
create policy "purrstack results read all"
  on public.purrstack_match_results for select
  using (true);

create index if not exists purrstack_results_user_idx
  on public.purrstack_match_results (user_id, won);

-- Keep the original winner logic, and snapshot both players' results once.
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

  insert into public.purrstack_match_results
    (room_id, user_id, email, nickname, opponent_id, score, lines, correct, won, created_at)
  select
    v_room.id,
    p.user_id,
    p.email,
    p.nickname,
    case when p.user_id = v_room.host_id then v_room.guest_id else v_room.host_id end,
    p.score,
    p.lines,
    p.correct,
    (p.user_id = v_winner),
    coalesce(v_room.finished_at, now())
  from public.purrstack_players p
  where p.room_id = p_room
  on conflict (room_id, user_id) do nothing;

  update public.purrstack_rooms
    set status = 'finished', finished_at = now(), winner_id = v_winner
    where id = p_room;
end;
$$;

revoke all on function public.purrstack_finish_room(uuid) from public, anon, authenticated;

-- Backfill finished rooms that are still stored (rooms older than 2 days
-- are deleted, so older results cannot be recovered).
insert into public.purrstack_match_results
  (room_id, user_id, email, nickname, opponent_id, score, lines, correct, won, created_at)
select
  r.id,
  p.user_id,
  p.email,
  p.nickname,
  case when p.user_id = r.host_id then r.guest_id else r.host_id end,
  p.score,
  p.lines,
  p.correct,
  (p.user_id = r.winner_id),
  coalesce(r.finished_at, r.started_at, now())
from public.purrstack_rooms r
join public.purrstack_players p on p.room_id = r.id
where r.status = 'finished' and r.winner_id is not null
on conflict (room_id, user_id) do nothing;

create or replace view public.purrstack_battle_leaderboard
with (security_invoker = true) as
select
  user_id,
  max(nickname) as nickname,
  max(email) as email,
  count(*)::int as matches,
  count(*) filter (where won)::int as wins,
  max(score)::int as best_score,
  sum(lines)::int as lines,
  max(created_at) filter (where won) as last_win_at
from public.purrstack_match_results
group by user_id;

grant select on public.purrstack_battle_leaderboard to anon, authenticated;
