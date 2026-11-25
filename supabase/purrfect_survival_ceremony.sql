-- ============================================================
-- LearniTY — Purr-fect Survival: prize ceremony + Paws awards
--
-- PASTE THIS FILE INTO THE LIVE PROJECT'S SUPABASE SQL EDITOR:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--
-- Clear the editor first.
-- Paste this AFTER both earlier incrementals:
--   1) purrfect_survival_host_settings.sql (PR #51)
--   2) purrfect_survival_tug.sql
-- Do NOT re-run older incrementals (purrfect_survival.sql,
-- purrfect_survival_host_settings.sql or purrfect_survival_tug.sql).
-- Never run this from a plugin, CLI or agent: the teacher pastes it.
-- Safe to re-run.
--
-- What it adds, in teacher-friendly language:
--   * A prize ceremony whenever a class session ends: after Round 1
--     (1-2-3 Meow!), after Round 2 (Glass Stepping Stones) or after
--     Round 3 (Tug of War). The ceremony is shown to the teacher and to
--     every student; the canvas draws the podium and the HTML panel lists
--     the official ranking.
--   * Paws (🐾) are awarded automatically to every student who actually
--     played (a teacher who only hosted and never joined as a player gets
--     nothing). The amounts are:
--        1st overall ............ +20
--        2nd overall ............ +13
--        3rd overall ............ +8
--        other survivors ........ +5
--        other participants ..... +2
--     "Survivor" means still standing after 1-2-3 Meow!, across the glass
--     bridge, or on the winning Tug of War team. A skipped Tug of War
--     (fewer than two survivors) lets the glass survivors win.
--   * Awards are server-authoritative and idempotent: every student has a
--     unique ref key `purrfect_survival:<room>:<user>`, so refreshing the
--     ceremony screen or reconnecting never pays twice.
--   * Guests and the public demo do not write to paw_ledger at all. Guests
--     cannot be in a live room, and the demo never calls the award RPC.
--   * `my_paws_today()`, `friend_paws_daily()` and `admin_paw_daily()` now
--     count reason='purrfect_survival' as today's Paws, exactly like
--     'class_battle'. Shop balances already sum the whole ledger.
--   * Rounds 4-5 are still NOT implemented and stay coming soon.
-- ============================================================

-- ---------- Paws table helper ----------

create or replace function public.purrfect_survival_ceremony_paws(
    p_place int,
    p_survived boolean
) returns int
language sql
immutable
as $fn$
    select case
        when p_place = 1 then 20
        when p_place = 2 then 13
        when p_place = 3 then 8
        when coalesce(p_survived, false) then 5
        else 2
    end;
$fn$;

-- ---------- Official ranking (mirrors PSEngine.ceremonyResults) ----------

