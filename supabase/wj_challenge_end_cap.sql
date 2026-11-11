-- ============================================================
-- LearnITY Dictation — Word Jump Challenge: max 4 players +
-- finish when only one climber remains (or the last opponent
-- leaves / disconnects).
--
-- Run in the live project SQL editor (safe to re-run):
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--
-- If you have not installed Challenge rooms yet, paste the whole
-- supabase/wj_challenge.sql instead — it already includes this
-- delta. This short file is enough when that file was already run.
-- Does not clear rooms, match history, or cumulative wins.
-- ============================================================

-- Hard cap: 4 distinct players per room (existing members may rejoin).
alter table public.wj_challenge_rooms
    alter column max_players set default 4;

update public.wj_challenge_rooms
   set max_players = 4
 where max_players is distinct from 4;

alter table public.wj_challenge_rooms
    drop constraint if exists wj_challenge_rooms_max_players_chk;

alter table public.wj_challenge_rooms
    add constraint wj_challenge_rooms_max_players_chk
    check (max_players = 4);

-- Winner clients subscribe to room UPDATEs so the end screen does not
-- depend only on their own heartbeat. Members already have SELECT RLS.
do $wjc$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'wj_challenge_rooms'
       ) then
        execute 'alter publication supabase_realtime add table public.wj_challenge_rooms';
    end if;
end;
$wjc$;

-- Distinct members, including anyone who already left mid-game, occupy a
-- slot. Rejoin of an existing member returns earlier and bypasses this cap.
create or replace function public.join_wj_challenge(p_code text)
returns setof public.wj_challenge_rooms
language plpgsql
security definer
set search_path = public
as $wjc$
declare
    v_room   public.wj_challenge_rooms;
    v_count  int;
    v_member boolean;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
    from public.wj_challenge_rooms
    where code = upper(trim(p_code))
      and created_at > now() - interval '7 days'
    for update;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    v_member := (
        v_room.host_id = auth.uid()
        or exists (
            select 1 from public.wj_challenge_players
             where room_id = v_room.id and user_id = auth.uid()
        )
    );

    if v_member then
        update public.wj_challenge_players
           set left_at = null, last_seen = now()
         where room_id = v_room.id and user_id = auth.uid();
        return next v_room;
        return;
    end if;

    if v_room.status = 'finished' then
        raise exception 'ROOM_FINISHED';
    end if;

    if v_room.status <> 'waiting' and v_room.status <> 'playing' then
        raise exception 'ROOM_ALREADY_STARTED';
    end if;

    select count(*) into v_count
    from public.wj_challenge_players
    where room_id = v_room.id;

    if v_count >= 4 then
        raise exception 'ROOM_FULL';
    end if;

    perform public.wj_challenge_add_player(v_room.id);
    return next v_room;
end;
$wjc$;

revoke all on function public.join_wj_challenge(text) from anon;
grant execute on function public.join_wj_challenge(text) to authenticated;

-- last_standing / all-out / target: same result_reason values as before.
-- Opponents who left, or who have not heartbeated for 10 seconds, count as out
-- so a lone remaining climber (or a disconnect) can finish the match.
create or replace function public.wj_challenge_try_finish(p_room_id uuid)
returns public.wj_challenge_rooms
language plpgsql
as $wjc$
declare
    v_room    public.wj_challenge_rooms;
    v_alive   int;
    v_out     int;
    v_total   int;
    v_winner  uuid;
    v_reason  text;
begin
    select * into v_room from public.wj_challenge_rooms where id = p_room_id for update;
    if not found or v_room.status <> 'playing' then
        return v_room;
    end if;

    select
        count(*) filter (
            where fallen = false
              and left_at is null
              and last_seen > now() - interval '10 seconds'
        ),
        count(*) filter (
            where fallen = true
               or left_at is not null
               or last_seen <= now() - interval '10 seconds'
        ),
        count(*)
      into v_alive, v_out, v_total
      from public.wj_challenge_players
     where room_id = p_room_id;

    if v_total < 2 then
        return v_room;
    end if;

    if v_room.duel_type = 'target_score' then
        select user_id into v_winner
          from public.wj_challenge_players
         where room_id = p_room_id
           and reached_at is not null
         order by reached_at asc, score desc, height desc
         limit 1;

        if v_winner is not null then
            v_reason := 'target';
        elsif v_alive = 0 then
            select user_id into v_winner
              from public.wj_challenge_players
             where room_id = p_room_id
             order by score desc, height desc, last_seen asc
             limit 1;
            v_reason := 'closest';
        end if;
    else
        -- last_standing (default)
        if v_out >= 1 and v_alive <= 1 then
            if v_alive = 1 then
                select user_id into v_winner
                  from public.wj_challenge_players
                 where room_id = p_room_id
                   and fallen = false
                   and left_at is null
                   and last_seen > now() - interval '10 seconds'
                 limit 1;
                v_reason := 'last_standing';
            else
                select user_id into v_winner
                  from public.wj_challenge_players
                 where room_id = p_room_id
                 order by score desc, height desc, last_seen asc
                 limit 1;
                v_reason := 'highest';
            end if;
        end if;
    end if;

    if v_reason is null then
        return v_room;
    end if;

    update public.wj_challenge_rooms
       set status = 'finished',
           finished_at = coalesce(finished_at, now()),
           winner_id = v_winner,
           result_reason = v_reason
     where id = p_room_id
    returning * into v_room;

    return v_room;
end;
$wjc$;

revoke all on function public.wj_challenge_try_finish(uuid) from anon, authenticated;
