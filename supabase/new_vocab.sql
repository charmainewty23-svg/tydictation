-- ============================================================
-- LearnITY — New Vocab (per-form live list) + error book
--          + Word Battle snapshot of that list
--
-- Run in Supabase → SQL Editor (project mggnwzirjmibreimrwiq).
-- Safe to re-run.
--
-- Order:
--   1. supabase/login_tracking.sql
--   2. supabase/student_forms.sql
--   3. supabase/battle.sql through battle_question_count.sql
--      (needed only for New Vocab inside Word Battle)
--   4. this file
--
-- One row is one saved card. English, Chinese, or both may be filled
-- (a completely blank card is rejected). Chinese-only cards stay in the
-- bank; Word Battle copies only rows that have English.
-- Re-run this file after the battle SQL to enable battle snapshots.
-- ============================================================

create table if not exists public.new_vocab_words (
    id         bigserial primary key,
    form       text not null,
    en         text not null,
    zh         text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.new_vocab_words drop constraint if exists new_vocab_words_has_text;
alter table public.new_vocab_words
    add constraint new_vocab_words_has_text
    check (btrim(coalesce(en, '')) <> '' or btrim(coalesce(zh, '')) <> '');

alter table public.new_vocab_words
    add column if not exists created_at timestamptz not null default now();

create index if not exists new_vocab_words_form_idx
    on public.new_vocab_words (form, id);

create or replace function public.touch_new_vocab_word()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists new_vocab_touch on public.new_vocab_words;
create trigger new_vocab_touch
    before insert or update on public.new_vocab_words
    for each row execute function public.touch_new_vocab_word();

-- The student's own form. security definer so RLS on student_logins
-- does not hide the row from the student who owns it.
create or replace function public.my_form()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select form
    from public.student_logins
    where user_id = auth.uid();
$$;

revoke all on function public.my_form() from public, anon;
grant execute on function public.my_form() to authenticated;

alter table public.new_vocab_words enable row level security;

drop policy if exists "teacher manages new vocab" on public.new_vocab_words;
create policy "teacher manages new vocab" on public.new_vocab_words
    for all
    using ((auth.jwt() ->> 'email') = 'tywong@lstyoungkhl.edu.hk')
    with check ((auth.jwt() ->> 'email') = 'tywong@lstyoungkhl.edu.hk');

drop policy if exists "student reads own form vocab" on public.new_vocab_words;
create policy "student reads own form vocab" on public.new_vocab_words
    for select
    to authenticated
    using (form is not null and form = public.my_form());

grant select, insert, update, delete on public.new_vocab_words to authenticated;
grant usage, select on sequence public.new_vocab_words_id_seq to authenticated;

-- ------------------------------------------------------------
-- Personal error book. One row per student per English answer.
-- ------------------------------------------------------------
create table if not exists public.error_book (
    id         bigserial primary key,
    user_id    uuid not null references auth.users(id) on delete cascade,
    en         text not null,
    zh         text,
    topic      text,
    created_at timestamptz not null default now(),
    unique (user_id, en)
);

create index if not exists error_book_user_idx on public.error_book (user_id, created_at);

alter table public.error_book enable row level security;

drop policy if exists "own error book" on public.error_book;
create policy "own error book" on public.error_book
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

grant select, insert, update, delete on public.error_book to authenticated;
grant usage, select on sequence public.error_book_id_seq to authenticated;

-- ------------------------------------------------------------
-- Word Battle: freeze one form's list onto the room so every
-- player (any form) rebuilds the same seeded question list.
-- Skipped with a notice if battle_rooms does not exist yet.
-- ------------------------------------------------------------
do $$
begin
    if to_regclass('public.battle_rooms') is null then
        raise notice 'battle_rooms is missing. Re-run supabase/new_vocab.sql after the battle SQL to enable New Vocab battles.';
        return;
    end if;
    execute 'alter table public.battle_rooms add column if not exists vocab_form text';
    execute 'alter table public.battle_rooms add column if not exists vocab_words jsonb';
    execute 'alter table public.battle_rooms add column if not exists vocab_today boolean not null default false';
end $$;

drop function if exists public.set_battle_vocab(uuid, text);

create or replace function public.set_battle_vocab(
    p_room_id    uuid,
    p_form       text,
    p_today_only boolean default false
) returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room  public.battle_rooms;
    v_form  text := nullif(btrim(coalesce(p_form, '')), '');
    v_words jsonb;
    v_count int;
begin
    if to_regclass('public.battle_rooms') is null then
        raise exception 'BATTLE_SQL_MISSING';
    end if;
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    if v_form is null or v_form !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,11}$' then
        raise exception 'invalid form';
    end if;

    select * into v_room from public.battle_rooms where id = p_room_id;
    if not found then
        raise exception 'ROOM_NOT_FOUND';
    end if;
    if v_room.host_id is distinct from auth.uid() then
        raise exception 'NOT_A_MEMBER';
    end if;
    if v_room.status <> 'waiting' then
        raise exception 'ROOM_ALREADY_STARTED';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('en', w.en, 'zh', w.zh) order by w.id), '[]'::jsonb),
           count(*)
      into v_words, v_count
      from public.new_vocab_words w
     where w.form = v_form
       and btrim(coalesce(w.en, '')) <> ''
       and (
            not coalesce(p_today_only, false)
            or (w.created_at at time zone 'Asia/Hong_Kong')::date
               = (now() at time zone 'Asia/Hong_Kong')::date
       );

    if v_count = 0 then
        if coalesce(p_today_only, false) then
            raise exception 'NO_VOCAB_TODAY';
        end if;
        raise exception 'NO_VOCAB';
    end if;

    update public.battle_rooms
       set topic = 'New Vocab',
           vocab_form = v_form,
           vocab_today = coalesce(p_today_only, false),
           vocab_words = v_words,
           question_count = least(question_count, v_count)
     where id = p_room_id
    returning * into v_room;

    return next v_room;
end;
$$;

revoke all on function public.set_battle_vocab(uuid, text, boolean) from public, anon;
grant execute on function public.set_battle_vocab(uuid, text, boolean) to authenticated;

-- Check:
-- select form, en, zh, updated_at from public.new_vocab_words order by form, id;
-- select email, en from public.error_book order by created_at desc limit 20;
