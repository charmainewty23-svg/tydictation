-- LearniTY Store: the two Omamori charms and two Japanese backgrounds.
--
-- Adds the pre-cut PNG props (Pass the Exam / Academic Success) and the
-- Shrine / Mount Fuji backgrounds. Safe to re-run. No schema change.
--
-- Paste this whole file into the Supabase SQL editor for the live project.
-- Until it is run, the items cannot be bought (the Store cards still render).

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort)
values
    ('prop_omamori_exam', 'prop', 'Pass the Exam / 逢考必過', '逢考必過', 240, 'Epic', '🧧', 67),
    ('prop_omamori_study', 'prop', 'Academic Success / 學業成就', '學業成就', 240, 'Epic', '🎓', 68),
    ('bg_shrine', 'background', 'Shrine / 神社', '神社', 220, 'Epic', '⛩️', 69),
    ('bg_fuji', 'background', 'Mount Fuji / 富士山', '富士山', 240, 'Epic', '🗻', 70)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort;

notify pgrst, 'reload schema';
