-- LearniTY: introduce Speak Flap in every user's notification bell.
-- Run once in the Supabase SQL editor (after supabase/friends.sql and
-- supabase/friend_announcement.sql, which add the announcement kind).
-- Safe to re-run: the same message is only inserted once per user.

insert into public.friend_notifications (user_id, actor_id, kind, message)
select u.id, u.id, 'announcement',
       '🃏 New: Speak Flap — read the phrase out loud and fly through the gate. 2:45 · 5 lives. Fluency Master → 🃏 Speak Flap.'
  from auth.users u
 where not exists (
       select 1 from public.friend_notifications n
        where n.user_id = u.id
          and n.kind = 'announcement'
          and n.message like '🃏 New: Speak Flap%'
 );

notify pgrst, 'reload schema';
