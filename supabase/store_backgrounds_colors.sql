-- LearniTY Store: plain-colour backgrounds and the updated Pink/Blue/Floral prices.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Requires supabase/store.sql (public.store_items) to have been run first.

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort) values
    ('bg_pink','background','Pink','粉紅',400,'Epic','🩷',42),
    ('bg_blue','background','Blue','藍色',420,'Epic','🩵',43),
    ('bg_floral','background','Floral','碎花',520,'Legendary','🌷',44),
    ('bg_yellow','background','Yellow','黃色',160,'Common','💛',45),
    ('bg_black','background','Black','黑色',220,'Rare','🖤',46),
    ('bg_gray','background','Grey','灰色',220,'Rare','🩶',47)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort,
    active = true;

-- Check all six rows (Pink/Blue/Floral now cost 400/420/520).
select id, slot, name_en, name_zh, price, rarity, emoji, sort, active
  from public.store_items
 where id in ('bg_pink', 'bg_blue', 'bg_floral', 'bg_yellow', 'bg_black', 'bg_gray')
 order by sort;
