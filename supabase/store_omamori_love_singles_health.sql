-- LearniTY Store: three more Omamori charms.
--
-- Adds the pre-cut PNG props Love Charm / Find Love / Health Charm
-- (sorts 71–73). Safe to re-run. No schema change.
--
-- Paste this whole file into the Supabase SQL editor for the live project.
-- Until it is run, the items cannot be bought (the Store cards still render).

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort)
values
    ('prop_omamori_love', 'prop', 'Love Charm / 戀愛御守', '戀愛御守', 328, 'Epic', '💗', 71),
    ('prop_omamori_singles', 'prop', 'Find Love / 脫單御守', '脫單御守', 355, 'Epic', '💕', 72),
    ('prop_omamori_health', 'prop', 'Health Charm / 健康御守', '健康御守', 182, 'Rare', '🌿', 73)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort;

notify pgrst, 'reload schema';
