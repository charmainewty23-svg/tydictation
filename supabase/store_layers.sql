-- LearniTY Store: wearable layers (glasses + blush, scarf + coat, hat + headphones).
-- Run once in the Supabase SQL editor after supabase/store.sql. Safe to re-run.
--
-- Layer map:
--   head   hats            ears   Lo-Fi Headphones
--   eyes   glasses         cheeks Blush Stickers
--   neck   scarf/bow/ruff  body   coats/onesies/apron
--   prop / background unchanged
--
-- Class battle is intentionally untouched: it still reads one hat/face/outfit.

-- ---------- 1. allow the new layer names ----------
alter table public.store_items drop constraint if exists store_items_slot_check;
alter table public.store_items add constraint store_items_slot_check
    check (slot in ('head','ears','eyes','cheeks','neck','body','car','prop','background',
                    'hat','face','outfit'));

-- ---------- 2. move catalog items onto their wear layer ----------
update public.store_items set slot = 'ears'  where id = 'hat_lofi';
update public.store_items set slot = 'head'  where id like 'hat_%' and id <> 'hat_lofi';
update public.store_items set slot = 'cheeks' where id = 'face_blush';
update public.store_items set slot = 'eyes'  where id like 'face_%' and id <> 'face_blush';
update public.store_items set slot = 'neck'  where id in ('outfit_scarf','outfit_bowtie','outfit_bread','outfit_ruff');
update public.store_items set slot = 'body'  where id like 'outfit_%'
                                              and id not in ('outfit_scarf','outfit_bowtie','outfit_bread','outfit_ruff');

-- ---------- 3. move already-equipped rows to the new layer ----------
alter table public.store_equipped drop constraint if exists store_equipped_slot_check;
update public.store_equipped e
   set slot = i.slot
  from public.store_items i
 where i.id = e.item_id;
alter table public.store_equipped add constraint store_equipped_slot_check
    check (slot in ('head','ears','eyes','cheeks','neck','body','car','prop','background',
                    'hat','face','outfit'));

-- ---------- 4. profile look gets the extra layers ----------
alter table public.profile_looks add column if not exists ears   text not null default 'None';
alter table public.profile_looks add column if not exists cheeks text not null default 'None';
alter table public.profile_looks add column if not exists neck   text not null default 'None';
update public.profile_looks set ears = 'Lo-Fi Headphones', hat = 'None' where hat = 'Lo-Fi Headphones';
update public.profile_looks set cheeks = 'Blush Stickers', face = 'None' where face = 'Blush Stickers';
update public.profile_looks set neck = outfit, outfit = 'None'
 where outfit in ('Red Scarf','Tweed Bow Tie','Bread Collar','Shakespeare Ruff');

-- ---------- 5. save_profile_look with all layers ----------
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
    if v_cat not in ('Ginger', 'Ragdoll', 'Black', 'Siamese', 'British Shorthair', 'Garfield') then v_cat := 'Ginger'; end if;
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

-- ---------- 6. friend look returns every layer ----------
create or replace function public.friend_store_look(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_user_id is null then return '{}'::jsonb; end if;
    return (
        select jsonb_build_object(
            'cat', coalesce(pl.cat, 'Ginger'),
            'hat', coalesce(pl.hat, 'None'),
            'ears', coalesce(pl.ears, 'None'),
            'face', coalesce(pl.face, 'None'),
            'cheeks', coalesce(pl.cheeks, 'None'),
            'outfit', coalesce(pl.outfit, 'None'),
            'neck', coalesce(pl.neck, 'None'),
            'prop', coalesce((select e.item_id from public.store_equipped e
                               where e.user_id = p_user_id and e.slot = 'prop'), ''),
            'background', coalesce((select e.item_id from public.store_equipped e
                                     where e.user_id = p_user_id and e.slot = 'background'), '')
        )
          from (select 1) one
          left join public.profile_looks pl on pl.user_id = p_user_id
    );
end;
$fn$;

-- ---------- 7. equip validates the new layers ----------
create or replace function public.equip_store_item(p_slot text, p_item text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_item public.store_items;
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_slot not in ('head','ears','eyes','cheeks','neck','body','prop','background',
                      'hat','face','outfit') then
        raise exception 'INVALID_SLOT';
    end if;
    if p_item is null or trim(p_item) = '' then
        delete from public.store_equipped where user_id = v_me and slot = p_slot;
        return;
    end if;
    select * into v_item from public.store_items where id = p_item and active;
    if v_item.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if v_item.slot <> p_slot then raise exception 'WRONG_SLOT'; end if;
    if v_item.price > 0 and not exists (
        select 1 from public.store_purchases where user_id = v_me and item_id = p_item
    ) then
        raise exception 'NOT_OWNED';
    end if;
    insert into public.store_equipped (user_id, slot, item_id)
    values (v_me, p_slot, p_item)
    on conflict (user_id, slot) do update set item_id = excluded.item_id, updated_at = now();
end;
$fn$;

revoke all on function public.equip_store_item(text, text) from public;
grant execute on function public.equip_store_item(text, text) to authenticated;

notify pgrst, 'reload schema';
