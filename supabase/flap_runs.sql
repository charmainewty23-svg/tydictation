-- ============================================================
-- LearnITY Dictation — Speak Flap (voice reading game)
-- Weekly leaderboard, Most improved and Paws awards.
-- Run this once in Supabase → SQL Editor (project mggnwzirjmibreimrwiq)
-- Safe to re-run.
--
-- Requires (already installed on this project):
--   * public.student_logins                    → supabase/login_tracking.sql
--   * public.paw_ledger / paw_practice_award   → supabase/store.sql
-- ============================================================

-- ---------- 1. runs ----------
create table if not exists public.flap_runs (
    id          bigserial primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    nickname    text,
    score       int  not null default 0,
    phrases     int  not null default 0,
    gold        int  not null default 0,
    best_streak int  not null default 0,
    acc_hits    int  not null default 0,
    acc_words   int  not null default 0,
    wpm         int  not null default 0,
    week_start  date not null,
    created_at  timestamptz not null default now()
);

create index if not exists flap_runs_week_idx
    on public.flap_runs (week_start, score desc, created_at asc);
create index if not exists flap_runs_user_idx
    on public.flap_runs (user_id, created_at desc);
create index if not exists flap_runs_day_idx
    on public.flap_runs (((created_at at time zone 'Asia/Hong_Kong')::date));

alter table public.flap_runs enable row level security;

-- The weekly board is visible to every signed-in student. Guests (anon)
-- never see a leaderboard, so they get no select policy.
drop policy if exists "flap board readable" on public.flap_runs;
create policy "flap board readable" on public.flap_runs
    for select
    using (auth.uid() is not null);

revoke insert, update, delete on public.flap_runs from anon, authenticated;
grant select on public.flap_runs to authenticated;

-- ---------- 2. weekly board (one personal best per student per week) ----------
create or replace view public.flap_weekly_board
with (security_invoker = true)
as
select
    user_id,
    nickname,
    score,
    phrases,
    best_streak,
    created_at,
    week_start
from (
    select
        r.*,
        row_number() over (
            partition by r.user_id, r.week_start
            order by r.score desc, r.phrases desc, r.created_at asc
        ) as rn
    from public.flap_runs r
) ranked
where rn = 1;

revoke all on public.flap_weekly_board from anon;
grant select on public.flap_weekly_board to authenticated;

