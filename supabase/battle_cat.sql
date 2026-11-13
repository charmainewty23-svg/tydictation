-- LearniTY — Word Battle cat looks.
-- Run once in the Supabase SQL editor of the live project. Safe to re-run.
--
-- Students already have permission to update their own battle_players row
-- ("battle players update own"), so the browser can save the chosen cat look
-- without a new RPC. Existing rows get the default look.

alter table public.battle_players
    add column if not exists cat text default 'Ginger',
    add column if not exists glasses text default 'None',
    add column if not exists hat text default 'None',
    add column if not exists outfit text default 'None';
