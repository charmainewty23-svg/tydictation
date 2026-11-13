-- LearniTY — record correct answers so the Me page can show average accuracy.
-- Run once in the Supabase SQL editor of the live project. Safe to re-run.
--
-- dictation_results already exists (created in the Google-login phase).
-- Existing rows keep correct = NULL because the old app never sent it; the
-- Me page skips NULL rows and shows accuracy from quizzes recorded after this
-- change. New inserts include correct automatically.

alter table public.dictation_results
    add column if not exists correct int;

create index if not exists dictation_results_user_created_idx
    on public.dictation_results (user_id, created_at desc);
