-- LearniTY: teacher-set time limit for classroom battles.
--
-- Adds an `ends_at` deadline to both classroom tables plus host-only RPCs to
-- set (or clear) it. The host client shows a countdown and force-finishes the
-- room when the clock runs out; the existing End battle buttons still work at
-- any time. No existing column or function signature changes.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- Works for Word Battle class rooms and Drive & Go! class rooms.

alter table public.battle_rooms add column if not exists ends_at timestamptz;
alter table public.drive_and_go_rooms add column if not exists ends_at timestamptz;

-- ---------- Word Battle ----------

create or replace function public.set_battle_deadline(p_room_id uuid, p_seconds int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $dl$
declare
    v_ends timestamptz;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    update public.battle_rooms
       set ends_at = case
               when coalesce(p_seconds, 0) > 0
               then now() + make_interval(secs => greatest(30, least(p_seconds, 7200)))
               else null
           end
     where id = p_room_id
       and host_id = auth.uid()
       and status = 'playing'
    returning ends_at into v_ends;

    if not found then
        raise exception 'NOT_HOST_OR_NOT_PLAYING';
    end if;
    return v_ends;
end;
$dl$;

revoke all on function public.set_battle_deadline(uuid, int) from public, anon;
grant execute on function public.set_battle_deadline(uuid, int) to authenticated;

-- ---------- Drive & Go! ----------

create or replace function public.set_drive_and_go_deadline(p_room_id uuid, p_seconds int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $dl$
declare
    v_ends timestamptz;
begin
    if auth.uid() is null then
        raise exception 'NOT_AUTHENTICATED';
    end if;

    update public.drive_and_go_rooms
       set ends_at = case
               when coalesce(p_seconds, 0) > 0
               then now() + make_interval(secs => greatest(30, least(p_seconds, 7200)))
               else null
           end
     where id = p_room_id
       and host_id = auth.uid()
       and status = 'playing'
    returning ends_at into v_ends;

    if not found then
        raise exception 'NOT_HOST_OR_NOT_PLAYING';
    end if;
    return v_ends;
end;
$dl$;

revoke all on function public.set_drive_and_go_deadline(uuid, int) from public, anon;
grant execute on function public.set_drive_and_go_deadline(uuid, int) to authenticated;

notify pgrst, 'reload schema';
