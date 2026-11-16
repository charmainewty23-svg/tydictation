-- LearniTY: class-battle cheer counter (clap / hearts / ribbon / 叻).
--
-- Anyone signed in can add taps for a finished class room (Word Battle or
-- Drive & Go!). Clients poll the totals while the ceremony is on screen.
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists public.class_battle_cheers (
    room_id    text not null,
    kind       text not null check (kind in ('clap','heart','ribbon','lek')),
    taps       int not null default 0,
    updated_at timestamptz not null default now(),
    primary key (room_id, kind)
);

alter table public.class_battle_cheers enable row level security;

create or replace function public.cheer_class_battle(p_room text, p_kind text, p_count int default 1)
returns table (kind text, taps int)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_room text := left(coalesce(p_room, ''), 80);
    v_n    int  := greatest(1, least(coalesce(p_count, 1), 50));
begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    if v_room = '' then raise exception 'ROOM_REQUIRED'; end if;
    if p_kind not in ('clap','heart','ribbon','lek') then raise exception 'BAD_KIND'; end if;

    insert into public.class_battle_cheers (room_id, kind, taps)
    values (v_room, p_kind, v_n)
    on conflict (room_id, kind) do update
       set taps = public.class_battle_cheers.taps + v_n,
           updated_at = now();

    return query
        select c.kind, c.taps from public.class_battle_cheers c where c.room_id = v_room;
end;
$fn$;

create or replace function public.class_battle_cheers(p_room text)
returns table (kind text, taps int)
language sql
stable
security definer
set search_path = public
as $fn$
    select c.kind, c.taps
      from public.class_battle_cheers c
     where c.room_id = left(coalesce(p_room, ''), 80);
$fn$;

revoke all on function public.cheer_class_battle(text, text, int) from public, anon;
revoke all on function public.class_battle_cheers(text) from public, anon;
grant execute on function public.cheer_class_battle(text, text, int) to authenticated;
grant execute on function public.class_battle_cheers(text) to authenticated;

notify pgrst, 'reload schema';
