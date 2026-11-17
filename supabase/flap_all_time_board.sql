-- LearniTY — Speak Flap: all-time personal-best board
-- Run once in the Supabase SQL editor after supabase/flap_runs.sql.
-- Safe to re-run.
--
-- Speak Flap ranking now works like Word Jump: one all-time personal best
-- per student, no Monday reset. The old flap_weekly_board is kept only for
-- compatibility; the client uses flap_leaderboard.
--
-- The +8 Paws board bonus now uses the all-time top 7. Existing weekly
-- flap_board ledger rows are left untouched, so a student can earn the +8
-- once under the new all-time board.

-- ---------- all-time board (one personal best per student) ----------
create or replace view public.flap_leaderboard
with (security_invoker = true)
as
select
    user_id,
    nickname,
    score,
    phrases,
    best_streak,
    created_at
from (
    select
        r.*,
        row_number() over (
            partition by r.user_id
            order by r.score desc, r.phrases desc, r.created_at asc
        ) as rn
    from public.flap_runs r
) ranked
where rn = 1;

revoke all on public.flap_leaderboard from anon;
grant select on public.flap_leaderboard to authenticated;

-- ---------- submit a ranked run (all-time rank) ----------
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
                 order by user_id, score desc, phrases desc, created_at asc
            ) best
      ) ranked
     where user_id = v_me;

    -- +8 for reaching the all-time top 7. Re-submitting while already on the board
    -- pays nothing; dropping out and re-entering pays again. A zero-score
    -- run never earns it, even when the board has fewer than 7 entries.
    if v_after <= 7 and v_before > 7 and greatest(0, coalesce(p_score, 0)) > 0 then
        select count(*)::int
          into v_entries
          from public.paw_ledger
         where user_id = v_me
           and ref_key like 'flap_board:all:%';
        v_ref := 'flap_board:all:' || (v_entries + 1);
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

-- ---------- keep all-time runs ----------
-- All-time personal bests must never be deleted. The old weekly settlement
-- pruned runs older than 56 weeks; this replacement is intentionally a no-op.
create or replace function public.settle_flap_week()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
    return;
end;
$fn$;

revoke all on function public.settle_flap_week() from public;
grant execute on function public.settle_flap_week() to authenticated;

notify pgrst, 'reload schema';