-- ---------- 3. most improved today (today's avg vs the past 7 days) ----------
create or replace view public.flap_improved_today
with (security_invoker = true)
as
with bounds as (
    select (now() at time zone 'Asia/Hong_Kong')::date as today
),
scored as (
    select
        r.user_id,
        r.score,
        (r.created_at at time zone 'Asia/Hong_Kong')::date as day
    from public.flap_runs r
),
agg as (
    select
        s.user_id,
        avg(case when s.day = b.today then s.score end) as today_avg,
        avg(case when s.day >= b.today - 7 and s.day < b.today then s.score end) as past_avg
    from scored s
    cross join bounds b
    group by s.user_id
),
latest_name as (
    select distinct on (r.user_id) r.user_id, r.nickname
    from public.flap_runs r
    order by r.user_id, r.created_at desc
)
select
    a.user_id,
    n.nickname,
    round(a.today_avg)::int as today_avg,
    round(a.past_avg)::int as past_avg,
    round(((a.today_avg - a.past_avg) / a.past_avg) * 100)::int as pct
from agg a
left join latest_name n on n.user_id = a.user_id
where a.today_avg is not null
  and a.past_avg is not null
  and a.past_avg > 0;

revoke all on public.flap_improved_today from anon;
grant select on public.flap_improved_today to authenticated;

-- ---------- 4. submit a ranked run ----------
-- Returns: rank, paws (phrase Paws actually credited), board_bonus,
-- improved_bonus, best (all-time personal best).
create or replace function public.submit_flap_run(
    p_score int,
    p_phrases int,
    p_gold int,
    p_best_streak int,
    p_acc_hits int,
    p_acc_words int,
    p_wpm int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me        uuid := auth.uid();
    v_week      date := date_trunc('week', now() at time zone 'Asia/Hong_Kong')::date;
    v_hk        date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_nick      text;
    v_run       bigint;
    v_before    int := 9999;
    v_after     int := 9999;
    v_paws      int := 0;
    v_board     int := 0;
    v_improved  int := 0;
    v_entries   int := 0;
    v_pct       int;
    v_top_pct   int;
    v_best      int := 0;
    v_ref       text;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select coalesce(
               nullif(sl.nickname, ''),
               nullif(u.raw_user_meta_data ->> 'full_name', ''),
               split_part(u.email, '@', 1)
           )
      into v_nick
      from auth.users u
      left join public.student_logins sl on sl.user_id = u.id
     where u.id = v_me;

    -- Make sure a wallet row exists (same welcome grant as my_paw_balance).
    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_me, 80, 'welcome', 'welcome')
    on conflict (user_id, ref_key) do nothing;

    -- Rank this student before the new run (9999 = not on the board).
    select coalesce(min(rn), 9999)
      into v_before
      from (
          select user_id,
                 row_number() over (order by score desc, phrases desc, created_at asc) as rn
            from (
                select distinct on (user_id) user_id, score, phrases, created_at
                  from public.flap_runs
                 where week_start = v_week
                 order by user_id, score desc, phrases desc, created_at asc
            ) best
      ) ranked
     where user_id = v_me;

    insert into public.flap_runs (
        user_id, nickname, score, phrases, gold, best_streak,
        acc_hits, acc_words, wpm, week_start
    ) values (
        v_me, v_nick,
        greatest(0, coalesce(p_score, 0)),
        greatest(0, coalesce(p_phrases, 0)),
        greatest(0, coalesce(p_gold, 0)),
        greatest(0, coalesce(p_best_streak, 0)),
        greatest(0, coalesce(p_acc_hits, 0)),
        greatest(0, coalesce(p_acc_words, 0)),
        greatest(0, coalesce(p_wpm, 0)),
        v_week
    )
    returning id into v_run;

    -- Phrase Paws go through the shared practice award so the daily cap,
    -- completion bonus and streak bonus all apply. Read back the ledger so
    -- the result screen shows what was actually credited.
    if coalesce(p_phrases, 0) > 0 then
        v_ref := 'practice:flap:' || v_run;
        perform public.paw_practice_award(
            v_me, 'flap', v_ref, greatest(0, p_phrases) * 3
        );
        select coalesce(sum(amount), 0)::int
          into v_paws
          from public.paw_ledger
         where user_id = v_me
           and ref_key = v_ref;
    end if;

    -- Rank after the run.
    select coalesce(min(rn), 9999)
      into v_after
      from (
          select user_id,
                 row_number() over (order by score desc, phrases desc, created_at asc) as rn
            from (
                select distinct on (user_id) user_id, score, phrases, created_at
                  from public.flap_runs
                 where week_start = v_week
                 order by user_id, score desc, phrases desc, created_at asc
            ) best
      ) ranked
     where user_id = v_me;

    -- +8 for reaching the top 7. Re-submitting while already on the board
    -- pays nothing; dropping out and re-entering pays again. A zero-score
    -- run never earns it, even when the board has fewer than 7 entries.
    if v_after <= 7 and v_before > 7 and greatest(0, coalesce(p_score, 0)) > 0 then
        select count(*)::int
          into v_entries
          from public.paw_ledger
         where user_id = v_me
           and ref_key like 'flap_board:' || v_week::text || ':%';
        v_ref := 'flap_board:' || v_week::text || ':' || (v_entries + 1);
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        values (v_me, 8, 'flap_board', v_ref)
        on conflict (user_id, ref_key) do nothing;
        if found then
            v_board := 8;
        end if;
    end if;

    -- +40 for being today's most improved reader. Each student can claim
    -- this once per Hong Kong day; the lead may change during the day.
    select pct into v_pct
      from public.flap_improved_today
     where user_id = v_me;
    select max(pct) into v_top_pct
      from public.flap_improved_today;
    if v_pct is not null and v_pct > 0 and v_pct >= coalesce(v_top_pct, 0) then
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        values (v_me, 40, 'flap_improved', 'flap_improved:' || v_hk::text)
        on conflict (user_id, ref_key) do nothing;
        if found then
            v_improved := 40;
        end if;
    end if;

    select coalesce(max(score), 0)::int
      into v_best
      from public.flap_runs
     where user_id = v_me;

    return jsonb_build_object(
        'rank', v_after,
        'paws', v_paws,
        'board_bonus', v_board,
        'improved_bonus', v_improved,
        'best', v_best
    );
end;
$fn$;

revoke all on function public.submit_flap_run(int, int, int, int, int, int, int) from public;
grant execute on function public.submit_flap_run(int, int, int, int, int, int, int) to authenticated;

-- ---------- 5. weekly settlement ----------
-- The board already filters by week_start, so this only prunes old runs to
-- keep the table small. Idempotent; the client calls it when the game opens.
create or replace function public.settle_flap_week()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_week date := date_trunc('week', now() at time zone 'Asia/Hong_Kong')::date;
begin
    delete from public.flap_runs
     where week_start < v_week - 56;
end;
$fn$;

revoke all on function public.settle_flap_week() from public;
grant execute on function public.settle_flap_week() to authenticated;

notify pgrst, 'reload schema';

-- Check it worked (run after a test game):
-- select nickname, score, phrases, week_start, created_at
--   from public.flap_weekly_board
--  where week_start = date_trunc('week', now() at time zone 'Asia/Hong_Kong')::date
--  order by score desc limit 7;
-- select nickname, today_avg, past_avg, pct from public.flap_improved_today order by pct desc;
