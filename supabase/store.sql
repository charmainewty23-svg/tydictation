-- ============================================================
-- LearniTY — Store, Paws and owned skins
-- Run after: user_streaks.sql, friends.sql, wj_scores.sql,
--            dictation_accuracy.sql, drive_and_go*.sql and battle*.sql.
-- Safe to re-run. No existing data is deleted.
-- ============================================================

-- ---------- catalog ----------
create table if not exists public.store_items (
    id       text primary key,
    slot     text not null check (slot in ('hat', 'face', 'outfit', 'prop', 'background')),
    name_en  text not null,
    name_zh  text,
    price    int not null default 0 check (price >= 0),
    rarity   text not null default 'Common',
    emoji    text,
    active   boolean not null default true,
    sort     int not null default 0
);

alter table public.store_items enable row level security;
drop policy if exists "store items are public" on public.store_items;
create policy "store items are public" on public.store_items
    for select using (true);
grant select on public.store_items to anon, authenticated;

insert into public.store_items (id, slot, name_en, name_zh, price, rarity, emoji, sort) values
    ('hat_sprout','hat','Sprout Clip','小草髮夾',80,'Common','🌱',1),
    ('hat_lofi','hat','Lo-Fi Headphones','復古耳機',140,'Rare','🎧',2),
    ('hat_straw','hat','Straw Hat','草帽',100,'Common','👒',3),
    ('hat_frog','hat','Frog Hood','青蛙頭套',160,'Rare','🐸',4),
    ('hat_chef','hat','Chef Hat','廚師高帽',120,'Rare','👨‍🍳',5),
    ('hat_sherlock','hat','Sherlock Cap','偵探獵鹿帽',150,'Rare','🕵️',6),
    ('hat_grad','hat','Graduation Cap','學士四方帽',180,'Rare','🎓',7),
    ('hat_bearskin','hat','Bearskin Hat','英國衛兵高帽',220,'Epic','🐻',8),
    ('hat_wizard','hat','Wizard Hat','魔法師尖帽',240,'Epic','🧙',9),
    ('hat_astro','hat','Astro Helmet','太空人頭罩',280,'Epic','🚀',10),
    ('hat_gold_crown','hat','Golden Crown','黃金皇冠',450,'Legendary','👑',11),
    ('face_blush','face','Blush Stickers','害羞紅暈',60,'Common','😊',12),
    ('face_round','face','Round Glasses','圓框學霸眼鏡',90,'Common','👓',13),
    ('face_star','face','Star Sunglasses','星星太陽眼鏡',170,'Rare','⭐',14),
    ('face_pixel','face','Pixel Sunglasses','像素黑超',140,'Rare','😎',15),
    ('face_patch','face','Pirate Eyepatch','海盜眼罩',100,'Rare','🏴‍☠️',16),
    ('face_monocle','face','Monocle','紳士單片眼鏡',190,'Epic','🧐',17),
    ('face_visor','face','Cyber Visor','賽博龐克護目鏡',240,'Epic','🥽',18),
    ('outfit_scarf','outfit','Red Scarf','紅色小領巾',80,'Common','🧣',19),
    ('outfit_bowtie','outfit','Tweed Bow Tie','學院風煲呔',120,'Rare','🎀',20),
    ('outfit_bread','outfit','Bread Collar','方包頸圈',150,'Rare','🍞',21),
    ('outfit_boba','outfit','Boba Apron','珍珠奶茶圍裙',140,'Rare','🧋',22),
    ('outfit_raincoat','outfit','Yellow Raincoat','黃色小雨衣',170,'Rare','🧥',23),
    ('outfit_guard','outfit','Royal Guard Tunic','英國衛兵紅制服',220,'Epic','🛡️',24),
    ('outfit_ruff','outfit','Shakespeare Ruff','莎士比亞蕾絲領',200,'Epic','🎭',25),
    ('outfit_shark','outfit','Shark Onesie','鯊魚連身衣',260,'Epic','🦈',26),
    ('outfit_dragon','outfit','Dragon Suit','恐龍連身衣',300,'Epic','🐉',27),
    ('prop_pencil','prop','Pencil','巨大鉛筆',60,'Common','✏️',28),
    ('prop_boba','prop','Boba Tea','珍珠奶茶',90,'Common','🧋',29),
    ('prop_magnifier','prop','Magnifying Glass','放大鏡',110,'Rare','🔍',30),
    ('prop_quill','prop','Quill & Scroll','羽毛筆與羊皮紙',160,'Rare','🪶',31),
    ('prop_box','prop','Cardboard Box','紙皮箱',120,'Rare','📦',32),
    ('prop_dictionary','prop','Floating Dictionary','懸浮魔法字典',220,'Epic','📖',33),
    ('prop_parrot','prop','Mini Parrot','肩膀小鸚鵡',240,'Epic','🦜',34),
    ('bg_desk','background','Cozy Desk','溫書書桌',120,'Rare','🛋️',35),
    ('bg_library','background','Oxford Library','牛津古書庫',200,'Epic','📚',36),
    ('bg_bigben','background','Big Ben Rain','倫敦雨夜',220,'Epic','🕰️',37),
    ('bg_galaxy','background','Starry Galaxy','星空宇宙',240,'Epic','🌌',38),
    ('bg_aplus','background','Floating A+','滿分飄浮特效',300,'Legendary','💯',39),
    ('bg_sakura','background','Cherry Blossoms','櫻花飄落',180,'Rare','🌸',40),
    ('bg_cyber','background','Cyber Grid','霓虹網格',260,'Epic','🌐',41),
    ('bg_pink','background','Pink','粉紅',400,'Epic','🩷',42),
    ('bg_blue','background','Blue','藍色',420,'Epic','🩵',43),
    ('bg_floral','background','Floral','碎花',520,'Legendary','🌷',44),
    ('bg_yellow','background','Yellow','黃色',160,'Common','💛',45),
    ('bg_black','background','Black','黑色',220,'Rare','🖤',46),
    ('bg_gray','background','Grey','灰色',220,'Rare','🩶',47)
