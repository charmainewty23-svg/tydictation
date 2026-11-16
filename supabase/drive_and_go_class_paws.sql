-- LearniTY Drive & Go!: Paws bonus for the top 3 in a class room.
-- 1st +20, 2nd +13, 3rd +8.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Requires store.sql (paw_ledger) and drive_and_go_class_room.sql.

create or replace function public.paw_trg_dg_class_battle()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    r record;
    v_place int := 0;
    v_points int := 0;
    v_max int;
begin
    if new.status <> 'finished'
       or old.status is not distinct from 'finished' then
        return new;
    end if;
    if to_regclass('public.paw_ledger') is null then
        return new;
    end if;

    v_max := coalesce((to_jsonb(new) ->> 'max_players')::int, 5);
    if v_max <= 5 then
        return new;
    end if;

    for r in
        select p.user_id
          from public.drive_and_go_players p
         where p.room_id = new.id
         order by p.composite_score desc,
                  p.finished_at asc nulls last,
                  (p.correct::double precision / nullif(p.correct + p.wrong, 0)) desc nulls last,
                  p.score desc,
                  p.user_id
         limit 3
    loop
        v_place := v_place + 1;
        v_points := case v_place when 1 then 20 when 2 then 13 else 8 end;
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        values (
            r.user_id,
            v_points,
            'dg_class_battle',
            'dg_class_battle:' || new.id::text || ':' || r.user_id::text
        )
        on conflict (user_id, ref_key) do nothing;
    end loop;

    return new;
end;
$fn$;

drop trigger if exists paw_dg_class_battle_after_update on public.drive_and_go_rooms;
create trigger paw_dg_class_battle_after_update
after update on public.drive_and_go_rooms
for each row execute function public.paw_trg_dg_class_battle();

revoke all on function public.paw_trg_dg_class_battle() from public;

notify pgrst, 'reload schema';
