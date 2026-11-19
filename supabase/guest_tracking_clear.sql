-- ============================================================
-- LearnITY Dictation — guest records: teacher「清除全部」(Clear all)
-- (incremental add-on for an install that already has guest_tracking.sql)
--
-- RUN THIS IN THE LIVE PROJECT'S SQL EDITOR:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
-- Safe to re-run.
--
-- This file is for teachers who ALREADY pasted supabase/guest_tracking.sql
-- (and optionally supabase/guest_tracking_prune.sql). A brand-new install only
-- needs the updated supabase/guest_tracking.sql — it already contains the
-- function below.
--
-- Do NOT paste any older Drive & Go incremental SQL for this change
-- (drive_and_go.sql, drive_and_go_question_count.sql,
--  drive_and_go_scenes_and_boards.sql, etc.). Never apply this file with a
-- plugin/CLI — paste it in the SQL Editor yourself.
--
-- What it adds: public.clear_guest_records(), called by the admin dashboard's
-- 「清除全部」button next to ↻ Refresh on the「🕵️ Guest logins」card.
--   * deletes EVERY row from guest_logins AND guest_usage (a full wipe, not
--     the rolling 24-hour prune above — that one lives in
--     guest_tracking_prune.sql and is unchanged)
--   * refuses anyone who is not tywong@lstyoungkhl.edu.hk
--   * execute is granted to authenticated only; anon can never call it
--   * direct table DELETE stays revoked, so the RPC is the only path
--
-- This action cannot be undone. Guest logins and browsing records are
-- re-created normally the next time a guest signs in.
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

-- Teacher-only full wipe. Security definer so the tables' own RLS does not
-- block the delete, with the teacher check repeated inside the body.
create or replace function public.clear_guest_records()
returns void
language plpgsql
security definer
set search_path = public
as $clear$
begin
    if (auth.jwt() ->> 'email') is distinct from 'tywong@lstyoungkhl.edu.hk' then
        raise exception 'not authorized';
    end if;
    delete from public.guest_logins;
    delete from public.guest_usage;
end;
$clear$;

-- Authenticated only — deliberately NOT anon.
revoke all on function public.clear_guest_records() from public;
revoke all on function public.clear_guest_records() from anon;
revoke all on function public.clear_guest_records() from authenticated;
grant execute on function public.clear_guest_records() to authenticated;

-- No direct table deletes from the browser either (unchanged).
revoke delete on public.guest_logins from anon;
revoke delete on public.guest_logins from public;
revoke delete on public.guest_usage from anon;
revoke delete on public.guest_usage from public;

-- Check it worked (both should return 0 after the button is pressed):
-- select count(*) from public.guest_logins;
-- select count(*) from public.guest_usage;
