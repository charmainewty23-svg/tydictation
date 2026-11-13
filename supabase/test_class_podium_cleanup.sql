-- LearniTY — remove the temporary class-battle podium fixture.
-- Run after testing; room code CAT5.
-- battle_players / battle_answers cascade from battle_rooms.

delete from public.battle_rooms where code = 'CAT5';

select count(*) as remaining_test_rooms
from public.battle_rooms
where code = 'CAT5';
