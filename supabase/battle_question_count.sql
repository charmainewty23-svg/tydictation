-- ============================================================
-- LearnITY Dictation — selectable question count (10 / 15 / 20)
-- Run AFTER supabase/battle_stats.sql.
-- Safe to re-run.
--
-- battle_rooms.question_count already existed; this just lets the client
-- choose it. Both duel and class rooms accept p_question_count.
-- ============================================================

-- old 2-argument versions would become ambiguous with defaults, so drop them
drop function if exists public.create_battle(text, bigint);
drop function if exists public.create_class_battle(text, bigint, int);

create or replace function public.create_battle(
    p_topic          text   default '__random__',
    p_seed           bigint default null,
    p_question_count int    default 10
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

    delete from public.battle_rooms where created_at < now() - interval '7 days';

    loop
        v_try := v_try + 1;
        v_code := '';
        for i in 1..4 loop
            v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        end loop;
        begin
            insert into public.battle_rooms (code, topic, seed, host_id, mode, max_players, question_count)
            values (
                v_code,
                coalesce(nullif(trim(p_topic), ''), '__random__'),
                coalesce(p_seed, floor(random() * 2000000000)::bigint),
                auth.uid(),
                'duel',
                2,
                greatest(5, least(coalesce(p_question_count, 10), 30))
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

create or replace function public.create_class_battle(
    p_topic          text   default '__random__',
    p_seed           bigint default null,
    p_max_players    int    default 60,
    p_question_count int    default 10
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
            insert into public.battle_rooms (code, topic, seed, host_id, status, mode, max_players, question_count)
            values (
                v_code,
                coalesce(nullif(trim(p_topic), ''), '__random__'),
                coalesce(p_seed, floor(random() * 2000000000)::bigint),
                auth.uid(),
                'waiting',
                'class',
                greatest(2, least(coalesce(p_max_players, 60), 200)),
                greatest(5, least(coalesce(p_question_count, 10), 30))
            )
            returning * into v_room;
            exit;
        exception when unique_violation then
            if v_try >= 10 then
                raise exception 'CODE_GENERATION_FAILED';
            end if;
        end;
    end loop;

    return next v_room;
end;
$$;

revoke all on function public.create_battle(text, bigint, int) from anon;
revoke all on function public.create_class_battle(text, bigint, int, int) from anon;
grant execute on function public.create_battle(text, bigint, int) to authenticated;
grant execute on function public.create_class_battle(text, bigint, int, int) to authenticated;

-- Check:
-- select code, mode, question_count from public.battle_rooms order by created_at desc limit 5;
