-- LearniTY — eight new Neck & Outfit items (school sets, 2026-11)
--
-- Run once in the Supabase SQL editor if store.sql is already installed.
-- Safe to re-run. Fresh installs already get these rows from store.sql.
--
-- Two coordinated looks for each side (all cats can wear every item):
--   Prefect  : House Tie + School Blazer
--   Sports   : Team Scarf + Football Kit
--   Sailor   : Sailor Collar + Sailor Top
--   Ballet   : Ribbon Choker + Ballet Tutu

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort) values
    ('outfit_housetie','neck','House Tie','學院風領呔',110,'Common','🎗️',59),
    ('outfit_blazer','body','School Blazer','校服西裝外套',240,'Rare','🧥',60),
    ('outfit_teamscarf','neck','Team Scarf','球隊頸巾',130,'Rare','🧣',61),
    ('outfit_football','body','Football Kit','足球球衣',270,'Epic','⚽',62),
    ('outfit_sailorcollar','neck','Sailor Collar','水手領',140,'Rare','⚓',63),
    ('outfit_sailortop','body','Sailor Top','水手上衣',250,'Rare','👕',64),
    ('outfit_ribbonchoker','neck','Ribbon Choker','蝴蝶結頸帶',110,'Common','🎀',65),
    ('outfit_tutu','body','Ballet Tutu','芭蕾紗裙',290,'Epic','🩰',66)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort;

notify pgrst, 'reload schema';
