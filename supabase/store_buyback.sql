-- LearniTY Store: official buyback at 35% of what the student paid (65% off).
-- Run AFTER supabase/store.sql, store_gacha.sql and store_market.sql.
-- Safe to re-run.

-- Track what each student actually paid, so a cheap Market flip cannot be
-- sold back for 35% of the full store price.
alter table public.store_purchases add column if not exists paid_price int not null default 0;
update public.store_purchases p
   set paid_price = i.price
  from public.store_items i
 where i.id = p.item_id and p.paid_price = 0;

create or replace function public.buy_store_item(p_item text)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_price int;
    v_balance int;
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    perform pg_advisory_xact_lock(hashtext(v_me::text));
    select price into v_price from public.store_items where id = p_item and active;
    if v_price is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if exists (select 1 from public.store_purchases where user_id = v_me and item_id = p_item) then
        raise exception 'ALREADY_OWNED';
    end if;
    v_balance := public.my_paw_balance();
    if v_balance < v_price then raise exception 'NOT_ENOUGH_PAWS'; end if;
    insert into public.store_purchases (user_id, item_id, paid_price) values (v_me, p_item, v_price);
    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_me, -v_price, 'purchase', 'purchase:' || p_item);
    return v_balance - v_price;
end;
$fn$;

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

create or replace function public.buy_store_listing(p_listing uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_buyer uuid := auth.uid();
    v_listing public.store_listings;
    v_item public.store_items;
    v_balance int;
    v_buyer_name text;
    v_seller_name text;
    v_teacher uuid;
begin
    if v_buyer is null then raise exception 'NOT_AUTHENTICATED'; end if;

    select * into v_listing
      from public.store_listings
     where id = p_listing and status = 'active'
     for update;
    if v_listing.id is null then raise exception 'LISTING_GONE'; end if;
    if v_listing.seller_id = v_buyer then raise exception 'OWN_LISTING'; end if;

    select * into v_item from public.store_items where id = v_listing.item_id and active;
    if v_item.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if exists (select 1 from public.store_purchases where user_id = v_buyer and item_id = v_item.id) then
        raise exception 'ALREADY_OWNED';
    end if;
    if not exists (select 1 from public.store_purchases
                    where user_id = v_listing.seller_id and item_id = v_item.id) then
        raise exception 'SELLER_NO_LONGER_OWNS';
    end if;
    if exists (select 1 from public.store_equipped
                where user_id = v_listing.seller_id and item_id = v_item.id) then
        raise exception 'SELLER_EQUIPPED';
    end if;

    -- Lock both wallets in a stable order to avoid deadlocks.
    perform pg_advisory_xact_lock(hashtext(least(v_buyer::text, v_listing.seller_id::text)));
    perform pg_advisory_xact_lock(hashtext(greatest(v_buyer::text, v_listing.seller_id::text)));

    select coalesce(sum(amount), 0)::int into v_balance
      from public.paw_ledger where user_id = v_buyer;
    if v_balance < v_listing.price then
        raise exception 'NOT_ENOUGH_PAWS';
    end if;

    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_buyer, -v_listing.price, 'market_buy', 'market_buy:' || p_listing::text);
    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_listing.seller_id, v_listing.price, 'market_sell', 'market_sell:' || p_listing::text);

    delete from public.store_purchases
     where user_id = v_listing.seller_id and item_id = v_item.id;
    insert into public.store_purchases (user_id, item_id, paid_price)
    values (v_buyer, v_item.id, v_listing.price)
    on conflict do nothing;

    delete from public.store_equipped
     where user_id = v_listing.seller_id and item_id = v_item.id;

    update public.store_listings
       set status = 'sold', buyer_id = v_buyer, sold_at = now()
     where id = p_listing;

    -- Bell notifications for both sides of the trade.
    if to_regclass('public.friend_notifications') is not null then
        -- Never let a notification failure roll back a completed sale.
        begin
            select coalesce(nullif(sl.nickname, ''), split_part(u.email, '@', 1), 'Student')
              into v_buyer_name
              from auth.users u
              left join public.student_logins sl on sl.user_id = u.id
             where u.id = v_buyer;
            select coalesce(nullif(sl.nickname, ''), split_part(u.email, '@', 1), 'Student')
              into v_seller_name
              from auth.users u
              left join public.student_logins sl on sl.user_id = u.id
             where u.id = v_listing.seller_id;

            insert into public.friend_notifications (user_id, actor_id, kind, message)
            values (
                v_listing.seller_id, v_buyer, 'market',
                'Your ' || v_item.name_en || ' sold to ' || coalesce(v_buyer_name, 'a student') ||
                ' for ' || v_listing.price || ' 🐾.'
            );
            insert into public.friend_notifications (user_id, actor_id, kind, message)
            values (
                v_buyer, v_listing.seller_id, 'market',
                'You bought ' || v_item.name_en || ' from ' || coalesce(v_seller_name, 'a student') ||
                ' for ' || v_listing.price || ' 🐾.'
            );

            -- Teacher gets a copy for oversight (unless they are a party).
            select id into v_teacher
              from auth.users
             where lower(email) = 'tywong@lstyoungkhl.edu.hk'
             limit 1;
            if v_teacher is not null and v_teacher <> v_buyer and v_teacher <> v_listing.seller_id then
                insert into public.friend_notifications (user_id, actor_id, kind, message)
                values (
                    v_teacher, v_buyer, 'market',
                    'Market: ' || coalesce(v_buyer_name, 'A student') || ' bought ' ||
                    v_item.name_en || ' from ' || coalesce(v_seller_name, 'a student') ||
                    ' for ' || v_listing.price || ' 🐾.'
                );
            end if;
        exception when others then
            null;
        end;
    end if;

    select coalesce(sum(amount), 0)::int into v_balance
      from public.paw_ledger where user_id = v_buyer;

    return jsonb_build_object(
        'listing_id', p_listing,
        'item', v_item.id,
        'name', v_item.name_en,
        'zh', v_item.name_zh,
        'emoji', v_item.emoji,
        'price', v_listing.price,
        'balance', v_balance,
        'seller_id', v_listing.seller_id
    );
