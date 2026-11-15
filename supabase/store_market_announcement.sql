-- LearniTY: announce the Second-hand Market to every user in the bell.
-- Run once in the Supabase SQL editor after supabase/store_market.sql.
-- Safe to re-run (the exact same message is only inserted once per user).

insert into public.friend_notifications (user_id, actor_id, kind, message)
select u.id, u.id, 'announcement',
       '🛒 New: the Second-hand Market is open! List your owned items, set your own price, and buy from classmates. Tap Store → 🛒 Market.'
  from auth.users u
 where not exists (
       select 1 from public.friend_notifications n
        where n.user_id = u.id
          and n.kind = 'announcement'
          and n.message like '🛒 New: the Second-hand Market is open!%'
 );

notify pgrst, 'reload schema';
