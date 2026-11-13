-- LearniTY — one short in-app announcement in every user's notification bell.
-- Run once in the Supabase SQL editor. Safe to re-run (same message is deduped).

alter table public.friend_notifications
    add column if not exists message text;

-- The original table only allowed 'follow' / 'like'. Replace that check with
-- one that also allows 'announcement'.
do $do$
declare
    r record;
begin
    for r in
        select oid, conname
          from pg_constraint
         where conrelid = 'public.friend_notifications'::regclass
           and contype = 'c'
    loop
        if pg_get_constraintdef(r.oid) ilike '%kind%' then
            execute format('alter table public.friend_notifications drop constraint %I', r.conname);
        end if;
    end loop;
end;
$do$;

alter table public.friend_notifications
    add constraint friend_notifications_kind_check
    check (kind in ('follow', 'like', 'announcement'));

-- Recreate the feed with the message column and the LearniTY sender name.
drop function if exists public.friend_notification_feed();

create or replace function public.friend_notification_feed()
returns table (
    id uuid,
    kind text,
    actor_name text,
    achievement_kind text,
    achievement_value int,
    message text,
    created_at timestamptz,
    read_at timestamptz
)
language sql
security definer
set search_path = public
as $fn$
    select n.id,
        n.kind,
        case when n.kind = 'announcement' then 'LearniTY'
             else coalesce(nullif(sl.nickname, ''),
                           nullif(split_part(au.email, '@', 1), ''),
                           'Student')
        end as actor_name,
        a.kind as achievement_kind,
        a.value as achievement_value,
        n.message,
        n.created_at,
        n.read_at
      from public.friend_notifications n
      left join public.student_logins sl on sl.user_id = n.actor_id
      left join auth.users au on au.id = n.actor_id
      left join public.streak_achievements a on a.id = n.achievement_id
     where n.user_id = auth.uid()
     order by n.created_at desc
     limit 30;
$fn$;

revoke all on function public.friend_notification_feed() from public;
grant execute on function public.friend_notification_feed() to authenticated;

-- Broadcast the short message to every account. Re-running with the same
-- text does not duplicate it.
insert into public.friend_notifications(user_id, actor_id, kind, message)
select u.id, u.id, 'announcement',
       'New: 💛 Add friends in Me → Friends, and 🔥 grow a friend streak by practising on the same Hong Kong day.'
  from auth.users u
 where not exists (
       select 1 from public.friend_notifications n
        where n.user_id = u.id
          and n.kind = 'announcement'
          and n.message = 'New: 💛 Add friends in Me → Friends, and 🔥 grow a friend streak by practising on the same Hong Kong day.'
 );
