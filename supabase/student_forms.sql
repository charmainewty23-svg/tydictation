-- ============================================================
-- LearnITY Dictation — year group (form) on each student
-- Run AFTER supabase/login_tracking.sql, once, in
-- Supabase → SQL Editor (project mggnwzirjmibreimrwiq).
-- Safe to re-run.
--
-- Form used to live only in the student's browser
-- (localStorage student_form_level). Dashboards cannot filter on that.
-- This adds student_logins.form plus two RPCs:
--   claim_own_form(p_form)     — student, fills NULL only
--   set_student_form(email, f) — teacher, assigns or clears
-- Allowed ids (F4, F6, …) are defined by FORM_LEVELS in index.html.
-- Null means Unassigned. Adding a form does not need another SQL change.
-- ============================================================

do $$
begin
    if to_regclass('public.student_logins') is null then
        raise exception 'Run supabase/login_tracking.sql first';
    end if;
end $$;

alter table public.student_logins
    add column if not exists form text;

comment on column public.student_logins.form is
    'Year group id from FORM_LEVELS in index.html (F4, F6, …). Null = unassigned.';

-- Student: keep a form chosen on this browser, but never overwrite a value
-- the teacher has already saved.
create or replace function public.claim_own_form(p_form text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid  uuid := auth.uid();
    v_form text := nullif(btrim(coalesce(p_form, '')), '');
begin
    if v_uid is null or v_form is null then
        return;
    end if;
    if v_form !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,11}$' then
        return;
    end if;

    insert into public.student_logins (user_id, email, form)
    values (v_uid, coalesce(auth.jwt() ->> 'email', ''), v_form)
    on conflict (user_id) do update
        set form  = coalesce(public.student_logins.form, excluded.form),
            email = coalesce(nullif(public.student_logins.email, ''), excluded.email);
end;
$$;

revoke all on function public.claim_own_form(text) from public, anon;
grant execute on function public.claim_own_form(text) to authenticated;

-- Teacher: set or clear any student's form. Empty string clears it.
create or replace function public.set_student_form(p_email text, p_form text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_form text := nullif(btrim(coalesce(p_form, '')), '');
    v_uid  uuid;
    v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
    if coalesce(auth.jwt() ->> 'email', '') is distinct from 'tywong@lstyoungkhl.edu.hk' then
        raise exception 'not allowed';
    end if;
    if v_email is null then
        raise exception 'email required';
    end if;
    if v_form is not null and v_form !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,11}$' then
        raise exception 'invalid form';
    end if;

    update public.student_logins
       set form = v_form
     where lower(email) = lower(v_email);

    if found then
        return;
    end if;

    select u.id into v_uid
      from auth.users u
     where lower(u.email) = lower(v_email)
     limit 1;

    if v_uid is null then
        raise exception 'student not found';
    end if;

    insert into public.student_logins (user_id, email, form, login_count)
    values (v_uid, lower(v_email), v_form, 0)
    on conflict (user_id) do update
        set form = excluded.form,
            email = excluded.email;
end;
$$;

revoke all on function public.set_student_form(text, text) from public, anon;
grant execute on function public.set_student_form(text, text) to authenticated;

-- Check it worked:
-- select email, form from public.student_logins order by email;
