-- LearniTY Market: repair the buyer/seller/teacher bell notifications.
-- Run this AFTER supabase/store_market.sql. Safe to re-run.
-- (The short snippet cannot be pasted by itself because IF is PL/pgSQL.)

do $notif$
begin
    if to_regclass('public.friend_notifications') is not null then
        alter table public.friend_notifications drop constraint if exists friend_notifications_kind_check;
        alter table public.friend_notifications add constraint friend_notifications_kind_check
            check (kind in ('follow', 'like', 'announcement', 'nudge', 'market'));
    end if;
end;
$notif$;

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
    insert into public.store_purchases (user_id, item_id)
    values (v_buyer, v_item.id)
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

revoke all on function public.buy_store_listing(uuid) from public;
grant execute on function public.buy_store_listing(uuid) to authenticated;

notify pgrst, 'reload schema';
