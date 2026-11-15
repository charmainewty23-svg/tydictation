-- LearniTY: keep the owner/teacher test account at 10,000 Paws.
-- Safe to re-run. Only touches one ledger row.

do $topup$
declare
    v_teacher uuid;
    v_others int;
    v_target int := 10000;
begin
    select id into v_teacher
      from auth.users
     where lower(email) = 'tywong@lstyoungkhl.edu.hk'
     limit 1;
    if v_teacher is null then
        return;
    end if;

    -- Everything except this top-up row: welcome + practice + spending +
    -- the older 2000 test top-up all count.
    select coalesce(sum(amount), 0)::int into v_others
      from public.paw_ledger
     where user_id = v_teacher
       and ref_key <> 'teacher_test_topup_10000';

    if v_others < v_target then
        insert into public.paw_ledger (user_id, amount, reason, ref_key)
        values (v_teacher, v_target - v_others, 'teacher_test_topup',
                'teacher_test_topup_10000')
        on conflict (user_id, ref_key) do update set amount = excluded.amount;
    end if;
end;
$topup$;
