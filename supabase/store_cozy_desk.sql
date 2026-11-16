-- LearniTY Store: the Cozy Desk prop.
--
-- A real wooden desk (lamp, books, mug) drawn beside the cat, so the premium
-- props read as solid objects for older students rather than floating emoji.
-- Safe to re-run. No schema change.

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort)
values ('prop_cozy_desk', 'prop', 'Cozy Desk', '溫暖書桌', 560, 'Legendary', '🪵', 46)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort;

notify pgrst, 'reload schema';
