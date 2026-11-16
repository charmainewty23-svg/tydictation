-- LearniTY Drive & Go!: host can end a class battle early.
-- The room is marked finished, the current standings decide the winner, and
-- the normal results screen + kart trophy take over.
-- Run after drive_and_go.sql / drive_and_go_class_room.sql. Safe to re-run.

create or replace function public.end_drive_and_go_room(p_room_id uuid)
returns setof public.drive_and_go_rooms
language plpgsql
security definer
set search_path = public
as $dg$
declare
    v_room   public.drive_and_go_rooms;
    v_winner uuid;
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
    if v_room.status = 'finished' then
        return next v_room;
        return;
    end if;
    if v_room.status <> 'playing' then
        raise exception 'ROOM_NOT_PLAYING';
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
           result_reason = 'time',
           finished_at = now()
     where id = v_room.id
     returning * into v_room;

    return next v_room;
end;
$dg$;

revoke all on function public.end_drive_and_go_room(uuid) from public, anon;
grant execute on function public.end_drive_and_go_room(uuid) to authenticated;

notify pgrst, 'reload schema';