create or replace function public.purrfect_survival_ceremony_rows(p_room_id uuid)
returns table (
    user_id uuid,
    nickname text,
    place int,
    paws int,
    role_name text,
    survived boolean,
    round1_survived boolean,
    distance int,
    reached_finish boolean,
    finished_at timestamptz,
    round1_rank int,
    eliminated_reason text,
    glass_step int,
    glass_finished_at timestamptz,
    crossed_glass boolean,
    tug_team text,
    tug_won boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_rounds int;
    v_finish int;
    v_winner text;
begin
    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id;

    if not found then
        return;
    end if;

    v_rounds := public.purrfect_survival_round_count(v_room.settings);
    v_finish := coalesce(v_room.finish_distance, 100);
    v_winner := nullif(v_room.tug_state ->> 'winner', '');
    if v_winner is not null and v_winner not in ('red', 'blue') then
        v_winner := null;
    end if;

    if v_rounds >= 3 then
        return query
        with base as (
            select p.user_id,
                   coalesce(nullif(btrim(p.nickname), ''),
                            split_part(coalesce(p.email, ''), '@', 1),
                            'Player') as nickname,
                   p.distance,
                   coalesce(p.reached_finish, false) as reached_finish,
                   p.finished_at,
                   p.round1_rank,
                   p.eliminated_reason,
                   p.glass_step,
                   p.glass_finished_at,
                   coalesce(p.crossed_glass, false) as crossed_glass,
                   p.tug_team,
                   (p.status <> 'eliminated'
                    and p.status <> 'out'
                    and coalesce(p.ghost, false) = false) as round1_survived,
                   case when v_winner is not null then
                        case
                            when p.tug_team = v_winner then 0
                            when p.tug_team in ('red', 'blue') then 1
                            else 2
                        end
                   else
                        case
                            when coalesce(p.crossed_glass, false)
                                 or p.status = 'advanced' then 0
                            else 1
                        end
                   end as grp,
                   case when v_winner is not null then
                        coalesce(p.tug_team = v_winner, false)
                   else
                        (coalesce(p.crossed_glass, false) or p.status = 'advanced')
                   end as survived,
                   case when v_winner is null then null
                        else coalesce(p.tug_team = v_winner, false)
                   end as tug_won
              from public.purrfect_survival_players p
             where p.room_id = p_room_id
               and coalesce(p.is_playing, true)
        ),
        ranked as (
            select b.*,
                   (row_number() over (
                       order by b.grp asc,
                                b.glass_finished_at asc nulls last,
                                b.round1_rank asc nulls last,
                                b.user_id
                   ))::int as place
              from base b
        )
        select r.user_id, r.nickname, r.place,
               public.purrfect_survival_ceremony_paws(r.place, r.survived),
               case r.place when 1 then 'first' when 2 then 'second'
                    when 3 then 'third'
                    else case when r.survived then 'survivor' else 'participant' end
               end,
               r.survived, r.round1_survived, r.distance, r.reached_finish,
               r.finished_at, r.round1_rank, r.eliminated_reason,
               r.glass_step, r.glass_finished_at, r.crossed_glass,
               r.tug_team, r.tug_won
          from ranked r
         order by r.place;
        return;
    end if;

    if v_rounds = 2 then
        return query
        with base as (
            select p.user_id,
                   coalesce(nullif(btrim(p.nickname), ''),
                            split_part(coalesce(p.email, ''), '@', 1),
                            'Player') as nickname,
                   p.distance,
                   coalesce(p.reached_finish, false) as reached_finish,
                   p.finished_at,
                   p.round1_rank,
                   p.eliminated_reason,
                   p.glass_step,
                   p.glass_finished_at,
                   coalesce(p.crossed_glass, false) as crossed_glass,
                   p.tug_team,
                   (p.status <> 'eliminated'
                    and p.status <> 'out'
                    and coalesce(p.ghost, false) = false) as round1_survived,
                   (coalesce(p.crossed_glass, false) or p.status = 'advanced') as survived
              from public.purrfect_survival_players p
             where p.room_id = p_room_id
               and coalesce(p.is_playing, true)
        ),
        ranked as (
            select b.*,
                   (row_number() over (
                       order by b.survived desc,
                                case when b.survived then b.glass_finished_at end asc nulls last,
                                case when b.survived then b.round1_rank end asc nulls last,
                                case when not b.survived then b.glass_step end desc nulls last,
                                case when not b.survived then b.round1_rank end asc nulls last,
                                case when not b.survived then b.distance end desc nulls last,
                                b.user_id
                   ))::int as place
              from base b
        )
        select r.user_id, r.nickname, r.place,
               public.purrfect_survival_ceremony_paws(r.place, r.survived),
               case r.place when 1 then 'first' when 2 then 'second'
                    when 3 then 'third'
                    else case when r.survived then 'survivor' else 'participant' end
               end,
               r.survived, r.round1_survived, r.distance, r.reached_finish,
               r.finished_at, r.round1_rank, r.eliminated_reason,
               r.glass_step, r.glass_finished_at, r.crossed_glass,
               r.tug_team, null::boolean
          from ranked r
         order by r.place;
        return;
    end if;

    return query
    with base as (
        select p.user_id,
               coalesce(nullif(btrim(p.nickname), ''),
                        split_part(coalesce(p.email, ''), '@', 1),
                        'Player') as nickname,
               p.distance,
               coalesce(p.reached_finish, false) as reached_finish,
               p.finished_at,
               p.round1_rank,
               p.eliminated_reason,
               p.glass_step,
               p.glass_finished_at,
               coalesce(p.crossed_glass, false) as crossed_glass,
               p.tug_team,
               (p.status <> 'eliminated'
                and p.status <> 'out'
                and coalesce(p.ghost, false) = false) as round1_survived,
               (p.status <> 'eliminated'
                and p.status <> 'out'
                and coalesce(p.ghost, false) = false) as survived,
               (coalesce(p.reached_finish, false) or p.distance >= v_finish) as finisher
          from public.purrfect_survival_players p
         where p.room_id = p_room_id
           and coalesce(p.is_playing, true)
    ),
    ranked as (
        select b.*,
               (row_number() over (
                   order by b.survived desc,
                            case when b.survived then b.finisher end desc nulls last,
                            case when b.survived then b.finished_at end asc nulls last,
                            b.distance desc,
                            b.user_id
               ))::int as place
          from base b
    )
    select r.user_id, r.nickname, r.place,
           public.purrfect_survival_ceremony_paws(r.place, r.survived),
           case r.place when 1 then 'first' when 2 then 'second'
                when 3 then 'third'
                else case when r.survived then 'survivor' else 'participant' end
           end,
           r.survived, r.round1_survived, r.distance, r.reached_finish,
           r.finished_at, r.round1_rank, r.eliminated_reason,
           r.glass_step, r.glass_finished_at, r.crossed_glass,
           r.tug_team, null::boolean
      from ranked r
     order by r.place;
end;
$fn$;

-- ---------- Idempotent ledger award ----------

create or replace function public.paw_trg_purrfect_survival()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if new.status <> 'finished'
       or old.status is not distinct from 'finished' then
        return new;
    end if;
    if to_regclass('public.paw_ledger') is null then
        return new;
    end if;

    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    select r.user_id,
           r.paws,
           'purrfect_survival',
           'purrfect_survival:' || new.id::text || ':' || r.user_id::text
      from public.purrfect_survival_ceremony_rows(new.id) r
     where r.paws > 0
    on conflict (user_id, ref_key) do nothing;

    return new;
end;
$fn$;

drop trigger if exists paw_trg_purrfect_survival_after_update on public.purrfect_survival_rooms;
create trigger paw_trg_purrfect_survival_after_update
after update on public.purrfect_survival_rooms
for each row execute function public.paw_trg_purrfect_survival();

-- ---------- Callable ceremony RPC ----------

create or replace function public.purrfect_survival_ceremony(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room public.purrfect_survival_rooms;
    v_rounds int;
    v_winner text;
    v_results jsonb;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_room
    from public.purrfect_survival_rooms
    where id = p_room_id;

    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;

    if not (public.is_purrfect_survival_member(p_room_id)
            or public.is_purrfect_survival_teacher()) then
        raise exception 'NOT_ALLOWED';
    end if;

    if v_room.status <> 'finished' then
        raise exception 'ROOM_NOT_FINISHED';
    end if;

    v_rounds := public.purrfect_survival_round_count(v_room.settings);
    v_winner := nullif(v_room.tug_state ->> 'winner', '');
    if v_winner is not null and v_winner not in ('red', 'blue') then
        v_winner := null;
    end if;

    if to_regclass('public.paw_ledger') is not null then
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        select r.user_id,
               r.paws,
               'purrfect_survival',
               'purrfect_survival:' || p_room_id::text || ':' || r.user_id::text
          from public.purrfect_survival_ceremony_rows(p_room_id) r
         where r.paws > 0
        on conflict (user_id, ref_key) do nothing;
    end if;

    select coalesce(jsonb_agg(
               jsonb_build_object(
                   'place', r.place,
                   'user_id', r.user_id,
                   'nickname', r.nickname,
                   'paws', r.paws,
                   'role', r.role_name,
                   'survived', r.survived,
                   'rounds',
                       jsonb_build_object('r1', jsonb_build_object(
                           'distance', r.distance,
                           'reached_finish', r.reached_finish,
                           'finished_at', r.finished_at,
                           'round1_rank', r.round1_rank,
                           'eliminated', not r.round1_survived,
                           'eliminated_reason', r.eliminated_reason
                       ))
                       || case when v_rounds >= 2 then jsonb_build_object('r2', jsonb_build_object(
                              'glass_step', r.glass_step,
                              'glass_finished_at', r.glass_finished_at,
                              'crossed_glass', r.crossed_glass
                          )) else '{}'::jsonb end
                       || case when v_rounds >= 3 then jsonb_build_object('r3', jsonb_build_object(
                              'tug_team', r.tug_team,
                              'won', r.tug_won
                          )) else '{}'::jsonb end
               ) order by r.place
           ), '[]'::jsonb)
      into v_results
      from public.purrfect_survival_ceremony_rows(p_room_id) r;

    return jsonb_build_object(
        'room_id', p_room_id,
        'round_count', v_rounds,
        'tug_winner', v_winner,
        'paws_table', jsonb_build_object(
            'first', 20, 'second', 13, 'third', 8,
            'survivor', 5, 'participant', 2
        ),
        'results', v_results
    );
end;
$fn$;

-- ---------- Paws "today" now includes Purr-fect Survival ----------

create or replace function public.my_paws_today()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_day_start timestamptz :=
        ((now() at time zone 'Asia/Hong_Kong')::date::timestamp at time zone 'Asia/Hong_Kong');
    v_total int := 0;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    select coalesce(sum(amount), 0)::int into v_total
      from public.paw_ledger
     where user_id = v_me
       and amount > 0
       and created_at >= v_day_start
       and (reason like 'practice:%'
            or reason = 'class_battle'
            or reason = 'purrfect_survival');
    return v_total;
end;
$fn$;

create or replace function public.friend_paws_daily(p_user_id uuid, p_days int default 7)
returns table (day date, earned int)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_days int := greatest(1, least(coalesce(p_days, 7), 31));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_start timestamptz :=
        ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Hong_Kong');
begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_user_id is null then return; end if;
    return query
    with days as (
        select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as d
    ),
    daily as (
        select (l.created_at at time zone 'Asia/Hong_Kong')::date as d,
               sum(l.amount)::int as earned
          from public.paw_ledger l
         where l.user_id = p_user_id
           and l.amount > 0
           and l.created_at >= v_start
           and (l.reason like 'practice:%'
                or l.reason = 'class_battle'
                or l.reason = 'purrfect_survival')
         group by (l.created_at at time zone 'Asia/Hong_Kong')::date
    )
    select days.d as day, coalesce(daily.earned, 0)::int as earned
      from days
      left join daily on daily.d = days.d
     order by days.d;
end;
$fn$;

create or replace function public.admin_paw_daily(p_days int default 7)
returns table (
    user_id uuid,
    email text,
    nickname text,
    form text,
    day date,
    earned int,
    spent int,
    balance int
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_days int := greatest(1, least(coalesce(p_days, 7), 31));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_start timestamptz :=
        ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Hong_Kong');
begin
    if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'tywong@lstyoungkhl.edu.hk' then
        raise exception 'NOT_ADMIN';
    end if;

    return query
    with days as (
        select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as d
    ),
    students as (
        select sl.user_id, sl.email, sl.nickname, sl.form
          from public.student_logins sl
    ),
    daily as (
        select l.user_id,
               (l.created_at at time zone 'Asia/Hong_Kong')::date as d,
               sum(case when l.amount > 0
                         and (l.reason like 'practice:%'
                              or l.reason = 'class_battle'
                              or l.reason = 'purrfect_survival')
                        then l.amount else 0 end)::int as earned,
               sum(case when l.amount < 0 then -l.amount else 0 end)::int as spent
          from public.paw_ledger l
         where l.created_at >= v_start
         group by l.user_id, (l.created_at at time zone 'Asia/Hong_Kong')::date
    )
    select s.user_id,
           s.email,
           s.nickname,
           s.form,
           d.d as day,
           coalesce(x.earned, 0) as earned,
           coalesce(x.spent, 0) as spent,
           coalesce((select sum(l2.amount)::int from public.paw_ledger l2
                      where l2.user_id = s.user_id), 0) as balance
      from students s
      cross join days d
      left join daily x on x.user_id = s.user_id and x.d = d.d
     order by s.form nulls last, s.email, d.d;
end;
$fn$;

-- ---------- grants ----------

revoke all on function public.purrfect_survival_ceremony_paws(int, boolean) from public, anon, authenticated;
revoke all on function public.purrfect_survival_ceremony_rows(uuid) from public, anon, authenticated;
revoke all on function public.paw_trg_purrfect_survival() from public, anon, authenticated;
revoke all on function public.purrfect_survival_ceremony(uuid) from public, anon;

revoke all on function public.admin_paw_daily(int) from public, anon;

grant execute on function public.purrfect_survival_ceremony(uuid) to authenticated;
grant execute on function public.my_paws_today() to authenticated;
grant execute on function public.friend_paws_daily(uuid, int) to authenticated;
grant execute on function public.admin_paw_daily(int) to authenticated;

notify pgrst, 'reload schema';
