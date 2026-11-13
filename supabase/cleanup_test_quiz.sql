-- LearniTY — optional cleanup for the teacher-account test quiz done on
-- 2026-11-13 16:29 HKT (topic "New Vocab", recitation, correct 4/4).
--
-- DO NOT run this unless you want to remove that test record.
-- Deleting the quiz does not automatically roll back the streak it created,
-- so this file also restores the teacher's pre-test streak values.
--
-- Run the whole file in the Supabase SQL editor (postgres bypasses RLS).

-- 1) Delete the test quiz row.
delete from public.dictation_results
where user_id = '3c922ca5-ab23-4a2b-8d05-22bcf4f0ae60'
  and created_at = '2026-11-13T08:29:57.305707+00:00';

-- 2) Restore the teacher's streak to the pre-test state
--    (4 days, ended 2026-11-12, 3 repair cards).
--    If the teacher has done more practices since this test, adjust or skip
--    this update so you do not erase newer progress.
update public.user_streaks
set streak_count = 4,
    streak_best = 4,
    last_practice_date = '2026-11-12',
    repair_cards = 3,
    recent_days = '["2026-11-09","2026-11-10","2026-11-11","2026-11-12"]'::jsonb,
    updated_at = now()
where user_id = '3c922ca5-ab23-4a2b-8d05-22bcf4f0ae60';

-- 3) Check the result.
select user_id, streak_count, streak_best, last_practice_date, repair_cards, recent_days
from public.user_streaks
where user_id = '3c922ca5-ab23-4a2b-8d05-22bcf4f0ae60';
