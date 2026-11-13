-- LearniTY — daily streak, repair cards and first-joined date per student.
-- Run once in the Supabase SQL editor of the live project. Safe to re-run.
-- The profile page also reads dictation_results / wj_leaderboard, so those
-- tables must already exist (dictation_results from §5, wj_scores.sql for Word
-- Jump). Without this file the app still works: the streak falls back to the
-- browser's local mirror, but it will not follow the Gmail account.

create table if not exists public.user_streaks (
    user_id uuid primary key references auth.users (id) on delete cascade,
    email text,
    nickname text,
    streak_count int not null default 0,
    streak_best int not null default 0,
    last_practice_date date,
    repair_cards int not null default 3,
    -- First *completed practice*, not first login. NULL until the student
    -- finishes a Dictation quiz / Word Jump / Drive & Go / Word Battle.
    first_seen timestamptz,
    updated_at timestamptz not null default now()
);

-- Re-running after an older version? Make first_seen mean "first practice":
-- nullable, no default, so it stays empty until the first completed practice.
alter table public.user_streaks alter column first_seen drop not null;
alter table public.user_streaks alter column first_seen drop default;

alter table public.user_streaks enable row level security;

drop policy if exists "read own streak" on public.user_streaks;
create policy "read own streak" on public.user_streaks
    for select using (auth.uid() = user_id);

drop policy if exists "insert own streak" on public.user_streaks;
create policy "insert own streak" on public.user_streaks
    for insert with check (auth.uid() = user_id);

drop policy if exists "update own streak" on public.user_streaks;
create policy "update own streak" on public.user_streaks
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists user_streaks_last_practice_idx
    on public.user_streaks (last_practice_date desc);

-- No delete policy: students cannot remove their own row.
-- Streak values are written by the browser (like dictation_results), so this
-- is classroom motivation, not an anti-cheat record.
