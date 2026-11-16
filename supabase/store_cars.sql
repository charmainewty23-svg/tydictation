-- LearniTY Store: five Drive & Go! car skins.
-- Run after supabase/store.sql. Safe to re-run.

alter table public.store_items drop constraint if exists store_items_slot_check;
alter table public.store_items add constraint store_items_slot_check
    check (slot in ('head','ears','eyes','cheeks','neck','body','car','prop','background','hat','face','outfit'));

alter table public.store_equipped drop constraint if exists store_equipped_slot_check;
alter table public.store_equipped add constraint store_equipped_slot_check
    check (slot in ('head','ears','eyes','cheeks','neck','body','car','prop','background','hat','face','outfit'));

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort) values
    ('car_sunset','car','Sunset Racer','日落賽車',600,'Rare','🏎️',54),
    ('car_ocean','car','Ocean Bolt','海洋閃電',650,'Rare','🏎️',55),
    ('car_neon','car','Neon Drift','霓虹漂移',700,'Epic','🏎️',56),
    ('car_jungle','car','Jungle Buggy','森林越野車',750,'Epic','🏎️',57),
    ('car_gold','car','Golden GT','黃金跑車',900,'Legendary','🏎️',58)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort,
    active = true;

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
    if p_slot not in ('head','ears','eyes','cheeks','neck','body','car','prop','background','hat','face','outfit') then
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
        delete from public.store_equipped where user_id = v_me and slot = p_slot;
    end if;
    insert into public.store_equipped (user_id, slot, item_id)
    values (v_me, p_slot, p_item)
    on conflict (user_id, slot, item_id) do update set updated_at = now();
end;
$fn$;

revoke all on function public.equip_store_item(text, text) from public;
grant execute on function public.equip_store_item(text, text) to authenticated;

notify pgrst, 'reload schema';
