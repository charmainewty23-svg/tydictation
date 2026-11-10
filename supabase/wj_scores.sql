-- ============================================================
-- LearnITY Dictation — Word Jump leaderboard
-- Run this once in Supabase → SQL Editor (project mggnwzirjmibreimrwiq)
-- Safe to re-run.
-- ============================================================

create table if not exists public.wj_scores (
    id          bigserial primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    email       text not null,
    nickname    text,
    topic       text,
    score       int  not null,
    height      int  not null default 0,
    words       int  not null default 0,
    created_at  timestamptz not null default now()
);

create index if not exists wj_scores_rank_idx
    on public.wj_scores (score desc, created_at asc);
create index if not exists wj_scores_user_idx
    on public.wj_scores (user_id);
create index if not exists wj_scores_created_idx
    on public.wj_scores (created_at desc);

alter table public.wj_scores enable row level security;

-- Everyone (including students who are not signed in) may read the board,
-- otherwise the leaderboard on the game-over screen cannot load.
drop policy if exists "leaderboard is public" on public.wj_scores;
create policy "leaderboard is public" on public.wj_scores
    for select
    using (true);

-- But a student may only add rows that belong to them.
drop policy if exists "insert own score" on public.wj_scores;
create policy "insert own score" on public.wj_scores
    for insert
    with check (auth.uid() = user_id);

grant select on public.wj_scores to anon, authenticated;
grant insert on public.wj_scores to authenticated;

-- ------------------------------------------------------------
-- One row per student: their personal best, plus how many games
-- they have played in total. The game-over screen asks for the
-- top 7 of this view; the teacher dashboard asks for all of it.
-- ------------------------------------------------------------
drop view if exists public.wj_leaderboard;

create view public.wj_leaderboard
with (security_invoker = true)
as
select
    user_id,
    email,
    nickname,
    topic,
    score,
    height,
    words,
    created_at,
    plays
from (
    select
        s.*,
        count(*) over (partition by s.user_id) as plays,
        row_number() over (
            partition by s.user_id
            order by s.score desc, s.created_at asc
        ) as rn
    from public.wj_scores s
) ranked
where rn = 1;

grant select on public.wj_leaderboard to anon, authenticated;

-- Check it worked:
-- select nickname, score, height, words, plays from public.wj_leaderboard
-- order by score desc limit 7;
