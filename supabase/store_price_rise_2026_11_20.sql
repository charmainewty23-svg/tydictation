-- LearniTY Store — 14-day Flash Sale + 20 Nov 2026 price rise
-- Run once in the Supabase SQL editor after:
--   supabase/store.sql
--   supabase/store_flash_sale.sql
--   supabase/store_victory.sql (if installed)
--   supabase/store_market.sql (if installed)
-- Safe to re-run.
--
-- Changes:
--   * Flash Sale is now every 14 days (anchor 2026-11-15, HKT).
--   * All catalog prices rise by 10% automatically from 20 Nov 2026 (HKT).
--     The same rule is applied on the client, so the price shown is the
--     price charged by buy_store_item().
--   * One bell announcement is sent now: prices rise on 20 Nov, no percentage.
--
-- The Gacha fee (200 Paws) and student-set Market listings are not changed.

-- ---------- 14-day Flash Sale (10% off) ----------
create or replace function public.store_sale_now()
returns table (active boolean, sale_key text, label text, off_pct int, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $sale$
declare
    v_today  date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_anchor date := date '2026-11-15';   -- sale day, then +14 days
    v_off    int  := 0;
    v_label  text := '';
    v_key    text := '';
    v_end    timestamptz := null;
begin
    -- Festival windows win over the weekly slot.
    if v_today between date '2026-12-24' and date '2026-12-26' then
        v_off := 12; v_label := '🎄 Christmas Sale · 12% off';
        v_key := 'christmas-2026';
        v_end := (date '2026-12-27')::timestamp at time zone 'Asia/Hong_Kong';
    elsif v_today between date '2026-12-31' and date '2027-01-01' then
        v_off := 12; v_label := '🎊 New Year Sale · 12% off';
        v_key := 'newyear-2027';
        v_end := (date '2027-01-02')::timestamp at time zone 'Asia/Hong_Kong';
    elsif v_today between date '2027-02-05' and date '2027-02-07' then
        v_off := 12; v_label := '🧧 Lunar New Year Sale · 12% off';
        v_key := 'lny-2027';
        v_end := (date '2027-02-08')::timestamp at time zone 'Asia/Hong_Kong';
    elsif v_today between date '2027-04-02' and date '2027-04-04' then
        v_off := 12; v_label := '🐣 Easter Sale · 12% off';
        v_key := 'easter-2027';
        v_end := (date '2027-04-05')::timestamp at time zone 'Asia/Hong_Kong';
    elsif v_today between date '2027-10-30' and date '2027-10-31' then
        v_off := 12; v_label := '🎃 Halloween Sale · 12% off';
        v_key := 'halloween-2027';
        v_end := (date '2027-11-01')::timestamp at time zone 'Asia/Hong_Kong';
    else
        -- one sale day every 14 days, counted from the anchor date
        if v_today >= v_anchor and ((v_today - v_anchor) % 14) = 0 then
            v_off := 10;
            v_label := '⚡ Flash Sale · 10% off';
            v_key := 'weekly-' || v_today::text;
            v_end := (v_today + 1)::timestamp at time zone 'Asia/Hong_Kong';
        end if;
    end if;

    return query select (v_off > 0), v_key, v_label, v_off, v_end;
end;
$sale$;
revoke all on function public.store_sale_now() from public, anon;
grant execute on function public.store_sale_now() to authenticated;

-- ---------- base price: +10% from 20 Nov 2026 (HKT) ----------
create or replace function public.store_base_price(p_price int)
returns int
language sql
stable
security definer
set search_path = public
as $price$
    select case
        when (now() at time zone 'Asia/Hong_Kong')::date >= date '2026-11-20'
            then floor(coalesce(p_price, 0) * 1.10)::int
        else coalesce(p_price, 0)
    end;
$price$;
revoke all on function public.store_base_price(int) from public, anon;
grant execute on function public.store_base_price(int) to authenticated;

-- ---------- sale price uses the risen base price ----------
create or replace function public.store_sale_price(p_price int)
returns int
language sql
stable
security definer
set search_path = public
as $price$
    select greatest(
        0,
        floor(
            public.store_base_price(p_price) *
            (100 - coalesce((select s.off_pct from public.store_sale_now() s where s.active), 0)) / 100.0
        )::int
    );
$price$;
revoke all on function public.store_sale_price(int) from public, anon;
grant execute on function public.store_sale_price(int) to authenticated;

-- ---------- victory rental uses the risen base price ----------
create or replace function public.rent_victory_effect(p_item text)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me      uuid := auth.uid();
    v_price   int;
    v_rent    int;
    v_balance int;
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    perform pg_advisory_xact_lock(hashtext(v_me::text));

    select price into v_price
      from public.store_items
     where id = p_item and active and slot = 'victory';
    if v_price is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if exists (select 1 from public.store_purchases where user_id = v_me and item_id = p_item) then
        raise exception 'ALREADY_OWNED';
    end if;

    -- 20% of the current base price, never below 40 Paws.
    v_rent := greatest(40, floor(public.store_base_price(v_price) * 0.2)::int);
    v_balance := public.my_paw_balance();
    if v_balance < v_rent then raise exception 'NOT_ENOUGH_PAWS'; end if;

    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_me, -v_rent, 'victory_rent', 'victory_rent:' || p_item || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));

    insert into public.victory_rentals (user_id, item_id)
    values (v_me, p_item)
    on conflict (user_id) do update set item_id = excluded.item_id, created_at = now();

    return v_balance - v_rent;
end;
$fn$;
revoke all on function public.rent_victory_effect(text) from public, anon;
grant execute on function public.rent_victory_effect(text) to authenticated;

-- ---------- Market original price uses the risen base price ----------
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
           public.store_base_price(i.price) as original_price,
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
revoke all on function public.store_market_listings() from public;
grant execute on function public.store_market_listings() to authenticated;


-- ---------- bell announcement: prices rise on 20 Nov (no percentage) ----------
insert into public.friend_notifications (user_id, actor_id, kind, message)
select u.id, u.id, 'announcement',
       '🛍️ Store prices are rising on 20 Nov. Buy your favourites now — before the increase!'
  from auth.users u
 where not exists (
       select 1 from public.friend_notifications n
        where n.user_id = u.id
          and n.kind = 'announcement'
          and n.message like '🛍️ Store prices are rising on 20 Nov.%'
 );

notify pgrst, 'reload schema';