on conflict (id) do update set
    slot = excluded.slot,
    name_en = excluded.name_en,
    name_zh = excluded.name_zh,
    price = excluded.price,
    rarity = excluded.rarity,
    emoji = excluded.emoji,
    sort = excluded.sort,
    active = true;

-- ---------- Paws ledger ----------
create table if not exists public.paw_ledger (
    id         bigserial primary key,
    user_id    uuid not null references auth.users(id) on delete cascade,
    amount     int not null,
    reason     text not null,
    ref_key    text not null,
    created_at timestamptz not null default now(),
    unique (user_id, ref_key)
);
create index if not exists paw_ledger_user_idx on public.paw_ledger(user_id, created_at desc);
alter table public.paw_ledger enable row level security;
-- No client policies: balance and awards go through security-definer RPCs.

create or replace function public.my_paw_balance()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_balance int := 0;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_me, 80, 'welcome', 'welcome')
    on conflict (user_id, ref_key) do nothing;
    select coalesce(sum(amount), 0)::int into v_balance
      from public.paw_ledger where user_id = v_me;
    return v_balance;
end;
$fn$;

create or replace function public.my_paws_today()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_day_start timestamptz :=
        ((now() at time zone 'Asia/Hong_Kong')::date::timestamp at time zone 'Asia/Hong_Kong');
    v_total int := 0;
begin
    if v_me is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;
    select coalesce(sum(amount), 0)::int into v_total
      from public.paw_ledger
     where user_id = v_me
       and amount > 0
       and created_at >= v_day_start
       and (reason like 'practice:%' or reason = 'class_battle');
    return v_total;
end;
$fn$;

