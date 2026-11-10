-- ============================================================
-- LearnITY Dictation — form_source + safer automatic claims
-- Run AFTER supabase/student_forms.sql, once, in
-- Supabase → SQL Editor (project mggnwzirjmibreimrwiq).
-- Safe to re-run. The live site keeps working if this is not
-- applied yet: teacher pages already ignore an automatic /
-- unknown stored form when the displayed name has no class
-- code (e.g. "Liu Chun Ming" must be Unassigned, not F6).
--
-- This file:
--   1. Adds student_logins.form_source
--        teacher = set by the teacher dropdown (set_student_form)
--        auto    = claimed from a class code in the displayed name
--        null    = Unassigned
--   2. Lets claim_own_form(''):
--        - write a class-code form as source=auto when empty
--        - update a previous auto claim if the class code changed
--        - release an automatic / unknown claim when p_form is empty
--        - never overwrite a teacher assignment
--   3. Records form_source='teacher' on set_student_form
--   4. Clears stored forms that cannot have come from a class
--      code at the start of the nickname, unless the teacher
--      already marked them (form_source = teacher). This is how
--      a previously wrong automatic F6 for "Liu Chun Ming" is
--      corrected in the database. If you already assigned a form
--      by dropdown to a student whose name has no class code,
--      and you did that before this file was run, re-assign them
--      after this runs.
-- ============================================================

do $$
begin
    if to_regclass('public.student_logins') is null then
        raise exception 'Run supabase/login_tracking.sql first';
    end if;
    if not exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'student_logins'
           and column_name = 'form'
    ) then
        raise exception 'Run supabase/student_forms.sql first';
    end if;
end $$;

alter table public.student_logins
    add column if not exists form_source text;

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
