-- Word Battle: let a student or the teacher rejoin a room they already belong to,
-- even after the battle has started. Safe to re-run.
-- Run after supabase/battle_question_count.sql (and the earlier battle series).
-- Live project: mggnwzirjmibreimrwiq

-- ---------- join_battle: existing members can come back ----------
create or replace function public.join_battle(p_code text)
returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room  public.battle_rooms;
    v_count int;
    v_member boolean;
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

    v_member := (
        v_room.host_id = auth.uid()
        or v_room.guest_id = auth.uid()
        or exists (
            select 1 from public.battle_players
             where room_id = v_room.id and user_id = auth.uid()
        )
    );

    -- Already in this room (host, guest, or student): let them back in,
    -- including mid-battle and the results screen. If they were marked done
    -- only because they left early, clear that flag so they can continue.
    if v_member then
        if v_room.status = 'playing' then
            update public.battle_players
               set done = false, last_seen = now()
             where room_id = v_room.id
               and user_id = auth.uid()
               and done = true
               and coalesce(progress, 0) < coalesce(v_room.question_count, 10);
        end if;
        return next v_room;
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

-- ---------- rejoin by saved room id (or code) ----------
create or replace function public.rejoin_battle(p_room_id uuid default null, p_code text default null)
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

    if p_room_id is not null then
        select * into v_room
        from public.battle_rooms
        where id = p_room_id
          and created_at > now() - interval '7 days'
        for update;
    elsif p_code is not null and length(trim(p_code)) > 0 then
        select * into v_room
        from public.battle_rooms
        where code = upper(trim(p_code))
          and created_at > now() - interval '7 days'
        for update;
    end if;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if not (
        v_room.host_id = auth.uid()
        or v_room.guest_id = auth.uid()
        or exists (
            select 1 from public.battle_players
             where room_id = v_room.id and user_id = auth.uid()
        )
    ) then
        raise exception 'NOT_A_MEMBER';
    end if;

    if v_room.status = 'playing' then
        update public.battle_players
           set done = false, last_seen = now()
         where room_id = v_room.id
           and user_id = auth.uid()
           and done = true
           and coalesce(progress, 0) < coalesce(v_room.question_count, 10);
    end if;

    return next v_room;
end;
$$;

revoke all on function public.join_battle(text) from anon;
revoke all on function public.rejoin_battle(uuid, text) from anon;
grant execute on function public.join_battle(text) to authenticated;
grant execute on function public.rejoin_battle(uuid, text) to authenticated;
