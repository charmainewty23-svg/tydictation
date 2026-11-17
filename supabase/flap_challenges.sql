-- ============================================================
-- LearnITY Dictation — Speak Flap 1v1 challenge (async)
-- Run this AFTER supabase/flap_runs.sql.
-- Supabase → SQL Editor (project mggnwzirjmireimrwiq). Safe to re-run.
--
-- A challenge stores one score. A classmate joins with a 6-character code
-- and plays a normal ranked voice run later. There is no realtime match and
-- no extra Paws — the challenge run still pays through submit_flap_run().
-- ============================================================

-- ---------- 1. table ----------
create table if not exists public.flap_challenges (
    id                bigserial primary key,
    code              text not null unique,
    challenger        uuid not null references auth.users(id) on delete cascade,
    challenger_name   text,
    challenger_score  int  not null default 0,
    challenger_phrases int not null default 0,
    rival             uuid references auth.users(id) on delete set null,
    rival_name        text,
    rival_score       int,
    rival_phrases     int,
    status            text not null default 'open',
    winner            uuid,
    created_at        timestamptz not null default now(),
    accepted_at       timestamptz,
    finished_at       timestamptz,
    expires_at        timestamptz not null default now() + interval '14 days',
    constraint flap_challenge_status
        check (status in ('open', 'accepted', 'finished', 'cancelled')),
    constraint flap_challenge_distinct
        check (rival is null or rival <> challenger)
);

create index if not exists flap_challenges_challenger_idx
    on public.flap_challenges (challenger, created_at desc);
create index if not exists flap_challenges_rival_idx
    on public.flap_challenges (rival, created_at desc);
create index if not exists flap_challenges_open_idx
    on public.flap_challenges (status, expires_at);

alter table public.flap_challenges enable row level security;

-- No client policies: every read/write goes through the RPCs below, so a
-- student can never list other people's codes or edit a stored score.
revoke all on public.flap_challenges from anon, authenticated;

-- ---------- 2. name helper ----------
create or replace function public.flap_display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
    select coalesce(
               nullif(sl.nickname, ''),
               nullif(u.raw_user_meta_data ->> 'full_name', ''),
               split_part(u.email, '@', 1),
               'Student'
           )
      from auth.users u
      left join public.student_logins sl on sl.user_id = u.id
     where u.id = p_user;
$fn$;

revoke all on function public.flap_display_name(uuid) from public;
revoke all on function public.flap_display_name(uuid) from anon, authenticated;