-- Shared by the score-table triggers. p_base is capped by the caller.
create or replace function public.paw_practice_award(
    p_user uuid,
    p_kind text,
    p_ref text,
    p_base int
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_day_start timestamptz :=
        ((now() at time zone 'Asia/Hong_Kong')::date::timestamp at time zone 'Asia/Hong_Kong');
    v_prior int := 0;
    v_bonus int := 0;
    v_streak int := 0;
    v_total int := 0;
    v_earned int := 0;
    v_remaining int := 0;
    v_award int := 0;
begin
    if p_user is null or p_ref is null then return; end if;
    perform pg_advisory_xact_lock(hashtext(p_user::text));
    if exists (select 1 from public.paw_ledger where user_id = p_user and ref_key = p_ref) then
        return;
    end if;

    select count(*)::int into v_prior
      from public.paw_ledger
     where user_id = p_user
       and ref_key like 'practice:%'
       and created_at >= v_day_start;

    v_bonus := case when v_prior = 0 then 10 when v_prior < 4 then 5 else 0 end;
    if v_prior = 0 then
        select coalesce(least(streak_count, 10), 0) into v_streak
          from public.user_streaks where user_id = p_user;
        v_streak := coalesce(v_streak, 0);
    end if;

    v_total := greatest(0, coalesce(p_base, 0)) + v_bonus + v_streak;

    select coalesce(sum(amount), 0)::int into v_earned
      from public.paw_ledger
     where user_id = p_user
       and amount > 0
       and ref_key like 'practice:%'
       and created_at >= v_day_start;

    v_remaining := greatest(0, 150 - v_earned);
    v_award := least(v_total, v_remaining);

    if v_award > 0 then
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        values (p_user, v_award, 'practice:' || p_kind, p_ref)
        on conflict (user_id, ref_key) do nothing;
    end if;
end;
$fn$;

-- ---------- triggers ----------
create or replace function public.paw_trg_dictation()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
    perform public.paw_practice_award(new.user_id, 'dictation',
        'practice:dictation:' || md5(row_to_json(new)::text),
        coalesce((to_jsonb(new) ->> 'correct')::int, 0));
    return new;
end;
$fn$;

create or replace function public.paw_trg_wj()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
    perform public.paw_practice_award(new.user_id, 'wordjump',
        'practice:wordjump:' || new.id,
        least(coalesce(new.words, 0), 40));
    return new;
end;
$fn$;

create or replace function public.paw_trg_dg_solo()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
    perform public.paw_practice_award(new.user_id, 'drive_solo',
        'practice:drive_solo:' || new.id,
        coalesce(new.correct, 0));
    return new;
end;
$fn$;

create or replace function public.paw_trg_dg_multi()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
    perform public.paw_practice_award(new.user_id, 'drive_multi',
        'practice:drive_multi:' || new.id,
        coalesce(new.correct, 0));
    return new;
end;
$fn$;

create or replace function public.paw_trg_battle()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
    v_mode text;
begin
    if not (new.done and (old.done is distinct from true)) then return new; end if;
    select coalesce(to_jsonb(r) ->> 'mode', 'duel') into v_mode
      from public.battle_rooms r where r.id = new.room_id;
    if coalesce(v_mode, 'duel') = 'class' then return new; end if;
    perform public.paw_practice_award(new.user_id, 'battle',
        'practice:battle:' || new.room_id::text || ':' || new.user_id::text,
        least(coalesce(new.correct, 0), 20));
    return new;
end;
$fn$;

drop trigger if exists paw_dictation_after_insert on public.dictation_results;
create trigger paw_dictation_after_insert
after insert on public.dictation_results
for each row execute function public.paw_trg_dictation();

drop trigger if exists paw_wj_after_insert on public.wj_scores;
create trigger paw_wj_after_insert
after insert on public.wj_scores
for each row execute function public.paw_trg_wj();

drop trigger if exists paw_dg_solo_after_insert on public.drive_and_go_solo_scores;
create trigger paw_dg_solo_after_insert
after insert on public.drive_and_go_solo_scores
for each row execute function public.paw_trg_dg_solo();

drop trigger if exists paw_dg_multi_after_insert on public.drive_and_go_multi_scores;
create trigger paw_dg_multi_after_insert
after insert on public.drive_and_go_multi_scores
for each row execute function public.paw_trg_dg_multi();

drop trigger if exists paw_battle_after_update on public.battle_players;
create trigger paw_battle_after_update
after update on public.battle_players
for each row execute function public.paw_trg_battle();

-- Class battles: top 3 get a one-off Paws bonus (+15 / +10 / +5).
create or replace function public.paw_trg_class_battle()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
    r record;
    v_place int := 0;
    v_points int := 0;
begin
    if new.status <> 'finished'
       or old.status is not distinct from 'finished'
       or coalesce(to_jsonb(new) ->> 'mode', 'duel') <> 'class' then
        return new;
    end if;
    for r in
        select user_id
          from public.battle_players
         where room_id = new.id
         order by score desc, total_ms asc
         limit 3
    loop
        v_place := v_place + 1;
        v_points := case v_place when 1 then 15 when 2 then 10 else 5 end;
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        values (r.user_id, v_points, 'class_battle',
                'class_battle:' || new.id::text || ':' || r.user_id::text)
        on conflict (user_id, ref_key) do nothing;
    end loop;
    return new;
end;
$fn$;

drop trigger if exists paw_class_battle_after_update on public.battle_rooms;
create trigger paw_class_battle_after_update
after update on public.battle_rooms
for each row execute function public.paw_trg_class_battle();

-- ---------- purchases / equipped ----------
create table if not exists public.store_purchases (
    user_id    uuid not null references auth.users(id) on delete cascade,
    item_id    text not null references public.store_items(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, item_id)
);
alter table public.store_purchases enable row level security;
drop policy if exists "store purchases read own" on public.store_purchases;
create policy "store purchases read own" on public.store_purchases
    for select using (auth.uid() = user_id);
grant select on public.store_purchases to authenticated;

create table if not exists public.store_equipped (
    user_id    uuid not null references auth.users(id) on delete cascade,
    slot       text not null check (slot in ('hat', 'face', 'outfit', 'prop', 'background')),
    item_id    text not null references public.store_items(id) on delete cascade,
    updated_at timestamptz not null default now(),
    primary key (user_id, slot)
);
alter table public.store_equipped enable row level security;
drop policy if exists "store equipped read own" on public.store_equipped;
create policy "store equipped read own" on public.store_equipped
    for select using (auth.uid() = user_id);
grant select on public.store_equipped to authenticated;

create table if not exists public.profile_looks (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    cat        text not null default 'Ginger',
    hat        text not null default 'None',
    face       text not null default 'None',
    outfit     text not null default 'None',
    updated_at timestamptz not null default now()
);
alter table public.profile_looks enable row level security;
drop policy if exists "profile look read own" on public.profile_looks;
create policy "profile look read own" on public.profile_looks
    for select using (auth.uid() = user_id);
grant select on public.profile_looks to authenticated;

create or replace function public.save_profile_look(
    p_cat text,
    p_hat text,
    p_face text,
    p_outfit text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_me uuid := auth.uid();
    v_cat text := coalesce(nullif(trim(p_cat), ''), 'Ginger');
begin
    if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if v_cat not in ('Ginger', 'Ragdoll', 'Black', 'Siamese') then v_cat := 'Ginger'; end if;
    insert into public.profile_looks (user_id, cat, hat, face, outfit)
    values (
        v_me,
        v_cat,
        left(coalesce(nullif(trim(p_hat), ''), 'None'), 60),
        left(coalesce(nullif(trim(p_face), ''), 'None'), 60),
        left(coalesce(nullif(trim(p_outfit), ''), 'None'), 60)
    )
    on conflict (user_id) do update set
        cat = excluded.cat,
        hat = excluded.hat,
        face = excluded.face,
        outfit = excluded.outfit,
        updated_at = now();
end;
$fn$;

create or replace function public.friend_store_look(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_user_id is null then return '{}'::jsonb; end if;
    return (
        select jsonb_build_object(
            'cat', coalesce(pl.cat, 'Ginger'),
            'hat', coalesce(pl.hat, 'None'),
            'face', coalesce(pl.face, 'None'),
            'outfit', coalesce(pl.outfit, 'None'),
            'prop', coalesce((select e.item_id from public.store_equipped e
                               where e.user_id = p_user_id and e.slot = 'prop'), ''),
            'background', coalesce((select e.item_id from public.store_equipped e
                                     where e.user_id = p_user_id and e.slot = 'background'), '')
        )
          from (select 1) one
          left join public.profile_looks pl on pl.user_id = p_user_id
    );
end;
$fn$;

create or replace function public.friend_paws_daily(p_user_id uuid, p_days int default 7)
returns table (day date, earned int)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_days int := greatest(1, least(coalesce(p_days, 7), 31));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_start timestamptz :=
        ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Hong_Kong');
begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if p_user_id is null then return; end if;
    return query
    with days as (
        select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as d
    ),
    daily as (
        select (l.created_at at time zone 'Asia/Hong_Kong')::date as d,
               sum(l.amount)::int as earned
          from public.paw_ledger l
         where l.user_id = p_user_id
           and l.amount > 0
           and l.created_at >= v_start
           and (l.reason like 'practice:%' or l.reason = 'class_battle')
         group by (l.created_at at time zone 'Asia/Hong_Kong')::date
    )
    select days.d as day, coalesce(daily.earned, 0)::int as earned
      from days
      left join daily on daily.d = days.d
     order by days.d;
end;
$fn$;

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
    insert into public.store_purchases (user_id, item_id) values (v_me, p_item);
    insert into public.paw_ledger (user_id, amount, reason, ref_key)
    values (v_me, -v_price, 'purchase', 'purchase:' || p_item);
    return v_balance - v_price;
end;
$fn$;

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
    if p_slot not in ('hat', 'face', 'outfit', 'prop', 'background') then
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
    insert into public.store_equipped (user_id, slot, item_id)
    values (v_me, p_slot, p_item)
    on conflict (user_id, slot) do update set item_id = excluded.item_id, updated_at = now();
end;
$fn$;

create or replace function public.admin_paw_daily(p_days int default 7)
returns table (
    user_id uuid,
    email text,
    nickname text,
    form text,
    day date,
    earned int,
    spent int,
    balance int
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_days int := greatest(1, least(coalesce(p_days, 7), 31));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_start timestamptz :=
        ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Hong_Kong');
begin
    if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'tywong@lstyoungkhl.edu.hk' then
        raise exception 'NOT_ADMIN';
    end if;

    return query
    with days as (
        select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as d
    ),
    students as (
        select sl.user_id, sl.email, sl.nickname, sl.form
          from public.student_logins sl
    ),
    daily as (
        select l.user_id,
               (l.created_at at time zone 'Asia/Hong_Kong')::date as d,
               sum(case when l.amount > 0
                         and (l.reason like 'practice:%' or l.reason = 'class_battle')
                        then l.amount else 0 end)::int as earned,
               sum(case when l.amount < 0 then -l.amount else 0 end)::int as spent
          from public.paw_ledger l
         where l.created_at >= v_start
         group by l.user_id, (l.created_at at time zone 'Asia/Hong_Kong')::date
    )
    select s.user_id,
           s.email,
           s.nickname,
           s.form,
           d.d as day,
           coalesce(x.earned, 0) as earned,
           coalesce(x.spent, 0) as spent,
           coalesce((select sum(l2.amount)::int from public.paw_ledger l2
                      where l2.user_id = s.user_id), 0) as balance
      from students s
      cross join days d
      left join daily x on x.user_id = s.user_id and x.d = d.d
     order by s.form nulls last, s.email, d.d;
end;
$fn$;

revoke all on function public.my_paw_balance() from public;
revoke all on function public.my_paws_today() from public;
revoke all on function public.admin_paw_daily(int) from public;
revoke all on function public.friend_paws_daily(uuid, int) from public;
revoke all on function public.paw_practice_award(uuid, text, text, int) from public;
revoke all on function public.buy_store_item(text) from public;
revoke all on function public.equip_store_item(text, text) from public;
revoke all on function public.save_profile_look(text, text, text, text) from public;
revoke all on function public.friend_store_look(uuid) from public;
revoke all on function public.paw_trg_dictation() from public;
revoke all on function public.paw_trg_wj() from public;
revoke all on function public.paw_trg_dg_solo() from public;
revoke all on function public.paw_trg_dg_multi() from public;
revoke all on function public.paw_trg_battle() from public;
revoke all on function public.paw_trg_class_battle() from public;

grant execute on function public.my_paw_balance() to authenticated;
grant execute on function public.my_paws_today() to authenticated;
grant execute on function public.admin_paw_daily(int) to authenticated;
grant execute on function public.friend_paws_daily(uuid, int) to authenticated;
grant execute on function public.buy_store_item(text) to authenticated;
grant execute on function public.equip_store_item(text, text) to authenticated;
grant execute on function public.save_profile_look(text, text, text, text) to authenticated;
grant execute on function public.friend_store_look(uuid) to authenticated;

-- ---------- in-app announcement to all users ----------
-- This is a bell notification, not an OS push. It runs once per user for
-- this exact message; re-running the file does not duplicate it.
insert into public.friend_notifications (user_id, actor_id, kind, message)
select u.id, u.id, 'announcement',
       '🛍️ The Store is open! Earn Paws from practice and spend them on hats, glasses, outfits, props and backgrounds. Tap Store next to Me.'
  from auth.users u
 where not exists (
       select 1 from public.friend_notifications n
        where n.user_id = u.id
          and n.kind = 'announcement'
          and n.message like '🛍️ The Store is open!%'
 );

-- ---------- teacher test balance ----------
-- Keeps the owner account at 2000 Paws for testing the Store. Safe to
-- re-run: it rewrites a single ledger row, and the welcome/practice
-- amounts are not touched. Top-up Paws do not count towards the daily cap.
do $topup$
declare
    v_teacher uuid;
    v_others int;
begin
    select id into v_teacher
      from auth.users
     where lower(email) = 'tywong@lstyoungkhl.edu.hk'
     limit 1;
    if v_teacher is null then
        return;
    end if;
    select coalesce(sum(amount), 0)::int into v_others
      from public.paw_ledger
     where user_id = v_teacher
       and ref_key <> 'teacher_test_topup_2000';
    if v_others < 2000 then
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        values (v_teacher, 2000 - v_others, 'teacher_test_topup', 'teacher_test_topup_2000')
        on conflict (user_id, ref_key) do update set amount = excluded.amount;
    end if;
end;
$topup$;
