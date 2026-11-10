-- ============================================================
-- LearnITY Dictation — per-question accuracy stats
-- Run AFTER supabase/battle_live.sql.
-- Safe to re-run.
--
-- One row per student per question. The teacher dashboard aggregates it
-- into "which word was misspelled most often".
-- ============================================================

create table if not exists public.battle_answers (
    id          bigserial primary key,
    room_id     uuid not null references public.battle_rooms(id) on delete cascade,
    user_id     uuid not null references auth.users(id) on delete cascade,
    q_index     int  not null,
    word        text not null,
    answer      text,
    correct     boolean not null default false,
    ms          int,
    created_at  timestamptz not null default now(),
    unique (room_id, user_id, q_index)
);

create index if not exists battle_answers_room_idx on public.battle_answers (room_id, q_index);

alter table public.battle_answers enable row level security;

drop policy if exists "answers insert own" on public.battle_answers;
drop policy if exists "answers update own" on public.battle_answers;
drop policy if exists "answers read own or teacher" on public.battle_answers;

create policy "answers insert own" on public.battle_answers
    for insert with check (
        user_id = auth.uid() and public.is_battle_member(room_id)
    );

create policy "answers update own" on public.battle_answers
    for update
    using (user_id = auth.uid() and public.is_battle_member(room_id))
    with check (user_id = auth.uid() and public.is_battle_member(room_id));

-- students may review their own mistakes; only the teacher sees the whole class
create policy "answers read own or teacher" on public.battle_answers
    for select using (user_id = auth.uid() or public.is_teacher());

grant select, insert, update on public.battle_answers to authenticated;

-- Handy aggregate for a quick look in the SQL editor:
-- select q_index, word,
--        count(*) as attempts,
--        sum(case when correct then 1 else 0 end) as correct,
--        round(100.0 * sum(case when correct then 1 else 0 end) / count(*)) as accuracy
-- from public.battle_answers
-- where room_id = '<uuid>'
-- group by q_index, word
-- order by accuracy asc;
