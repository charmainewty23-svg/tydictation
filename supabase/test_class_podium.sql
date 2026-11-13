-- LearniTY — temporary fixture for testing the class-battle prize stand.
-- Run in the Supabase SQL editor, then join room code CAT5 as the teacher.
-- Clean up with supabase/test_class_podium_cleanup.sql afterwards.
--
-- It uses five existing students from student_logins (no dummy accounts) and
-- gives each a different cat look. The room is already finished, so the
-- teacher's class board should show the podium with those five cats.

delete from public.battle_rooms where code = 'CAT5';

with host as (
    select id
    from auth.users
    where email = 'tywong@lstyoungkhl.edu.hk'
    limit 1
),
new_room as (
    insert into public.battle_rooms (
        code, topic, seed, question_count, host_id, status, mode,
        max_players, started_at, finished_at
    )
    select
        'CAT5', 'charity', 424242, 10, host.id, 'finished', 'class',
        60, now() - interval '10 minutes', now()
    from host
    returning id
),
students as (
    select user_id, email, nickname,
           row_number() over (order by last_login_at desc) as rn
    from public.student_logins
    where user_id is not null
    order by last_login_at desc
    limit 5
)
insert into public.battle_players (
    room_id, user_id, email, nickname,
    score, correct, total_ms, done, progress,
    cat, glasses, hat, outfit
)
select
    new_room.id,
    s.user_id,
    s.email,
    coalesce(s.nickname, split_part(s.email, '@', 1)),
    case s.rn when 1 then 100 when 2 then 90 when 3 then 80 when 4 then 70 else 60 end,
    case s.rn when 1 then 10 when 2 then 9 when 3 then 8 when 4 then 7 else 6 end,
    30000 + s.rn * 1000,
    true,
    10,
    case s.rn when 1 then 'Ragdoll' when 2 then 'Black' when 3 then 'Siamese' when 4 then 'Ginger' else 'Ragdoll' end,
    case s.rn when 1 then 'Sunglasses' when 2 then 'None' when 3 then 'Glasses' else 'None' end,
    case s.rn when 1 then 'Crown' when 2 then 'Party Hat' when 3 then 'None' else 'None' end,
    case s.rn when 1 then 'Superhero Cape' when 2 then 'Red Scarf' when 3 then 'Racing Jacket' else 'None' end
from students s
cross join new_room;

select r.code, r.status, r.mode, count(p.user_id) as players
from public.battle_rooms r
left join public.battle_players p on p.room_id = r.id
where r.code = 'CAT5'
group by r.code, r.status, r.mode;
