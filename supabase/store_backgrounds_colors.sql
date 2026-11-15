-- LearniTY Store: add the three plain-colour backgrounds.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Requires supabase/store.sql (public.store_items) to have been run first.

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort) values
    ('bg_pink','background','Pink','粉紅',130,'Common','🩷',42),
    ('bg_blue','background','Blue','藍色',130,'Common','🩵',43),
    ('bg_floral','background','Floral','碎花',180,'Rare','🌷',44)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort,
    active = true;

-- Check the three rows.
select id, slot, name_en, name_zh, price, rarity, emoji, sort, active
  from public.store_items
 where id in ('bg_pink', 'bg_blue', 'bg_floral')
 order by sort;
