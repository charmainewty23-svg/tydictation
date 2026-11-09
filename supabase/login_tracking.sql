-- ============================================================
-- LearnITY Dictation — student login tracking
-- Run this once in Supabase → SQL Editor (project mggnwzirjmibreimrwiq)
-- Safe to re-run.
-- ============================================================

create table if not exists public.student_logins (
    user_id        uuid primary key references auth.users(id) on delete cascade,
    email          text not null,
    nickname       text,
    first_login_at timestamptz not null default now(),
    last_login_at  timestamptz not null default now(),
    login_count    int not null default 1,
    user_agent     text
);

alter table public.student_logins enable row level security;

-- Only the teacher account may read the log.
-- (Students can still write their own row, but only through record_login().)
drop policy if exists "admin reads logins" on public.student_logins;
create policy "admin reads logins" on public.student_logins
    for select
    using ((auth.jwt() ->> 'email') = 'tywong@lstyoungkhl.edu.hk');

grant select on public.student_logins to authenticated;

-- Upsert called from the browser on every sign-in.
-- login_count only increases when the previous login was >12h ago,
-- so page refreshes / token refreshes do not inflate the number.
create or replace function public.record_login(
    p_nickname   text default null,
    p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        return;
    end if;

    insert into public.student_logins (user_id, email, nickname, user_agent)
    values (
        auth.uid(),
        coalesce(auth.jwt() ->> 'email', ''),
        p_nickname,
        left(p_user_agent, 200)
    )
    on conflict (user_id) do update set
        email         = excluded.email,
        nickname      = coalesce(excluded.nickname, public.student_logins.nickname),
        user_agent    = coalesce(excluded.user_agent, public.student_logins.user_agent),
        login_count   = public.student_logins.login_count
                        + case when public.student_logins.last_login_at < now() - interval '12 hours'
                               then 1 else 0 end,
        last_login_at = now();
end;
$$;

revoke all on function public.record_login(text, text) from anon;
grant execute on function public.record_login(text, text) to authenticated;

-- Check it worked:
-- select email, nickname, login_count, last_login_at from public.student_logins
-- order by last_login_at desc;
