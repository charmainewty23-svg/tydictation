-- LearniTY Store: six new handheld props + Mystery Gacha.
-- Run once in the Supabase SQL editor after supabase/store.sql. Safe to re-run.

-- Buyback needs the price each student actually paid.
alter table public.store_purchases add column if not exists paid_price int not null default 0;
update public.store_purchases p
   set paid_price = i.price
  from public.store_items i
 where i.id = p.item_id and p.paid_price = 0;

-- ---------- 1. new Props & Companions ----------
insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort) values
    ('prop_white_flag','prop','White Flag','投降小白旗',470,'Epic','🏳️',48),
    ('prop_rubber_duck','prop','Rubber Duck','沖涼黃色小鴨',480,'Epic','🦆',49),
    ('prop_red_pen','prop','Red Pen','老師改卷紅筆',490,'Epic','🖊️',50),
    ('prop_tea_scone','prop','Tea & Scone','英式下午茶',500,'Epic','🫖',51),
    ('prop_corgi','prop','Mini Corgi','迷你哥基犬',510,'Legendary','🐕',52),
    ('prop_boombox','prop','Boombox','復古卡式錄音機',520,'Legendary','📻',53)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort,
    active = true;

-- ---------- 2. Mystery Gacha (200 Paws; duplicate = 100 Paws back) ----------
create or replace function public.pull_store_gacha()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_cost int := 200;
    v_balance int;
    v_item public.store_items;
    v_owned boolean;
    v_ref text;
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    perform pg_advisory_xact_lock(hashtext(v_me::text));

    -- Also creates the 80-Paw welcome row on the first ever Store visit.
    v_balance := public.my_paw_balance();
    if v_balance < v_cost then
        raise exception 'NOT_ENOUGH_PAWS';
    end if;

    select * into v_item
      from public.store_items
     where active
     order by random()
     limit 1;
    if v_item.id is null then raise exception 'NO_ITEMS'; end if;

    v_ref := 'gacha:' || v_me::text || ':' ||
             extract(epoch from clock_timestamp())::text || ':' ||
             floor(random() * 1000000)::text;

    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_me, -v_cost, 'gacha', v_ref);

    v_owned := exists (
        select 1 from public.store_purchases
         where user_id = v_me and item_id = v_item.id
    );

    if v_owned then
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        values (v_me, v_cost / 2, 'gacha_refund', v_ref || ':refund');
    else
        insert into public.store_purchases (user_id, item_id, paid_price)
        values (v_me, v_item.id, v_cost)
        on conflict do nothing;
    end if;

    select coalesce(sum(amount), 0)::int into v_balance
      from public.paw_ledger where user_id = v_me;

    return jsonb_build_object(
        'item', v_item.id,
        'name', v_item.name_en,
        'zh', v_item.name_zh,
        'emoji', v_item.emoji,
        'slot', v_item.slot,
        'duplicate', v_owned,
        'refund', case when v_owned then v_cost / 2 else 0 end,
        'cost', v_cost,
        'balance', v_balance
    );
end;
$fn$;

revoke all on function public.pull_store_gacha() from public;
grant execute on function public.pull_store_gacha() to authenticated;

notify pgrst, 'reload schema';
