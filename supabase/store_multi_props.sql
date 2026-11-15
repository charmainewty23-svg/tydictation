-- LearniTY Store: multiple Props & Companions + higher prop prices.
-- Run once in the Supabase SQL editor after supabase/store.sql. Safe to re-run.

-- ---------- 1. new prop prices (+40 Paws each) ----------
update public.store_items set price = 470 where id = 'prop_white_flag';
update public.store_items set price = 480 where id = 'prop_rubber_duck';
update public.store_items set price = 490 where id = 'prop_red_pen';
update public.store_items set price = 500 where id = 'prop_tea_scone';
update public.store_items set price = 510 where id = 'prop_corgi';
update public.store_items set price = 520 where id = 'prop_boombox';

-- ---------- 2. allow more than one prop per user ----------
alter table public.store_equipped drop constraint if exists store_equipped_pkey;
alter table public.store_equipped add primary key (user_id, slot, item_id);

-- Everything except props still has exactly one item per layer.
create unique index if not exists store_equipped_single_layer
    on public.store_equipped (user_id, slot)
    where slot <> 'prop';

-- ---------- 3. equip: props add, other layers replace ----------
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
    if p_slot <> 'prop' then
        -- one item per wearable layer
        delete from public.store_equipped where user_id = v_me and slot = p_slot;
    end if;
    insert into public.store_equipped (user_id, slot, item_id)
    values (v_me, p_slot, p_item)
    on conflict (user_id, slot, item_id) do update set updated_at = now();
end;
$fn$;

create or replace function public.unequip_store_item(p_slot text, p_item text default '')
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_item is null or trim(p_item) = '' then
        delete from public.store_equipped where user_id = v_me and slot = p_slot;
    else
        delete from public.store_equipped
         where user_id = v_me and slot = p_slot and item_id = p_item;
    end if;
end;
$fn$;

revoke all on function public.equip_store_item(text, text) from public;
grant execute on function public.equip_store_item(text, text) to authenticated;
revoke all on function public.unequip_store_item(text, text) from public;
grant execute on function public.unequip_store_item(text, text) to authenticated;

-- ---------- 4. friend look returns a props array ----------
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
                               where e.user_id = p_user_id and e.slot = 'prop'
                               order by e.updated_at limit 1), ''),
            'props', coalesce((select jsonb_agg(e.item_id order by e.updated_at)
                                 from public.store_equipped e
                                where e.user_id = p_user_id and e.slot = 'prop'), '[]'::jsonb),
            'background', coalesce((select e.item_id from public.store_equipped e
                                     where e.user_id = p_user_id and e.slot = 'background'), '')
        )
          from (select 1) one
          left join public.profile_looks pl on pl.user_id = p_user_id
    );
end;
$fn$;

notify pgrst, 'reload schema';
