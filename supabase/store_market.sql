-- LearniTY Store: second-hand market (students buy / sell / set their own price).
-- Run once in the Supabase SQL editor after supabase/store.sql. Safe to re-run.

create table if not exists public.store_listings (
    id         uuid primary key default gen_random_uuid(),
    seller_id  uuid not null references auth.users(id) on delete cascade,
    item_id    text not null references public.store_items(id) on delete cascade,
    price      int not null check (price between 1 and 5000),
    status     text not null default 'active' check (status in ('active','sold','cancelled')),
    buyer_id   uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    sold_at    timestamptz
);

create unique index if not exists store_listings_active_item
    on public.store_listings (seller_id, item_id)
    where status = 'active';
create index if not exists store_listings_status_idx
    on public.store_listings (status, created_at desc);

alter table public.store_listings enable row level security;
-- No client policies: all reads/writes go through the security-definer RPCs
-- below, so nobody can fake a listing or move Paws directly.

-- Market notifications use the existing bell. Older installs have a kind
-- check that only allows follow/like/announcement/nudge, so widen it first.
do $notif$
begin
    if to_regclass('public.friend_notifications') is not null then
        alter table public.friend_notifications drop constraint if exists friend_notifications_kind_check;
        alter table public.friend_notifications add constraint friend_notifications_kind_check
            check (kind in ('follow', 'like', 'announcement', 'nudge', 'market'));
    end if;
end;
$notif$;

-- Buyback needs the price each student actually paid.
alter table public.store_purchases add column if not exists paid_price int not null default 0;
update public.store_purchases p
   set paid_price = i.price
  from public.store_items i
 where i.id = p.item_id and p.paid_price = 0;

-- ---------- seller: list an owned, unequipped item ----------
create or replace function public.create_store_listing(p_item text, p_price int)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_id uuid;
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_price is null or p_price < 1 or p_price > 5000 then
        raise exception 'BAD_PRICE';
    end if;
    if not exists (select 1 from public.store_items where id = p_item and active) then
        raise exception 'ITEM_NOT_FOUND';
    end if;
    if not exists (select 1 from public.store_purchases where user_id = v_me and item_id = p_item) then
        raise exception 'NOT_OWNED';
    end if;
    if exists (select 1 from public.store_equipped where user_id = v_me and item_id = p_item) then
        raise exception 'ITEM_EQUIPPED';
    end if;
    if exists (select 1 from public.store_listings
                where seller_id = v_me and item_id = p_item and status = 'active') then
        raise exception 'ALREADY_LISTED';
    end if;
    perform pg_advisory_xact_lock(hashtext(v_me::text));
    insert into public.store_listings (seller_id, item_id, price)
    values (v_me, p_item, p_price)
    returning id into v_id;
    return v_id;
end;
$fn$;

-- ---------- seller: cancel ----------
create or replace function public.cancel_store_listing(p_listing uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    update public.store_listings
       set status = 'cancelled'
     where id = p_listing and seller_id = v_me and status = 'active';
    if not found then raise exception 'LISTING_GONE'; end if;
end;
$fn$;

-- ---------- public board ----------
drop function if exists public.store_market_listings();
create or replace function public.store_market_listings()
returns table (
    listing_id uuid,
    item_id text,
    name_en text,
    name_zh text,
    emoji text,
    rarity text,
    price int,
    original_price int,
    seller_name text,
    seller_form text,
    is_mine boolean,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    return query
    select l.id,
           l.item_id,
           i.name_en,
           i.name_zh,
           i.emoji,
           i.rarity,
           l.price,
           i.price as original_price,
           coalesce(nullif(sl.nickname, ''), split_part(u.email, '@', 1), 'Student') as seller_name,
           sl.form,
           (l.seller_id = v_me) as is_mine,
           l.created_at
      from public.store_listings l
      join public.store_items i on i.id = l.item_id
      left join public.student_logins sl on sl.user_id = l.seller_id
      left join auth.users u on u.id = l.seller_id
     where l.status = 'active'
     order by l.created_at desc
     limit 100;
end;
$fn$;

-- ---------- buyer: purchase + transfer the item ----------
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

revoke all on function public.create_store_listing(text, int) from public;
revoke all on function public.cancel_store_listing(uuid) from public;
revoke all on function public.store_market_listings() from public;
revoke all on function public.buy_store_listing(uuid) from public;

grant execute on function public.create_store_listing(text, int) to authenticated;
grant execute on function public.cancel_store_listing(uuid) to authenticated;
grant execute on function public.store_market_listings() to authenticated;
grant execute on function public.buy_store_listing(uuid) to authenticated;

notify pgrst, 'reload schema';
