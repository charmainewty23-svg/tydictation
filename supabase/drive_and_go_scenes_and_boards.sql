-- ============================================================
-- LearnITY Dictation — Drive & Go! courses + Solo / Multi leaderboards
-- Run AFTER supabase/drive_and_go.sql and
-- supabase/drive_and_go_question_count.sql in the live project
-- https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
-- Safe to re-run.
--
-- Teachers who already ran drive_and_go_question_count.sql should paste
-- THIS file next. It adds:
--   * drive_and_go_rooms.scene ('desert' / 'stadium' / 'jungle')
--   * create_drive_and_go_room(..., p_scene) as a 7-argument function
--   * two separate leaderboard tables + personal-best views
--     (drive_and_go_solo_scores / drive_and_go_multi_scores)
--
-- A brand-new setup can paste the updated supabase/drive_and_go.sql
-- instead. Single Player never needs this file to run; it only enables
-- the cloud boards and the shared multiplayer course.
--
-- Never run this via a plugin or an agent — the teacher pastes it herself.
-- ============================================================

-- ---------- course (scene) on rooms ----------

alter table public.drive_and_go_rooms
    add column if not exists scene text not null default 'desert';

do $chk$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'drive_and_go_rooms_scene_chk'
          and conrelid = 'public.drive_and_go_rooms'::regclass
    ) then
        begin
            alter table public.drive_and_go_rooms
                add constraint drive_and_go_rooms_scene_chk
                check (scene in ('desert', 'stadium', 'jungle'));
        exception when others then
            -- Fresh tables already carry the same check inline on the column.
            null;
        end;
    end if;
end
$chk$;

-- Drop the older overloads so PostgREST cannot confuse them with the new
-- 7-argument function.
drop function if exists public.create_drive_and_go_room(text, text, text, text, text);
drop function if exists public.create_drive_and_go_room(text, text, text, text, text, int);

