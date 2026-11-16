-- LearniTY Drive & Go!: allow 10 questions (especially class rooms).
-- Run after drive_and_go.sql and drive_and_go_class_room.sql. Safe to re-run.

do $fix$
declare
    r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.drive_and_go_rooms'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%question_count%'
    loop
        execute format('alter table public.drive_and_go_rooms drop constraint %I', r.conname);
    end loop;
end;
$fix$;

alter table public.drive_and_go_rooms
    add constraint drive_and_go_rooms_question_count_check
    check (question_count in (10, 20, 25, 30, 35, 40, 50));

create or replace function public.create_drive_and_go_room(
    p_question_mode text default 'av',
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null,
    p_question_count int default 20,
    p_scene text default 'desert',
    p_topic text default 'tenses'
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
    v_topic  text := lower(coalesce(p_topic, 'tenses'));
    v_mode   text := lower(coalesce(p_question_mode, 'av'));
    v_count  int := coalesce(p_question_count, 20);
    v_scene  text := lower(coalesce(p_scene, 'desert'));
    v_email  text := coalesce(auth.jwt() ->> 'email', '');
    v_nick   text;
    i        int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if v_topic not in ('tenses', 'agreement') then
        v_topic := 'tenses';
    end if;
    if v_topic = 'agreement' then
        if v_mode not in ('gapfill', 'choose', 'mixed') then
            v_mode := 'gapfill';
        end if;
    else
        if v_mode not in ('av', 'pv', 'mixed') then
            v_mode := 'av';
        end if;
    end if;
    if v_count not in (10, 20, 25, 30, 35, 40, 50) then
        v_count := 20;
    end if;
    if v_scene not in ('desert', 'stadium', 'jungle') then
        v_scene := 'desert';
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

    insert into public.drive_and_go_rooms
        (code, host_id, topic, question_mode, question_count, seed, scene)
    values
        (v_code, auth.uid(), v_topic, v_mode, v_count,
         floor(random() * 2147483646)::bigint + 1, v_scene)
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

create or replace function public.create_drive_and_go_class_room(
    p_question_mode text default 'av',
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null,
    p_question_count int default 20,
    p_scene text default 'desert',
    p_topic text default 'tenses',
    p_teacher_plays boolean default true
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
    v_topic  text := lower(coalesce(p_topic, 'tenses'));
    v_mode   text := lower(coalesce(p_question_mode, 'av'));
    v_count  int := coalesce(p_question_count, 20);
    v_scene  text := lower(coalesce(p_scene, 'desert'));
    v_plays  boolean := coalesce(p_teacher_plays, true);
    v_max    int := case when coalesce(p_teacher_plays, true) then 31 else 30 end;
    v_email  text := coalesce(auth.jwt() ->> 'email', '');
    v_nick   text;
    i        int;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if not public.is_drive_and_go_teacher() then
        raise exception 'NOT_TEACHER';
    end if;
    if v_topic not in ('tenses', 'agreement') then
        v_topic := 'tenses';
    end if;
    if v_topic = 'agreement' then
        if v_mode not in ('gapfill', 'choose', 'mixed') then
            v_mode := 'gapfill';
        end if;
    else
        if v_mode not in ('av', 'pv', 'mixed') then
            v_mode := 'av';
        end if;
    end if;
    if v_count not in (10, 20, 25, 30, 35, 40, 50) then
        v_count := 20;
    end if;
    if v_scene not in ('desert', 'stadium', 'jungle') then
        v_scene := 'desert';
    end if;

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

    insert into public.drive_and_go_rooms
        (code, host_id, topic, question_mode, question_count, seed, scene, max_players)
    values
        (v_code, auth.uid(), v_topic, v_mode, v_count,
         floor(random() * 2147483646)::bigint + 1, v_scene, v_max)
    returning * into v_room;

    if v_plays then
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

revoke all on function public.create_drive_and_go_room(text, text, text, text, text, int, text, text) from public;
grant execute on function public.create_drive_and_go_room(text, text, text, text, text, int, text, text) to authenticated;
revoke all on function public.create_drive_and_go_class_room(text, text, text, text, text, int, text, text, boolean) from public;
grant execute on function public.create_drive_and_go_class_room(text, text, text, text, text, int, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
