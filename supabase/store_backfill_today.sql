-- ============================================================
-- LearniTY — backfill Paws for TODAY's practices only
-- Run AFTER supabase/store.sql. Safe to re-run.
-- It calls paw_practice_award() for every score row created today
-- (Hong Kong date) that does not already have a matching ledger ref,
-- so completion / streak bonuses and the 150/day cap are applied too.
-- ============================================================

do $$
declare
    v_day_start timestamptz :=
        ((now() at time zone 'Asia/Hong_Kong')::date::timestamp at time zone 'Asia/Hong_Kong');
    r record;
begin
    create temp table if not exists tmp_paw_today (
        user_id uuid,
        kind text,
        ref text,
        base int,
        created_at timestamptz
    ) on commit drop;
    truncate tmp_paw_today;

    insert into tmp_paw_today
    select d.user_id,
           'dictation',
           'practice:dictation:' || md5(row_to_json(d)::text),
           coalesce((to_jsonb(d) ->> 'correct')::int, 0),
           d.created_at
      from public.dictation_results d
     where d.created_at >= v_day_start;

    insert into tmp_paw_today
    select w.user_id,
           'wordjump',
           'practice:wordjump:' || w.id,
           least(coalesce(w.words, 0), 40),
           w.created_at
      from public.wj_scores w
     where w.created_at >= v_day_start;

    insert into tmp_paw_today
    select s.user_id,
           'drive_solo',
           'practice:drive_solo:' || s.id,
           coalesce(s.correct, 0),
           s.created_at
      from public.drive_and_go_solo_scores s
     where s.created_at >= v_day_start;

    insert into tmp_paw_today
    select m.user_id,
           'drive_multi',
           'practice:drive_multi:' || m.id,
           coalesce(m.correct, 0),
           m.created_at
      from public.drive_and_go_multi_scores m
     where m.created_at >= v_day_start;

    insert into tmp_paw_today
    select bp.user_id,
           'battle',
           'practice:battle:' || bp.room_id::text || ':' || bp.user_id::text,
           least(coalesce(bp.correct, 0), 20),
           coalesce((to_jsonb(br) ->> 'finished_at')::timestamptz, bp.last_seen)
      from public.battle_players bp
      join public.battle_rooms br on br.id = bp.room_id
     where bp.done = true
       and coalesce(to_jsonb(br) ->> 'mode', 'duel') <> 'class'
       and coalesce((to_jsonb(br) ->> 'finished_at')::timestamptz, bp.last_seen) >= v_day_start;

    for r in
        select * from tmp_paw_today
         order by created_at, user_id
    loop
        perform public.paw_practice_award(r.user_id, r.kind, r.ref, r.base);
    end loop;
end $$;

-- Optional check: today's Paws per student.
select u.email,
       coalesce(sum(l.amount), 0) as paws_today
  from auth.users u
  left join public.paw_ledger l
    on l.user_id = u.id
   and l.ref_key like 'practice:%'
   and l.created_at >= ((now() at time zone 'Asia/Hong_Kong')::date::timestamp at time zone 'Asia/Hong_Kong')
 group by u.email
 order by paws_today desc;