-- ---------- 3. create ----------
create or replace function public.create_flap_challenge(
    p_score int,
    p_phrases int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me      uuid := auth.uid();
    v_name    text;
    v_active  int;
    v_code    text;
    v_id      bigint;
    v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    i         int;
    j         int;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    -- Clean expired open challenges so the 3-challenge limit stays fair.
    update public.flap_challenges
       set status = 'cancelled'
     where status = 'open'
       and expires_at <= now();

    select count(*)::int
      into v_active
      from public.flap_challenges
     where challenger = v_me
       and status in ('open', 'accepted');

    if v_active >= 3 then
        raise exception 'TOO_MANY_CHALLENGES';
    end if;

    v_name := public.flap_display_name(v_me);

    for i in 1..24 loop
        v_code := '';
        for j in 1..6 loop
            v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
        end loop;
        begin
            insert into public.flap_challenges (
                code, challenger, challenger_name, challenger_score, challenger_phrases
            ) values (
                v_code, v_me, v_name,
                greatest(0, coalesce(p_score, 0)),
                greatest(0, coalesce(p_phrases, 0))
            )
            returning id into v_id;
            exit;
        exception when unique_violation then
            v_id := null;
        end;
    end loop;

    if v_id is null then
        raise exception 'CODE_GENERATION_FAILED';
    end if;

    return jsonb_build_object(
        'id', v_id,
        'code', v_code,
        'name', v_name,
        'score', greatest(0, coalesce(p_score, 0)),
        'phrases', greatest(0, coalesce(p_phrases, 0))
    );
end;
$fn$;

revoke all on function public.create_flap_challenge(int, int) from public;
grant execute on function public.create_flap_challenge(int, int) to authenticated;

-- ---------- 4. accept ----------
create or replace function public.accept_flap_challenge(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me     uuid := auth.uid();
    v_row    public.flap_challenges;
    v_name   text;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_row
      from public.flap_challenges
     where code = upper(trim(coalesce(p_code, '')))
     limit 1;

    if v_row.id is null then
        raise exception 'CHALLENGE_NOT_FOUND';
    end if;
    if v_row.challenger = v_me then
        raise exception 'OWN_CHALLENGE';
    end if;

    -- Already joined: return the same target so a refresh can resume.
    if v_row.rival = v_me then
        if v_row.status = 'cancelled' then
            raise exception 'CHALLENGE_CANCELLED';
        end if;
        return jsonb_build_object(
            'id', v_row.id,
            'code', v_row.code,
            'rival', v_row.challenger_name,
            'target_score', v_row.challenger_score,
            'target_phrases', v_row.challenger_phrases,
            'status', v_row.status
        );
    end if;

    if v_row.status <> 'open' then
        raise exception 'CHALLENGE_TAKEN';
    end if;
    if v_row.expires_at <= now() then
        raise exception 'CHALLENGE_EXPIRED';
    end if;

    v_name := public.flap_display_name(v_me);

    update public.flap_challenges
       set rival = v_me,
           rival_name = v_name,
           status = 'accepted',
           accepted_at = now()
     where id = v_row.id
       and status = 'open'
       and rival is null;

    if not found then
        raise exception 'CHALLENGE_TAKEN';
    end if;

    return jsonb_build_object(
        'id', v_row.id,
        'code', v_row.code,
        'rival', v_row.challenger_name,
        'target_score', v_row.challenger_score,
        'target_phrases', v_row.challenger_phrases,
        'status', 'accepted'
    );
end;
$fn$;

revoke all on function public.accept_flap_challenge(text) from public;
grant execute on function public.accept_flap_challenge(text) to authenticated;

-- ---------- 5. finish ----------
create or replace function public.finish_flap_challenge(
    p_id bigint,
    p_score int,
    p_phrases int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me      uuid := auth.uid();
    v_row     public.flap_challenges;
    v_score   int := greatest(0, coalesce(p_score, 0));
    v_phrases int := greatest(0, coalesce(p_phrases, 0));
    v_winner  uuid;
    v_result  text;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    select * into v_row
      from public.flap_challenges
     where id = p_id
     for update;

    if v_row.id is null then
        raise exception 'CHALLENGE_NOT_FOUND';
    end if;
    if v_row.rival is distinct from v_me then
        raise exception 'NOT_YOUR_CHALLENGE';
    end if;
    if v_row.status = 'cancelled' then
        raise exception 'CHALLENGE_CANCELLED';
    end if;
    if v_row.status = 'finished' then
        -- Idempotent: a late retry returns the stored outcome.
        v_result := case
            when v_row.winner is null then 'tie'
            when v_row.winner = v_me then 'win'
            else 'lose'
        end;
        return jsonb_build_object(
            'result', v_result,
            'my_score', coalesce(v_row.rival_score, 0),
            'their_score', v_row.challenger_score,
            'their_name', v_row.challenger_name
        );
    end if;
    if v_row.status <> 'accepted' then
        raise exception 'CHALLENGE_NOT_ACCEPTED';
    end if;

    if v_score > v_row.challenger_score
       or (v_score = v_row.challenger_score and v_phrases > v_row.challenger_phrases) then
        v_winner := v_me;
        v_result := 'win';
    elsif v_score = v_row.challenger_score and v_phrases = v_row.challenger_phrases then
        v_winner := null;
        v_result := 'tie';
    else
        v_winner := v_row.challenger;
        v_result := 'lose';
    end if;

    update public.flap_challenges
       set rival_score = v_score,
           rival_phrases = v_phrases,
           status = 'finished',
           winner = v_winner,
           finished_at = now()
     where id = v_row.id;

    return jsonb_build_object(
        'result', v_result,
        'my_score', v_score,
        'their_score', v_row.challenger_score,
        'their_name', v_row.challenger_name
    );
end;
$fn$;

revoke all on function public.finish_flap_challenge(bigint, int, int) from public;
grant execute on function public.finish_flap_challenge(bigint, int, int) to authenticated;

-- ---------- 6. list ----------
create or replace function public.flap_challenges_list()
returns table (
    id          bigint,
    code        text,
    role        text,
    rival_name  text,
    my_score    int,
    their_score int,
    status      text,
    winner      uuid,
    created_at  timestamptz,
    expires_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
    select
        c.id,
        c.code,
        case when c.challenger = auth.uid() then 'sent' else 'received' end as role,
        case when c.challenger = auth.uid()
             then coalesce(c.rival_name, 'Waiting for a classmate')
             else c.challenger_name end as rival_name,
        case when c.challenger = auth.uid()
             then c.challenger_score
             else coalesce(c.rival_score, 0) end as my_score,
        case when c.challenger = auth.uid()
             then coalesce(c.rival_score, 0)
             else c.challenger_score end as their_score,
        case
            when c.status = 'open' and c.expires_at <= now() then 'expired'
            else c.status
        end as status,
        c.winner,
        c.created_at,
        c.expires_at
    from public.flap_challenges c
    where auth.uid() is not null
      and (c.challenger = auth.uid() or c.rival = auth.uid())
    order by
        case
            when c.status = 'accepted' then 0
            when c.status = 'open' and c.expires_at > now() then 1
            when c.status = 'finished' then 2
            else 3
        end,
        c.created_at desc
    limit 40;
$fn$;

revoke all on function public.flap_challenges_list() from public;
grant execute on function public.flap_challenges_list() to authenticated;

-- ---------- 7. cancel ----------
create or replace function public.cancel_flap_challenge(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    update public.flap_challenges
       set status = 'cancelled'
     where id = p_id
       and challenger = auth.uid()
       and status in ('open', 'accepted');
end;
$fn$;

revoke all on function public.cancel_flap_challenge(bigint) from public;
grant execute on function public.cancel_flap_challenge(bigint) to authenticated;

notify pgrst, 'reload schema';

-- Check it worked:
-- select * from public.flap_challenges_list();
