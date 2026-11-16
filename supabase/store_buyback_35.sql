-- LearniTY: update official buyback to 35% of what the student paid
-- (65% off). Run AFTER supabase/store_buyback.sql. Safe to re-run.

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

    -- 35% of what the student actually paid (65% off). Older rows with no
    -- paid_price fall back to the original store price.
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

revoke all on function public.sell_item_to_store(text) from public;
grant execute on function public.sell_item_to_store(text) to authenticated;

notify pgrst, 'reload schema';
