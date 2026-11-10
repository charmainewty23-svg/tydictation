-- ============================================================
-- LearnITY — Unassigned / guest read access for New Vocab
--
-- Run in Supabase → SQL Editor after supabase/new_vocab.sql.
-- Safe to re-run. Does not change teacher write access.
--
-- Needed so that:
--   * a logged-in student with no form (Unassigned) can read
--     every form''s word bank (F3 + F4 + F6)
--   * a guest session (client-side password, no Google login)
--     can read the same bank with the public anon key
--   * an Unassigned student can open a Word Battle using all
--     forms at once (p_form = ALL)
--
-- If this file has not been run, Unassigned students and guests
-- will see an empty New Vocab list; the rest of the site still
-- works. Assigned students and the teacher are unchanged.
-- ============================================================

-- Authenticated students: own form, or every form when my_form() is null.
drop policy if exists "student reads own form vocab" on public.new_vocab_words;
create policy "student reads own form vocab" on public.new_vocab_words
    for select
    to authenticated
    using (
        form is not null
        and (
            public.my_form() is null
            or form = public.my_form()
        )
    );

-- Guests are not signed in with Google. They only get SELECT.
-- The word list is then readable with the public anon key already
-- embedded in the site. Insert / update / delete stay teacher-only.
drop policy if exists "guest reads new vocab" on public.new_vocab_words;
create policy "guest reads new vocab" on public.new_vocab_words
    for select
    to anon
    using (true);

grant select on public.new_vocab_words to anon;

-- Allow Unassigned hosts to freeze every form into one battle snapshot.
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
    v_all   boolean;
    v_words jsonb;
    v_count int;
begin
    if to_regclass('public.battle_rooms') is null then
        raise exception 'BATTLE_SQL_MISSING';
    end if;
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    v_all := (v_form is not null and upper(v_form) = 'ALL');
    if v_form is null or (not v_all and v_form !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,11}$') then
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
     where (v_all or w.form = v_form)
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
           vocab_form = case when v_all then 'ALL' else v_form end,
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
