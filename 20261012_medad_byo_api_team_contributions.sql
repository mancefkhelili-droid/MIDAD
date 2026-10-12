-- Medad: BYOK AI + team fundraising from existing personal wallets.
-- Review before production. Uses existing public.wallets and public.wallet_ledger tables.

-- Remove the subscription / 10-sheet gate from team invitations and BYOK AI access.
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

alter table public.medad_teams add column if not exists subscription_goal numeric(12,2) not null default 1000 check (subscription_goal >= 100);

create table if not exists public.medad_team_contributions (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.medad_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  wallet_balance_after numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists medad_team_contrib_team_created_idx on public.medad_team_contributions(team_id, created_at desc);
alter table public.medad_team_contributions enable row level security;
drop policy if exists "team members read contributions" on public.medad_team_contributions;
create policy "team members read contributions" on public.medad_team_contributions for select to authenticated
 using (exists(select 1 from public.medad_team_members m where m.team_id=medad_team_contributions.team_id and m.user_id=auth.uid()));
revoke all on public.medad_team_contributions from anon, authenticated;
grant select on public.medad_team_contributions to authenticated;

-- Keep the legacy one-argument RPC compatible with older clients.
create or replace function public.medad_team_create(p_name text) returns jsonb
language sql security definer set search_path = public, auth as $$
  select public.medad_team_create(p_name, 1000::numeric);
$$;

-- New overload lets the owner set a fundraising target; everyone can invite immediately.
create or replace function public.medad_team_create(p_name text, p_goal numeric default 1000) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_name text := trim(coalesce(p_name, '')); v_goal numeric := coalesce(p_goal,1000);
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 then raise exception 'bad_name'; end if;
  if v_goal < 100 or v_goal > 10000000 then raise exception 'bad_goal'; end if;
  if exists(select 1 from public.medad_team_members where user_id=auth.uid()) then raise exception 'already_in_team'; end if;
  insert into public.medad_teams(name,owner_id,subscription_goal) values(v_name,auth.uid(),v_goal) returning * into v_team;
  insert into public.medad_team_members(team_id,user_id,role) values(v_team.id,auth.uid(),'owner');
  return jsonb_build_object('id',v_team.id,'name',v_team.name,'invite_code',v_team.invite_code,'invite_locked',false);
end $$;

create or replace function public.medad_team_join(p_code text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_members int;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if exists(select 1 from public.medad_team_members where user_id=auth.uid()) then raise exception 'already_in_team'; end if;
  if (select count(*) from public.medad_team_join_attempts where user_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'too_many_attempts'; end if;
  select * into v_team from public.medad_teams where invite_code=upper(trim(coalesce(p_code,'')));
  if v_team.id is null then insert into public.medad_team_join_attempts(user_id) values(auth.uid()); return jsonb_build_object('ok',false,'error','invalid_invite_code'); end if;
  select count(*) into v_members from public.medad_team_members where team_id=v_team.id;
  if v_members>=20 then return jsonb_build_object('ok',false,'error','team_full'); end if;
  insert into public.medad_team_members(team_id,user_id,role) values(v_team.id,auth.uid(),'member');
  return jsonb_build_object('ok',true,'id',v_team.id,'name',v_team.name);
end $$;

create or replace function public.medad_team_regenerate_code() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_code text;
begin
 if auth.uid() is null then raise exception 'auth_required'; end if;
 select * into v_team from public.medad_teams where owner_id=auth.uid();
 if v_team.id is null then raise exception 'not_owner'; end if;
 v_code:=upper(encode(gen_random_bytes(6),'hex'));
 update public.medad_teams set invite_code=v_code where id=v_team.id;
 return jsonb_build_object('invite_code',v_code);
end $$;

create or replace function public.medad_team_summary(p_month date default date_trunc('month',now())::date) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_usage jsonb; v_owner boolean;
begin
 if auth.uid() is null then raise exception 'auth_required'; end if;
 select t.* into v_team from public.medad_teams t join public.medad_team_members m on m.team_id=t.id where m.user_id=auth.uid() limit 1;
 if v_team.id is null then return jsonb_build_object('team',null,'usage','[]'::jsonb); end if;
 v_owner:=v_team.owner_id=auth.uid();
 select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'member_name',coalesce(nullif(p.full_name,''),split_part(u.email,'@',1)),'email',case when v_owner then u.email else null end,'generations',coalesce(x.generations,0),'units',coalesce(x.units,0)) order by coalesce(x.generations,0) desc),'[]'::jsonb)
 into v_usage from public.medad_team_members m join auth.users u on u.id=m.user_id
 left join public.user_document_profiles p on p.user_id=m.user_id
 left join (select user_id,count(*) generations,sum(units) units from public.medad_team_usage where team_id=v_team.id and created_at>=date_trunc('month',p_month::timestamp) and created_at<date_trunc('month',p_month::timestamp)+interval '1 month' group by user_id) x on x.user_id=m.user_id
 where m.team_id=v_team.id;
 return jsonb_build_object('team',jsonb_build_object('id',v_team.id,'name',v_team.name,'owner_id',v_team.owner_id,'is_owner',v_owner,'invite_code',case when v_owner then v_team.invite_code else null end,'invite_locked',false,'shared_balance',v_team.shared_balance,'subscription_goal',v_team.subscription_goal), 'invite_status',null,'usage',v_usage);
end $$;

-- Contribution is atomic: lock personal wallet, debit it, credit team fund, write ledger/history.
create or replace function public.medad_team_contribute(p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_balance numeric; v_after numeric; v_amount numeric := round(coalesce(p_amount,0),2);
begin
 if auth.uid() is null then raise exception 'auth_required'; end if;
 if v_amount < 50 or v_amount > 1000000 then raise exception 'bad_contribution'; end if;
 select t.* into v_team from public.medad_teams t join public.medad_team_members m on m.team_id=t.id where m.user_id=auth.uid() limit 1 for update of t;
 if v_team.id is null then raise exception 'not_in_team'; end if;
 select balance into v_balance from public.wallets where user_id=auth.uid() for update;
 if not found or v_balance < v_amount then raise exception 'insufficient_wallet'; end if;
 update public.wallets set balance=balance-v_amount, updated_at=now() where user_id=auth.uid() returning balance into v_after;
 update public.medad_teams set shared_balance=shared_balance+v_amount where id=v_team.id returning * into v_team;
 insert into public.wallet_ledger(user_id,kind,amount,balance_after,ref_type,ref_id,description)
 values(auth.uid(),'team_contribution',-v_amount,v_after,'team',v_team.id,'مساهمة في صندوق الفريق: '||v_team.name);
 insert into public.medad_team_contributions(team_id,user_id,amount,wallet_balance_after) values(v_team.id,auth.uid(),v_amount,v_after);
 return jsonb_build_object('ok',true,'team_balance',v_team.shared_balance,'goal',v_team.subscription_goal,'wallet_balance',v_after);
end $$;

revoke all on function public.medad_team_create(text), public.medad_team_create(text,numeric), public.medad_team_join(text), public.medad_team_regenerate_code(), public.medad_team_summary(date), public.medad_team_contribute(numeric) from public, anon;
grant execute on function public.medad_team_create(text), public.medad_team_create(text,numeric), public.medad_team_join(text), public.medad_team_regenerate_code(), public.medad_team_summary(date), public.medad_team_contribute(numeric) to authenticated;
