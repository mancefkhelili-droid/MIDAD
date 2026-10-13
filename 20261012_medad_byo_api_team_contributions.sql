-- Medad: OPTIONAL change only. Safe to run (it replaces ONE function, no overloads).
--
-- IMPORTANT: do NOT run the previous version of this file. The live database already
-- contains newer versions of medad_team_create(text,integer), medad_team_contribute(integer,uuid),
-- medad_team_summary(date), medad_team_join, medad_team_leave, medad_team_regenerate_code and
-- medad_team_buy_plan. Re-creating them with numeric arguments would add ambiguous overloads
-- (PostgREST "could not choose the best candidate function") and drop the team ledger entries.
--
-- Purpose: remove the "subscription or more than 10 sheets" requirement from medad_paid_status
-- (README item 3). Currently the live function returns required_sheets=10 and
-- eligible = subscribed OR sheets_remaining > 10. Skip this file if you want to keep that rule.
create or replace function public.medad_paid_status(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'subscribed', coalesce(bool_or(plan <> 'promo'), false),
    'unlimited', coalesce(bool_or(sheets_total is null), false),
    'sheets_remaining', coalesce(sum(case when sheets_total is not null then greatest(sheets_total - sheets_used, 0) else 0 end), 0),
    'required_sheets', 0,
    'eligible', true
  ) from public.subscriptions
  where user_id = p_user and starts_at <= now() and expires_at > now();
$$;
