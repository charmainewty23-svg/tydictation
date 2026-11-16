-- LearniTY — extra cat colours for Me → My look (2026-11)
--
-- Run this once in the Supabase SQL editor if you already installed store.sql
-- (or store_layers.sql). Safe to re-run.
--
-- save_profile_look() used to accept only Ginger / Ragdoll / Black / Siamese and
-- silently rewrote anything else to Ginger, so a British Shorthair or Garfield
-- profile cat would not survive a reload or reach another device. This file
-- redefines the function with the two new cats. Nothing else is changed.

drop function if exists public.save_profile_look(text, text, text, text);
create or replace function public.save_profile_look(
    p_cat text,
    p_hat text,
    p_face text,
    p_outfit text,
    p_ears text default 'None',
    p_cheeks text default 'None',
    p_neck text default 'None'
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_cat text := coalesce(nullif(trim(p_cat), ''), 'Ginger');
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if v_cat not in ('Ginger', 'Ragdoll', 'Black', 'Siamese', 'British Shorthair', 'Garfield') then
        v_cat := 'Ginger';
    end if;
    insert into public.profile_looks (user_id, cat, hat, face, outfit, ears, cheeks, neck)
    values (
        v_me,
        v_cat,
        left(coalesce(nullif(trim(p_hat), ''), 'None'), 60),
        left(coalesce(nullif(trim(p_face), ''), 'None'), 60),
        left(coalesce(nullif(trim(p_outfit), ''), 'None'), 60),
        left(coalesce(nullif(trim(p_ears), ''), 'None'), 60),
        left(coalesce(nullif(trim(p_cheeks), ''), 'None'), 60),
        left(coalesce(nullif(trim(p_neck), ''), 'None'), 60)
    )
    on conflict (user_id) do update set
        cat = excluded.cat,
        hat = excluded.hat,
        face = excluded.face,
        outfit = excluded.outfit,
        ears = excluded.ears,
        cheeks = excluded.cheeks,
        neck = excluded.neck,
        updated_at = now();
end;
$fn$;

revoke all on function public.save_profile_look(text, text, text, text, text, text, text) from public;
grant execute on function public.save_profile_look(text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