create or replace function public.create_drive_and_go_room(
    p_question_mode text default 'av',
    p_cat text default null,
    p_glasses text default null,
    p_hat text default null,
    p_outfit text default null,
    p_question_count int default 20,
    p_scene text default 'desert'
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
    v_scene  text := lower(coalesce(p_scene, 'desert'));
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

    insert into public.drive_and_go_rooms (code, host_id, question_mode, question_count, seed, scene)
    values (v_code, auth.uid(), v_mode, v_count, floor(random() * 2147483646)::bigint + 1, v_scene)
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

revoke all on function public.create_drive_and_go_room(text, text, text, text, text, int, text) from public, anon;
grant execute on function public.create_drive_and_go_room(text, text, text, text, text, int, text) to authenticated;

-- ============================================================
-- Solo leaderboard
-- ============================================================

create table if not exists public.drive_and_go_solo_scores (
    id             bigserial primary key,
    user_id        uuid not null references auth.users(id) on delete cascade,
    email          text not null,
    nickname       text,
    bank_mode      text not null default 'av'
                   check (bank_mode in ('av', 'pv', 'mixed')),
    question_count int  not null default 20,
    scene          text not null default 'desert'
                   check (scene in ('desert', 'stadium', 'jungle')),
    composite      int  not null default 0,
    race_score     int  not null default 0,
    time_bonus     int  not null default 0,
    correct        int  not null default 0,
    wrong          int  not null default 0,
    accuracy       numeric not null default 0
                   check (accuracy >= 0 and accuracy <= 1),
    elapsed_ms     int  not null default 0,
    created_at     timestamptz not null default now()
);

create index if not exists drive_and_go_solo_rank_idx
    on public.drive_and_go_solo_scores (composite desc, elapsed_ms asc, created_at asc);
create index if not exists drive_and_go_solo_user_idx
    on public.drive_and_go_solo_scores (user_id);
create index if not exists drive_and_go_solo_created_idx
    on public.drive_and_go_solo_scores (created_at desc);

alter table public.drive_and_go_solo_scores enable row level security;

drop policy if exists "drive and go solo board is public" on public.drive_and_go_solo_scores;
create policy "drive and go solo board is public" on public.drive_and_go_solo_scores
    for select
    using (true);

drop policy if exists "drive and go solo insert own" on public.drive_and_go_solo_scores;
create policy "drive and go solo insert own" on public.drive_and_go_solo_scores
    for insert
    with check (auth.uid() = user_id);

grant select on public.drive_and_go_solo_scores to anon, authenticated;
grant insert on public.drive_and_go_solo_scores to authenticated;

-- One row per student: their personal best by composite, then faster time,
-- then accuracy, then earlier created_at. `plays` is the run count.
drop view if exists public.drive_and_go_solo_leaderboard;

create view public.drive_and_go_solo_leaderboard
with (security_invoker = true)
as
select
    user_id,
    email,
    nickname,
    bank_mode,
    question_count,
    scene,
    composite,
    race_score,
    time_bonus,
    correct,
    wrong,
    accuracy,
    elapsed_ms,
    created_at,
    plays
from (
    select
        s.*,
        count(*) over (partition by s.user_id) as plays,
        row_number() over (
            partition by s.user_id
            order by s.composite desc, s.elapsed_ms asc, s.accuracy desc, s.created_at asc
        ) as rn
    from public.drive_and_go_solo_scores s
) ranked
where rn = 1;

grant select on public.drive_and_go_solo_leaderboard to anon, authenticated;

-- ============================================================
-- Multiplayer leaderboard
-- ============================================================

create table if not exists public.drive_and_go_multi_scores (
    id             bigserial primary key,
    user_id        uuid not null references auth.users(id) on delete cascade,
    email          text not null,
    nickname       text,
    bank_mode      text not null default 'av'
                   check (bank_mode in ('av', 'pv', 'mixed')),
    question_count int  not null default 20,
    scene          text not null default 'desert'
                   check (scene in ('desert', 'stadium', 'jungle')),
    composite      int  not null default 0,
    race_score     int  not null default 0,
    time_bonus     int  not null default 0,
    correct        int  not null default 0,
    wrong          int  not null default 0,
    accuracy       numeric not null default 0
                   check (accuracy >= 0 and accuracy <= 1),
    elapsed_ms     int  not null default 0,
    room_id        uuid references public.drive_and_go_rooms(id) on delete set null,
    place          int,
    player_count   int,
    created_at     timestamptz not null default now()
);

create index if not exists drive_and_go_multi_rank_idx
    on public.drive_and_go_multi_scores (composite desc, elapsed_ms asc, created_at asc);
create index if not exists drive_and_go_multi_user_idx
    on public.drive_and_go_multi_scores (user_id);
create index if not exists drive_and_go_multi_created_idx
    on public.drive_and_go_multi_scores (created_at desc);
create index if not exists drive_and_go_multi_room_idx
    on public.drive_and_go_multi_scores (room_id);

alter table public.drive_and_go_multi_scores enable row level security;

drop policy if exists "drive and go multi board is public" on public.drive_and_go_multi_scores;
create policy "drive and go multi board is public" on public.drive_and_go_multi_scores
    for select
    using (true);

drop policy if exists "drive and go multi insert own" on public.drive_and_go_multi_scores;
create policy "drive and go multi insert own" on public.drive_and_go_multi_scores
    for insert
    with check (auth.uid() = user_id);

grant select on public.drive_and_go_multi_scores to anon, authenticated;
grant insert on public.drive_and_go_multi_scores to authenticated;

drop view if exists public.drive_and_go_multi_leaderboard;

create view public.drive_and_go_multi_leaderboard
with (security_invoker = true)
as
select
    user_id,
    email,
    nickname,
    bank_mode,
    question_count,
    scene,
    composite,
    race_score,
    time_bonus,
    correct,
    wrong,
    accuracy,
    elapsed_ms,
    created_at,
    plays
from (
    select
        s.*,
        count(*) over (partition by s.user_id) as plays,
        row_number() over (
            partition by s.user_id
            order by s.composite desc, s.elapsed_ms asc, s.accuracy desc, s.created_at asc
        ) as rn
    from public.drive_and_go_multi_scores s
) ranked
where rn = 1;

grant select on public.drive_and_go_multi_leaderboard to anon, authenticated;

-- Check it worked:
-- select nickname, composite, elapsed_ms, accuracy, question_count, bank_mode, scene, plays
-- from public.drive_and_go_solo_leaderboard
-- order by composite desc, elapsed_ms asc, accuracy desc, created_at asc limit 10;
