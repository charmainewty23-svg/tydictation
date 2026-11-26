-- ============================================================================
-- LearniTY · Purr-fect Survival — fix bigint out of range on Round 1 → Round 2
-- ============================================================================
--
-- WHAT THIS DOES
--   Fixes "bigint out of range" when Round 1 tries to start the
--   Glass Stepping Stones bridge. purrfect_survival_glass_order() mirrored the
--   JavaScript mulberry32 mixer in uint32, but two multiplies ran in signed
--   bigint BEFORE the 32-bit mask. Each operand can be up to 4294967295, so
--   the product (~1.84e19) overflows signed bigint (max 9223372036854775807)
--   and Postgres throws before the mask is applied.
--
--   This file wraps those two multiplies with numeric modulo
--   (mod(... ::numeric, 4294967296)) so they cannot overflow. The FNV-1a seed,
--   mulberry32 steps and Fisher-Yates shuffle are unchanged, so the result is
--   the SAME permutation as PSEngine.glassOrderForPlayer().
--
--   After this runs, End round 1 / the automatic tick can move a room that is
--   stuck in round1 into Round 2.
--
-- HOW TO INSTALL
--   1. Open the live Supabase project (mggnwzirjmibreimrwiq) SQL editor:
--      https://supabase.com/dashboard/project/mggnwzirjmibreimrwiq/sql/new
--   2. Clear the editor completely.
--   3. Paste this whole file and Run once.
--   4. Run it AFTER the existing Survival incrementals (including
--      purrfect_survival_round2_answers.sql and the Dalgona file). The
--      already-applied older files must not be re-run.
--
-- Safe to re-run. Do NOT re-run older incrementals after this file.
-- Do NOT run this through a plugin, CLI or agent — paste it in the SQL editor.
-- No tables, columns or data are changed. This only replaces
-- public.purrfect_survival_glass_order.
-- ============================================================================

create or replace function public.purrfect_survival_glass_order(
    p_seed bigint,
    p_user uuid,
    p_len int
) returns jsonb
language plpgsql
immutable
as $$
declare
    v_len int := greatest(1, least(15, coalesce(p_len, 9)));
    v_text text;
    v_hash bigint := 2166136261;
    v_a bigint;
    v_t bigint;
    v_u bigint;
    v_i int;
    v_j int;
    v_tmp int;
    v_arr int[] := '{}';
    v_out jsonb := '[]'::jsonb;
begin
    v_text := coalesce(p_seed, 1)::text || '|' || coalesce(p_user::text, '') || '|glass';
    for v_i in 1..char_length(v_text) loop
        v_hash := ((v_hash # ascii(substr(v_text, v_i, 1))) * 16777619) & 4294967295;
    end loop;

    for v_i in 0..v_len - 1 loop
        v_arr := v_arr || v_i;
    end loop;

    v_a := v_hash;
    v_i := v_len - 1;
    while v_i > 0 loop
        v_a := (v_a + 1831565813) & 4294967295;
        v_t := (v_a # (v_a >> 15)) & 4294967295;
        -- uint32 multiply: the raw product can exceed signed bigint, so wrap it
        -- with numeric modulo 2^32 before casting back to bigint.
        v_t := mod(v_t::numeric * ((1 | v_a) & 4294967295)::numeric, 4294967296)::bigint;
        v_u := (v_t # (v_t >> 7)) & 4294967295;
        -- uint32 multiply: same overflow guard as above.
        v_u := mod(v_u::numeric * ((61 | v_t) & 4294967295)::numeric, 4294967296)::bigint;
        v_t := ((v_t + v_u) & 4294967295) # v_t;
        v_j := floor(
            ((((v_t # (v_t >> 14)) & 4294967295)::double precision) / 4294967296.0)
            * (v_i + 1)
        )::int;
        v_tmp := v_arr[v_i + 1];
        v_arr[v_i + 1] := v_arr[v_j + 1];
        v_arr[v_j + 1] := v_tmp;
        v_i := v_i - 1;
    end loop;

    for v_i in 1..v_len loop
        v_out := v_out || to_jsonb(v_arr[v_i]);
    end loop;
    return v_out;
end;
$$;

notify pgrst, 'reload schema';
