-- ============================================================
-- LearnITY Dictation — guest records: rolling 24-hour retention
-- (incremental add-on for an install that already has guest_tracking.sql)
--
-- RUN THIS IN THE LIVE PROJECT'S SQL EDITOR:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
-- Safe to re-run.
--
-- This file is for teachers who ALREADY pasted supabase/guest_tracking.sql.
-- A brand-new install only needs the updated supabase/guest_tracking.sql
-- (it already contains the function below).
--
-- Do NOT paste any older Drive & Go incremental SQL for this change
-- (drive_and_go.sql, drive_and_go_question_count.sql,
--  drive_and_go_scenes_and_boards.sql, etc.). Never apply this file with a
-- plugin/CLI — paste it in the SQL Editor yourself.
--
-- Retention rule: a ROLLING last 24 hours (now() - interval '24 hours'),
-- NOT an Asia/Hong_Kong calendar day. Rows in guest_logins / guest_usage
-- older than that are deleted from the database, not merely hidden in the
-- dashboard. The frontend uses the same cutoff (GUEST_RETENTION_MS in
-- js/shared.js).
--
-- Guest privacy is unchanged: guests still never appear in student_logins,
-- scores or leaderboards, and only the teacher account can read these tables.
-- ============================================================

-- Defensive: if guest_tracking.sql was never pasted, make the tables exist
-- so this file is safe to run on its own. Existing tables are untouched.
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

-- Only the teacher account may read guest data (unchanged).
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

-- Rolling 24-hour delete, used on every guest write and on every dashboard
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

revoke all on function public.prune_guest_records() from public;
revoke all on function public.prune_guest_records() from anon;
revoke all on function public.prune_guest_records() from authenticated;
grant execute on function public.prune_guest_records() to anon, authenticated;

-- Same RPCs as before, now pruning stale rows before they insert.
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

revoke all on function public.record_guest_login(text, text) from public;
revoke all on function public.record_guest_login(text, text) from anon;
revoke all on function public.record_guest_login(text, text) from authenticated;
grant execute on function public.record_guest_login(text, text) to anon, authenticated;

revoke all on function public.record_guest_usage(text, text, text) from public;
revoke all on function public.record_guest_usage(text, text, text) from anon;
revoke all on function public.record_guest_usage(text, text, text) from authenticated;
grant execute on function public.record_guest_usage(text, text, text) to anon, authenticated;

-- No direct table writes from the browser (unchanged).
revoke insert, update, delete on public.guest_logins from anon;
revoke insert, update, delete on public.guest_logins from public;
revoke insert, update, delete on public.guest_usage from anon;
revoke insert, update, delete on public.guest_usage from public;

-- Check it worked:
-- select count(*) from public.guest_logins where logged_in_at >= now() - interval '24 hours';
-- select count(*) from public.guest_usage  where created_at  >= now() - interval '24 hours';
