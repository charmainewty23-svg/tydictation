-- LearniTY Market: teacher bell notification when a listing is sold.
-- Run AFTER supabase/store_market.sql. Safe to re-run.
--
-- This is the short version: it watches store_listings instead of replacing
-- the whole buy_store_listing() function. Use this OR the full function
-- repair, not both, if you want to avoid duplicate teacher rows.

do $notif$
begin
    if to_regclass('public.friend_notifications') is not null then
        alter table public.friend_notifications drop constraint if exists friend_notifications_kind_check;
        alter table public.friend_notifications add constraint friend_notifications_kind_check
            check (kind in ('follow', 'like', 'announcement', 'nudge', 'market'));
    end if;
end;
$notif$;

create or replace function public.store_market_teacher_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_teacher uuid;
    v_buyer_name text;
    v_seller_name text;
    v_item public.store_items;
    v_msg text;
begin
    if new.status <> 'sold' or old.status is not distinct from 'sold' then
        return new;
    end if;
    if to_regclass('public.friend_notifications') is null then
        return new;
    end if;

    begin
        select * into v_item from public.store_items where id = new.item_id;
        select id into v_teacher
          from auth.users
         where lower(email) = 'tywong@lstyoungkhl.edu.hk'
         limit 1;
        if v_teacher is null
           or v_teacher = new.seller_id
           or v_teacher = new.buyer_id then
            return new;
        end if;

        select coalesce(nullif(sl.nickname, ''), split_part(u.email, '@', 1), 'Student')
          into v_buyer_name
          from auth.users u
          left join public.student_logins sl on sl.user_id = u.id
         where u.id = new.buyer_id;
        select coalesce(nullif(sl.nickname, ''), split_part(u.email, '@', 1), 'Student')
          into v_seller_name
          from auth.users u
          left join public.student_logins sl on sl.user_id = u.id
         where u.id = new.seller_id;

        v_msg := 'Market: ' || coalesce(v_buyer_name, 'A student') || ' bought ' ||
                 coalesce(v_item.name_en, new.item_id) || ' from ' ||
                 coalesce(v_seller_name, 'a student') || ' for ' || new.price || ' 🐾.';

        -- Guard against running this trigger and the full function repair
        -- at the same time.
        if exists (
            select 1 from public.friend_notifications
             where user_id = v_teacher
               and kind = 'market'
               and message = v_msg
               and created_at > now() - interval '5 minutes'
        ) then
            return new;
        end if;

        insert into public.friend_notifications (user_id, actor_id, kind, message)
        values (v_teacher, coalesce(new.buyer_id, new.seller_id), 'market', v_msg);
    exception when others then
        -- Never block a completed sale because of a notification problem.
        return new;
    end;

    return new;
end;
$fn$;

drop trigger if exists store_market_teacher_notify_trg on public.store_listings;
create trigger store_market_teacher_notify_trg
after update on public.store_listings
for each row execute function public.store_market_teacher_notify();

revoke all on function public.store_market_teacher_notify() from public;

notify pgrst, 'reload schema';
