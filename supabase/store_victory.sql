-- LearniTY Store: Victory Animations (勝利晒命特效).
--
-- 7 effects in three price tiers. Owning one lets a student equip it; a much
-- cheaper 1-day trial pass lets them use it for the NEXT class battle only.
-- Uses are logged so the Store can show a Top Sellers strip.
--
-- Run after store.sql / store_cars.sql. Safe to re-run.

alter table public.store_items drop constraint if exists store_items_slot_check;
alter table public.store_items add constraint store_items_slot_check
    check (slot in ('head','ears','eyes','cheeks','neck','body','car','prop','background','hat','face','outfit','victory'));

alter table public.store_equipped drop constraint if exists store_equipped_slot_check;
alter table public.store_equipped add constraint store_equipped_slot_check
    check (slot in ('head','ears','eyes','cheeks','neck','body','car','prop','background','hat','face','outfit','victory'));

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort) values
    ('victory_confetti',  'victory', 'Confetti Cannon', '彩帶禮炮',      250, 'Common',    '🎉', 70),
    ('victory_spotlight', 'victory', 'Spotlight',       '巨星聚光燈',    300, 'Common',    '🔦', 71),
    ('victory_emojirain', 'victory', 'Emoji Rain',      '表情符號雨',    350, 'Rare',      '😎', 72),
    ('victory_micdrop',   'victory', 'Mic Drop',        '掉咪走人',      450, 'Rare',      '🎤', 73),
    ('victory_dealwithit','victory', 'Deal With It',    '像素黑超降臨',  550, 'Epic',      '🕶️', 74),
    ('victory_bananaslip','victory', 'Banana Slip',     '全場滑倒',      600, 'Epic',      '🍌', 75),
    ('victory_moneygun',  'victory', 'Money Gun',       '積分噴鈔機',    900, 'Legendary', '💸', 76)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort;

-- ---------- 1-day trial pass (next class battle only) ----------

create table if not exists public.victory_rentals (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    item_id    text not null,
    created_at timestamptz not null default now()
);

alter table public.victory_rentals enable row level security;
drop policy if exists "victory rentals own" on public.victory_rentals;
create policy "victory rentals own" on public.victory_rentals
    for select using (auth.uid() = user_id);

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

    -- 20% of the full price, never below 40 Paws.
    v_rent := greatest(40, floor(v_price * 0.2)::int);
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

create or replace function public.my_victory_rental()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
    select item_id from public.victory_rentals where user_id = auth.uid();
$fn$;

revoke all on function public.my_victory_rental() from public, anon;
grant execute on function public.my_victory_rental() to authenticated;

create or replace function public.consume_victory_rental()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_item text;
begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    delete from public.victory_rentals
     where user_id = auth.uid()
    returning item_id into v_item;
    return v_item;
end;
$fn$;

revoke all on function public.consume_victory_rental() from public, anon;
grant execute on function public.consume_victory_rental() to authenticated;

-- ---------- popularity (Top Sellers) ----------

create table if not exists public.victory_uses (
    id         bigserial primary key,
    user_id    uuid not null references auth.users(id) on delete cascade,
    item_id    text not null,
    room_id    text,
    created_at timestamptz not null default now()
);

create index if not exists victory_uses_item_idx on public.victory_uses (item_id, created_at desc);
alter table public.victory_uses enable row level security;

create or replace function public.log_victory_use(p_item text, p_room text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if auth.uid() is null then return; end if;
    if p_item is null or trim(p_item) = '' then return; end if;
    insert into public.victory_uses (user_id, item_id, room_id)
    values (auth.uid(), p_item, left(coalesce(p_room, ''), 80));
end;
$fn$;

revoke all on function public.log_victory_use(text, text) from public, anon;
grant execute on function public.log_victory_use(text, text) to authenticated;

create or replace function public.store_victory_top(p_days int default 7)
returns table (item_id text, uses int)
language sql
stable
security definer
set search_path = public
as $fn$
    select v.item_id, count(*)::int as uses
      from public.victory_uses v
     where v.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
     group by v.item_id
     order by uses desc, v.item_id
     limit 5;
$fn$;

revoke all on function public.store_victory_top(int) from public, anon;
grant execute on function public.store_victory_top(int) to authenticated;

-- ---------- equip / unequip now accept the victory slot ----------

create or replace function public.equip_store_item(p_slot text, p_item text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_item public.store_items;
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_slot not in ('head','ears','eyes','cheeks','neck','body','car','prop','background','hat','face','outfit','victory') then
        raise exception 'INVALID_SLOT';
    end if;
    if p_item is null or trim(p_item) = '' then
        delete from public.store_equipped where user_id = v_me and slot = p_slot;
        return;
    end if;
    select * into v_item from public.store_items where id = p_item and active;
    if v_item.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if v_item.slot <> p_slot then raise exception 'WRONG_SLOT'; end if;
    if v_item.price > 0 and not exists (
        select 1 from public.store_purchases where user_id = v_me and item_id = p_item
    ) then
        raise exception 'NOT_OWNED';
    end if;
    if p_slot <> 'prop' then
        delete from public.store_equipped where user_id = v_me and slot = p_slot;
    end if;
    insert into public.store_equipped (user_id, slot, item_id)
    values (v_me, p_slot, p_item)
    on conflict (user_id, slot, item_id) do update set updated_at = now();
end;
$fn$;

revoke all on function public.equip_store_item(text, text) from public, anon;
grant execute on function public.equip_store_item(text, text) to authenticated;

-- ---------- in-app announcement ----------

insert into public.friend_notifications (user_id, actor_id, kind, message)
select u.id, u.id, 'announcement',
       '✨ New in the Store: Victory Animations! Preview any effect, buy it, or rent a 1-battle pass. Win a class battle and flex on everyone.'
  from auth.users u
 where not exists (
       select 1 from public.friend_notifications n
        where n.user_id = u.id
          and n.kind = 'announcement'
          and n.message like '✨ New in the Store: Victory Animations!%'
 );

notify pgrst, 'reload schema';
