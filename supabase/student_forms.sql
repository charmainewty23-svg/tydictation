-- ============================================================
-- LearnITY Dictation — year group (form) on each student
-- Run AFTER supabase/login_tracking.sql, once, in
-- Supabase → SQL Editor (project mggnwzirjmibreimrwiq).
-- Safe to re-run.
--
-- Form used to live only in the student's browser
-- (localStorage student_form_level). Dashboards cannot filter on that.
-- This adds student_logins.form plus two RPCs:
--   claim_own_form(p_form)     — student, from a class code in the
--                                displayed name; never overwrites teacher
--   set_student_form(email, f) — teacher, assigns or clears
-- Allowed ids (F3, F4, F6, …) are defined by FORM_LEVELS in index.html.
-- Null means Unassigned. Adding a form does not need another SQL change.
--
-- If you already ran an earlier copy of this file, run
-- supabase/student_forms_source.sql instead (or re-run this updated
-- file). That follow-up is also safe to re-run and does not break the
-- site if it has not been applied yet.
-- ============================================================

do $$
begin
    if to_regclass('public.student_logins') is null then
        raise exception 'Run supabase/login_tracking.sql first';
    end if;
end $$;

alter table public.student_logins
    add column if not exists form text;

alter table public.student_logins
    add column if not exists form_source text;

comment on column public.student_logins.form is
    'Year group id from FORM_LEVELS in index.html (F3, F4, F6, …). Null = unassigned.';

comment on column public.student_logins.form_source is
    'teacher = set by set_student_form; auto = claim_own_form from a class code in the displayed name; null when unassigned.';

-- Student login: claim from a class code in the displayed name,
-- or release a previous automatic claim. Never overwrite teacher.
create or replace function public.claim_own_form(p_form text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid  uuid := auth.uid();
    v_form text := nullif(btrim(coalesce(p_form, '')), '');
    v_source text;
    v_existing text;
begin
    if v_uid is null then
        return;
    end if;
    if v_form is not null and v_form !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,11}$' then
        return;
    end if;

    select form, form_source into v_existing, v_source
      from public.student_logins
     where user_id = v_uid;

    if v_form is null then
        if v_existing is not null and coalesce(v_source, '') is distinct from 'teacher' then
            update public.student_logins
               set form = null,
                   form_source = null
             where user_id = v_uid;
        end if;
        return;
    end if;

    if coalesce(v_source, '') = 'teacher' and v_existing is not null then
        return;
    end if;

    insert into public.student_logins (user_id, email, form, form_source)
    values (v_uid, coalesce(auth.jwt() ->> 'email', ''), v_form, 'auto')
    on conflict (user_id) do update
        set form = case
                when coalesce(public.student_logins.form_source, '') = 'teacher'
                     and public.student_logins.form is not null
                then public.student_logins.form
                else excluded.form
            end,
            form_source = case
                when coalesce(public.student_logins.form_source, '') = 'teacher'
                     and public.student_logins.form is not null
                then public.student_logins.form_source
                else 'auto'
            end,
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
       set form = v_form,
           form_source = case when v_form is null then null else 'teacher' end
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

    insert into public.student_logins (user_id, email, form, form_source, login_count)
    values (
        v_uid,
        lower(v_email),
        v_form,
        case when v_form is null then null else 'teacher' end,
        0
    )
    on conflict (user_id) do update
        set form = excluded.form,
            form_source = excluded.form_source,
            email = excluded.email;
end;
$$;

revoke all on function public.set_student_form(text, text) from public, anon;
grant execute on function public.set_student_form(text, text) to authenticated;

create or replace function public.my_form_source()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select form_source
      from public.student_logins
     where user_id = auth.uid();
$$;

revoke all on function public.my_form_source() from public, anon;
grant execute on function public.my_form_source() to authenticated;


-- Clear automatic / unknown stored forms when the displayed nickname has
-- no class code at the start (e.g. "Liu Chun Ming" wrongly stored as F6).
-- Does not touch rows the teacher assigned after form_source exists.
update public.student_logins
   set form = null,
       form_source = null
 where coalesce(form_source, '') is distinct from 'teacher'
   and form is not null
   and (
        nullif(btrim(coalesce(nickname, '')), '') is null
        or btrim(nickname) !~* '^(form[[:space:]]*|f\.?[[:space:]]*)?[346][a-z]($|[^a-z])'
   );

-- Check it worked:
-- select email, nickname, form, form_source from public.student_logins order by email;
