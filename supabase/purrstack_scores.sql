-- PurrStack leaderboard
-- Run this once in the Supabase SQL editor (safe to re-run).
-- The game posts its score from the embedded iframe; guests and teacher
-- preview accounts never submit.

create table if not exists public.purrstack_scores (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  nickname text,
  score int not null default 0 check (score >= 0),
  words int not null default 0 check (words >= 0),
  correct int not null default 0 check (correct >= 0),
  wrong int not null default 0 check (wrong >= 0),
  best_combo int not null default 0 check (best_combo >= 0),
  created_at timestamptz not null default now()
);

alter table public.purrstack_scores enable row level security;

drop policy if exists "purrstack read all" on public.purrstack_scores;
create policy "purrstack read all"
  on public.purrstack_scores for select
  using (true);

drop policy if exists "purrstack insert own" on public.purrstack_scores;
create policy "purrstack insert own"
  on public.purrstack_scores for insert
  with check (auth.uid() = user_id);

create index if not exists purrstack_scores_rank_idx
  on public.purrstack_scores (score desc, words desc, created_at asc);

-- One row per student: their personal best (score, then words).
create or replace view public.purrstack_leaderboard
with (security_invoker = true) as
select user_id, email, nickname, score, words, correct, wrong, best_combo, created_at
from (
  select s.*,
         row_number() over (
           partition by s.user_id
           order by s.score desc, s.words desc, s.created_at asc
         ) as rn
  from public.purrstack_scores s
) ranked
where rn = 1;

grant select on public.purrstack_leaderboard to anon, authenticated;
