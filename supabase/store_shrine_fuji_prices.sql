-- LearniTY Store: new base prices for the Shrine / Mount Fuji backgrounds.
--
-- Updates only bg_shrine (519) and bg_fuji (528) so the shop display prices
-- after the 20 Nov 10% rise are 570 and 580. Safe to re-run. No schema change.
--
-- Paste this whole file into the Supabase SQL editor for the live project.
-- Until it is run, the shop cards will show the new display prices from JS,
-- but purchases will still use the old DB price.

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort)
values
    ('bg_shrine', 'background', 'Shrine / 神社', '神社', 519, 'Epic', '⛩️', 69),
    ('bg_fuji', 'background', 'Mount Fuji / 富士山', '富士山', 528, 'Epic', '🗻', 70)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort;

notify pgrst, 'reload schema';
