-- ============================================================
-- LearniTY — New Vocab date scope for Word Battle
--
-- Run once in the live Supabase → SQL Editor:
--   https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--
-- Safe to re-run. This is the ONLY file needed for "Added yesterday":
-- do NOT re-run supabase/new_vocab.sql or
-- supabase/new_vocab_unassigned_read.sql just for this change.
-- Do not run it with a plugin, CLI or agent — paste it yourself.
--
-- What it does:
--   * battle_rooms.vocab_scope stores all / today / yesterday.
--   * Old rooms keep working: vocab_today = true becomes today,
--     everything else becomes all.
--   * set_battle_vocab() accepts an optional p_scope but still accepts
--     the old p_today_only boolean for older clients.
--   * "Today" and "yesterday" are Asia/Hong_Kong calendar days on
--     new_vocab_words.created_at (the day the teacher ADDED the word).
--   * Keeps the p_form = 'ALL' snapshot used by Unassigned hosts.
-- ============================================================

alter table public.battle_rooms
    add column if not exists vocab_scope text;

-- Backfill legacy rooms (and repair any blank / unknown value).
update public.battle_rooms
   set vocab_scope = case when coalesce(vocab_today, false) then 'today' else 'all' end
 where vocab_scope is null
    or btrim(vocab_scope) = ''
    or vocab_scope not in ('all', 'today', 'yesterday');

alter table public.battle_rooms
    alter column vocab_scope set default 'all';

alter table public.battle_rooms
    alter column vocab_scope set not null;

alter table public.battle_rooms
    drop constraint if exists battle_rooms_vocab_scope_check;

alter table public.battle_rooms
    add constraint battle_rooms_vocab_scope_check
    check (vocab_scope in ('all', 'today', 'yesterday'));

-- Replace both the old 3-argument shape and any previous 4-argument one.
drop function if exists public.set_battle_vocab(uuid, text, boolean, text);
drop function if exists public.set_battle_vocab(uuid, text, boolean);

create or replace function public.set_battle_vocab(
    p_room_id    uuid,
    p_form       text,
    p_today_only boolean default false,
    p_scope      text default null
) returns setof public.battle_rooms
language plpgsql
security definer
set search_path = public
as $set_battle_vocab$
declare
    v_room  public.battle_rooms;
    v_form  text := nullif(btrim(coalesce(p_form, '')), '');
    v_all   boolean;
    v_scope text;
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

    -- p_scope wins when it is a real value. Otherwise the old boolean is
    -- honoured (true = today), and anything else stays on the full bank.
    v_scope := lower(btrim(coalesce(p_scope, '')));
    if v_scope not in ('all', 'today', 'yesterday') then
        v_scope := case when coalesce(p_today_only, false) then 'today' else 'all' end;
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
            v_scope = 'all'
            or (w.created_at at time zone 'Asia/Hong_Kong')::date
               = ((now() at time zone 'Asia/Hong_Kong')::date
                  - case when v_scope = 'yesterday' then 1 else 0 end)
       );

    if v_count = 0 then
        if v_scope = 'today' then
            raise exception 'NO_VOCAB_TODAY';
        elsif v_scope = 'yesterday' then
            raise exception 'NO_VOCAB_YESTERDAY';
        end if;
        raise exception 'NO_VOCAB';
    end if;

    update public.battle_rooms
       set topic = 'New Vocab',
           vocab_form = case when v_all then 'ALL' else v_form end,
           vocab_scope = v_scope,
           vocab_today = (v_scope = 'today'),
           vocab_words = v_words,
           question_count = least(question_count, v_count)
     where id = p_room_id
    returning * into v_room;

    return next v_room;
end;
$set_battle_vocab$;

revoke all on function public.set_battle_vocab(uuid, text, boolean, text) from public, anon;
grant execute on function public.set_battle_vocab(uuid, text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
