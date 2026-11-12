-- ============================================================
-- LearnITY Dictation — guest (password 0203) login + usage tracking
-- Run this once in Supabase → SQL Editor (project mggnwzirjmibreimrwiq)
-- Safe to re-run.
--
-- Guests sign in with a shared password and have no Google account, so
-- they never appear in student_logins, scores or leaderboards. These two
-- tables are for the teacher's admin dashboard only ("🕵️ Guest logins"):
--   guest_logins — one row per successful password entry (browser calls
--                  record_guest_login; NOT called on a refresh that only
--                  restores the session from sessionStorage)
--   guest_usage  — one row per meaningful guest activity (Word Jump,
--                  dictation modes, New Vocab, Error Book, Grammar Quest…),
--                  linked to that login through session_key
--
-- Retention: only a ROLLING last 24 hours is kept (now() - interval '24
-- hours'), NOT an Asia/Hong_Kong calendar day. prune_guest_records() deletes
-- older rows; record_guest_login / record_guest_usage call it on every write
-- and the dashboard calls it on every load/Refresh. The frontend filters with
-- the same cutoff. Existing installs only need supabase/guest_tracking_prune.sql.
-- ============================================================

create table if not exists public.guest_logins (
    id           bigserial primary key,
    logged_in_at timestamptz not null default now(),
    user_agent   text,
    session_key  text
);

create table if not exists public.guest_usage (
    id         bigserial primary key,
    session_key text,
    feature    text not null,
    detail     text,
    created_at timestamptz not null default now()
);

alter table public.guest_logins enable row level security;
alter table public.guest_usage enable row level security;

-- Only the teacher account may read guest data.
-- (Anon guests and students can only write through the RPCs below —
-- they can never read these tables.)
drop policy if exists "admin reads guest logins" on public.guest_logins;
create policy "admin reads guest logins" on public.guest_logins
    for select
    using ((auth.jwt() ->> 'email') = 'tywong@lstyoungkhl.edu.hk');

drop policy if exists "admin reads guest usage" on public.guest_usage;
create policy "admin reads guest usage" on public.guest_usage
    for select
    using ((auth.jwt() ->> 'email') = 'tywong@lstyoungkhl.edu.hk');

grant select on public.guest_logins to authenticated;
grant select on public.guest_usage to authenticated;

-- Helps the 24-hour delete and the dashboard's .gte query.
create index if not exists guest_logins_logged_in_at_idx
    on public.guest_logins (logged_in_at);
create index if not exists guest_usage_created_at_idx
    on public.guest_usage (created_at);

-- Rolling 24-hour delete: used on every guest write and on every dashboard
-- load/Refresh. Security definer so guests (anon) and the teacher can both
-- trigger it even though direct table deletes stay revoked.
create or replace function public.prune_guest_records()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Rolling last 24 hours, not a calendar day.
    delete from public.guest_logins
     where logged_in_at < now() - interval '24 hours';
    delete from public.guest_usage
     where created_at < now() - interval '24 hours';
end;
$$;

-- Called from the browser right after the guest password is accepted.
-- One row per password entry.
create or replace function public.record_guest_login(
    p_session_key text default null,
    p_user_agent  text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    p_session_key := left(coalesce(p_session_key, ''), 64);
    if p_session_key = '' then
        return;
    end if;
    perform public.prune_guest_records();
    insert into public.guest_logins (session_key, user_agent)
    values (p_session_key, left(coalesce(p_user_agent, ''), 300));
end;
$$;

-- Called from the browser on each meaningful guest activity.
-- Fire-and-forget: silently ignores empty keys / features.
create or replace function public.record_guest_usage(
    p_session_key text default null,
    p_feature     text default null,
    p_detail      text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    p_session_key := left(coalesce(p_session_key, ''), 64);
    p_feature     := left(coalesce(p_feature, ''), 60);
    if p_session_key = '' or p_feature = '' then
        return;
    end if;
    perform public.prune_guest_records();
    insert into public.guest_usage (session_key, feature, detail)
    values (p_session_key, p_feature, nullif(left(coalesce(p_detail, ''), 120), ''));
end;
$$;

-- Only the RPCs are callable; no direct table writes from the browser.
revoke all on function public.prune_guest_records() from public;
revoke all on function public.prune_guest_records() from anon;
revoke all on function public.prune_guest_records() from authenticated;
grant execute on function public.prune_guest_records() to anon, authenticated;

revoke all on function public.record_guest_login(text, text) from public;
revoke all on function public.record_guest_login(text, text) from anon;
revoke all on function public.record_guest_login(text, text) from authenticated;
grant execute on function public.record_guest_login(text, text) to anon, authenticated;

revoke all on function public.record_guest_usage(text, text, text) from public;
revoke all on function public.record_guest_usage(text, text, text) from anon;
revoke all on function public.record_guest_usage(text, text, text) from authenticated;
grant execute on function public.record_guest_usage(text, text, text) to anon, authenticated;

revoke insert, update, delete on public.guest_logins from anon;
revoke insert, update, delete on public.guest_logins from public;
revoke insert, update, delete on public.guest_usage from anon;
revoke insert, update, delete on public.guest_usage from public;

-- Check it worked:
-- select * from public.guest_logins order by logged_in_at desc;
-- select * from public.guest_usage order by created_at desc;
