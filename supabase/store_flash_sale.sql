-- LearniTY Store: weekly + festival flash sales.
--
--  • Every 7 days (from 2026-11-15, Hong Kong time) → 10% off
--  • Festival windows (Christmas etc.)              → 12% off
--
-- The discount is applied by the SERVER inside buy_store_item(), so the
-- price the student sees is the price they pay. store_sale_now() is the one
-- source of truth and the client just displays it.
--
-- announce_store_sale() writes one bell announcement per sale day for every
-- user; it is idempotent, so the client can call it on every login.
--
-- Run in the Supabase SQL editor after store.sql. Safe to re-run.

create table if not exists public.store_sale_announcements (
    sale_key text primary key,
    sent_at  timestamptz not null default now()
);

create or replace function public.store_sale_now()
returns table (active boolean, sale_key text, label text, off_pct int, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $sale$
declare
    v_today  date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_anchor date := date '2026-11-15';   -- weekly sale day, then +7 days
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
        -- one sale day every 7 days, counted from the anchor date
        if v_today >= v_anchor and ((v_today - v_anchor) % 7) = 0 then
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

-- Discounted price for a catalog price (whole Paws, rounded down).
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
            coalesce(p_price, 0) *
            (100 - coalesce((select s.off_pct from public.store_sale_now() s where s.active), 0)) / 100.0
        )::int
    );
$price$;

revoke all on function public.store_sale_price(int) from public, anon;
grant execute on function public.store_sale_price(int) to authenticated;

-- Same buy RPC as store.sql, but charging the sale price and recording what
-- the student actually paid (so a later buy-back is still fair).
create or replace function public.buy_store_item(p_item text)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me      uuid := auth.uid();
    v_price   int;
    v_pay     int;
    v_balance int;
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    perform pg_advisory_xact_lock(hashtext(v_me::text));
    select price into v_price from public.store_items where id = p_item and active;
    if v_price is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if exists (select 1 from public.store_purchases where user_id = v_me and item_id = p_item) then
        raise exception 'ALREADY_OWNED';
    end if;
    v_pay := public.store_sale_price(v_price);
    v_balance := public.my_paw_balance();
    if v_balance < v_pay then raise exception 'NOT_ENOUGH_PAWS'; end if;
    insert into public.store_purchases (user_id, item_id, paid_price) values (v_me, p_item, v_pay);
    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_me, -v_pay, 'purchase', 'purchase:' || p_item);
    return v_balance - v_pay;
end;
$fn$;

revoke all on function public.buy_store_item(text) from public, anon;
grant execute on function public.buy_store_item(text) to authenticated;

-- One bell announcement per sale day, for everyone. Idempotent.
create or replace function public.announce_store_sale(p_key text, p_message text)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_count int := 0;
begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_key is null or trim(p_key) = '' or p_message is null or trim(p_message) = '' then
        return 0;
    end if;

    insert into public.store_sale_announcements (sale_key)
    values (p_key)
    on conflict (sale_key) do nothing;
    if not found then
        return 0;
    end if;

    with ins as (
        insert into public.friend_notifications (user_id, actor_id, kind, message)
        select u.id, u.id, 'announcement', p_message
          from auth.users u
        returning 1
    )
    select count(*) into v_count from ins;

    return v_count;
end;
$fn$;

revoke all on function public.announce_store_sale(text, text) from public, anon;
grant execute on function public.announce_store_sale(text, text) to authenticated;

notify pgrst, 'reload schema';
