-- LearniTY — daily streak, repair cards and first-practice date per student.
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

-- ---------------------------------------------------------------------------
-- One-time (and safe to re-run) backfill of the streak students already built
-- before this feature existed. It reads distinct Hong Kong practice days from
-- every table that exists, finds consecutive runs, and stores:
--   streak_count      = length of the run ending on the latest practice day
--   streak_best       = longest run ever
--   last_practice_date= latest practice day
--   first_seen        = earliest completed practice timestamp
-- Repair cards are never consumed by history, and existing newer rows are
-- never overwritten with older history.
-- ---------------------------------------------------------------------------
do $backfill$
declare
    has_dict boolean := to_regclass('public.dictation_results') is not null;
    has_wj boolean := to_regclass('public.wj_scores') is not null;
    has_dg_solo boolean := to_regclass('public.drive_and_go_solo_scores') is not null;
    has_dg_multi boolean := to_regclass('public.drive_and_go_multi_scores') is not null;
    has_battle boolean := to_regclass('public.battle_players') is not null
                          and to_regclass('public.battle_rooms') is not null;
begin
    if not has_dict and not has_wj and not has_dg_solo and not has_dg_multi and not has_battle then
        raise notice 'No practice tables found; skipping streak backfill.';
        return;
    end if;

    create temp table if not exists _learnity_streak_activity (
        user_id uuid not null,
        day date not null,
        created_at timestamptz not null
    ) on commit drop;

    if has_dict then
        execute $q$
            insert into _learnity_streak_activity (user_id, day, created_at)
            select user_id, (created_at at time zone 'Asia/Hong_Kong')::date, created_at
            from public.dictation_results
            where user_id is not null and created_at is not null
        $q$;
    end if;

    if has_wj then
        execute $q$
            insert into _learnity_streak_activity (user_id, day, created_at)
            select user_id, (created_at at time zone 'Asia/Hong_Kong')::date, created_at
            from public.wj_scores
            where user_id is not null and created_at is not null
        $q$;
    end if;

    if has_dg_solo then
        execute $q$
            insert into _learnity_streak_activity (user_id, day, created_at)
            select user_id, (created_at at time zone 'Asia/Hong_Kong')::date, created_at
            from public.drive_and_go_solo_scores
            where user_id is not null and created_at is not null
        $q$;
    end if;

    if has_dg_multi then
        execute $q$
            insert into _learnity_streak_activity (user_id, day, created_at)
            select user_id, (created_at at time zone 'Asia/Hong_Kong')::date, created_at
            from public.drive_and_go_multi_scores
            where user_id is not null and created_at is not null
        $q$;
    end if;

    if has_battle then
        execute $q$
            insert into _learnity_streak_activity (user_id, day, created_at)
            select p.user_id, (r.finished_at at time zone 'Asia/Hong_Kong')::date, r.finished_at
            from public.battle_players p
            join public.battle_rooms r on r.id = p.room_id
            where p.user_id is not null
              and r.finished_at is not null
              -- Class rooms are teacher-led and can include students who never
              -- answered, so they never count towards the streak.
              and coalesce(r.mode, 'duel') <> 'class'
        $q$;
    end if;

    execute $q$
        with days as (
            select distinct user_id, day from _learnity_streak_activity
        ),
        runs as (
            select user_id, day,
                   day - (row_number() over (partition by user_id order by day))::int as grp
            from days
        ),
        run_lengths as (
            select user_id, grp, max(day) as end_day, count(*)::int as len
            from runs
            group by user_id, grp
        ),
        best as (
            select user_id, max(len) as best_len
            from run_lengths
            group by user_id
        ),
        last_run as (
            select distinct on (user_id) user_id, len as last_len, end_day
            from run_lengths
            order by user_id, end_day desc
        ),
        first_seen as (
            select user_id, min(created_at) as first_at
            from _learnity_streak_activity
            group by user_id
        ),
        computed as (
            select lr.user_id,
                   -- A backfilled run only stays "current" if it ended today or
                   -- yesterday. Older runs keep their best but show 0 and must
                   -- start again without spending repair cards.
                   case
                       when lr.end_day >= ((now() at time zone 'Asia/Hong_Kong')::date - 1)
                       then lr.last_len
                       else 0
                   end as streak_count,
                   greatest(b.best_len, lr.last_len) as streak_best,
                   lr.end_day as last_practice_date,
                   fs.first_at as first_seen
            from last_run lr
            join best b on b.user_id = lr.user_id
            join first_seen fs on fs.user_id = lr.user_id
        )
        insert into public.user_streaks (
            user_id, email, nickname, streak_count, streak_best,
            last_practice_date, repair_cards, first_seen, updated_at
        )
        select c.user_id,
               u.email,
               coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
               c.streak_count, c.streak_best, c.last_practice_date, 3, c.first_seen, now()
        from computed c
        left join auth.users u on u.id = c.user_id
        on conflict (user_id) do update set
            email = coalesce(excluded.email, public.user_streaks.email),
            nickname = coalesce(excluded.nickname, public.user_streaks.nickname),
            streak_best = greatest(public.user_streaks.streak_best, excluded.streak_best),
            first_seen = least(public.user_streaks.first_seen, excluded.first_seen),
            last_practice_date = case
                when public.user_streaks.last_practice_date is null
                  or excluded.last_practice_date > public.user_streaks.last_practice_date
                then excluded.last_practice_date
                else public.user_streaks.last_practice_date
            end,
            streak_count = case
                when public.user_streaks.last_practice_date is null
                  or excluded.last_practice_date > public.user_streaks.last_practice_date
                then excluded.streak_count
                when excluded.last_practice_date = public.user_streaks.last_practice_date
                  and excluded.streak_count = 0
                then 0
                else public.user_streaks.streak_count
            end,
            updated_at = now()
    $q$;
end
$backfill$;