end;
$fn$;

create or replace function public.sell_item_to_store(p_item text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_item public.store_items;
    v_paid int;
    v_refund int;
    v_ref text;
    v_balance int;
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    select * into v_item from public.store_items where id = p_item and active;
    if v_item.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    select paid_price into v_paid
      from public.store_purchases
     where user_id = v_me and item_id = p_item;
    if not found then raise exception 'NOT_OWNED'; end if;
    if exists (select 1 from public.store_equipped
                where user_id = v_me and item_id = p_item) then
        raise exception 'ITEM_EQUIPPED';
    end if;
    if exists (select 1 from public.store_listings
                where seller_id = v_me and item_id = p_item and status = 'active') then
        raise exception 'ITEM_LISTED';
    end if;

    -- Official buyback pays 35% of what the student paid (65% off), or
    -- 35% of the original price for very old rows with no paid_price.
    v_refund := greatest(1, floor(coalesce(nullif(v_paid, 0), v_item.price) * 0.35)::int);
    v_ref := 'buyback:' || v_me::text || ':' || p_item || ':' ||
             extract(epoch from clock_timestamp())::text || ':' ||
             floor(random() * 1000000)::text;

    delete from public.store_purchases where user_id = v_me and item_id = p_item;
    delete from public.store_equipped where user_id = v_me and item_id = p_item;
    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_me, v_refund, 'store_buyback', v_ref);

    select coalesce(sum(amount), 0)::int into v_balance
      from public.paw_ledger where user_id = v_me;

    return jsonb_build_object(
        'item', v_item.id,
        'name', v_item.name_en,
        'zh', v_item.name_zh,
        'emoji', v_item.emoji,
        'paid', coalesce(nullif(v_paid, 0), v_item.price),
        'refund', v_refund,
        'rate', 0.35,
        'balance', v_balance
    );
end;
$fn$;

revoke all on function public.buy_store_item(text) from public;
grant execute on function public.buy_store_item(text) to authenticated;
revoke all on function public.pull_store_gacha() from public;
grant execute on function public.pull_store_gacha() to authenticated;
revoke all on function public.buy_store_listing(uuid) from public;
grant execute on function public.buy_store_listing(uuid) to authenticated;
revoke all on function public.sell_item_to_store(text) from public;
grant execute on function public.sell_item_to_store(text) to authenticated;

notify pgrst, 'reload schema';
