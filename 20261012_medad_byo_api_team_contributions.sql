-- Medad production-safe team contribution + invite eligibility migration.
-- Uses the existing integer-DZD personal wallet and team ledger schema.

-- Paid/subscription eligibility remains unchanged. Team invitation RPCs do not impose the old 10-sheet gate.

alter table public.medad_teams add column if not exists subscription_goal integer not null default 1000 check (subscription_goal >= 100);

create table if not exists public.medad_team_contributions (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.medad_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null unique,
  amount integer not null check (amount >= 50),
  wallet_balance_after integer not null,
  created_at timestamptz not null default now()
);
create index if not exists medad_team_contributions_team_created_idx on public.medad_team_contributions(team_id, created_at desc);
alter table public.medad_team_contributions enable row level security;
drop policy if exists "team members read contributions" on public.medad_team_contributions;
create policy "team members read contributions" on public.medad_team_contributions for select to authenticated
 using (exists(select 1 from public.medad_team_members m where m.team_id=medad_team_contributions.team_id and m.user_id=auth.uid()));
revoke all on public.medad_team_contributions from anon, authenticated;
grant select on public.medad_team_contributions to authenticated;

create or replace function public.medad_team_create(p_name text, p_goal integer) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 then raise exception 'bad_name'; end if;
  if p_goal is null or p_goal < 100 or p_goal > 10000000 then raise exception 'bad_goal'; end if;
  if exists(select 1 from public.medad_team_members where user_id=auth.uid()) then raise exception 'already_in_team'; end if;
  insert into public.medad_teams(name,owner_id,subscription_goal) values(v_name,auth.uid(),p_goal) returning * into v_team;
  insert into public.medad_team_members(team_id,user_id,role) values(v_team.id,auth.uid(),'owner');
  return jsonb_build_object('id',v_team.id,'name',v_team.name,'invite_code',v_team.invite_code,'invite_locked',false);
end $$;

create or replace function public.medad_team_create(p_name text) returns jsonb
language sql security definer set search_path = public, auth as $$
  select public.medad_team_create(p_name, 1000);
$$;

create or replace function public.medad_team_contribute(p_amount integer, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); m public.medad_team_members; t public.medad_teams; bal integer; nb integer; tb numeric; l public.medad_team_ledger; prior public.medad_team_contributions;
begin
  if uid is null then raise exception 'auth_required'; end if;
  if p_request_id is null or p_amount is null or p_amount < 50 or p_amount > 1000000 then raise exception 'bad_amount'; end if;
  select * into m from public.medad_team_members where user_id=uid;
  if m.user_id is null then raise exception 'not_in_team'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 3));
  select * into prior from public.medad_team_contributions where request_id=p_request_id;
  if prior.id is not null then
    if prior.user_id <> uid or prior.team_id <> m.team_id then raise exception 'forbidden'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'team_balance',(select shared_balance from public.medad_teams where id=m.team_id),'wallet_balance',coalesce((select balance from public.wallets where user_id=uid),0));
  end if;
  select balance into bal from public.wallets where user_id=uid for update;
  if bal is null or bal < p_amount then raise exception 'insufficient_funds'; end if;
  select * into t from public.medad_teams where id=m.team_id for update;
  update public.wallets set balance=balance-p_amount, updated_at=now() where user_id=uid returning balance into nb;
  insert into public.wallet_ledger(user_id,kind,amount,balance_after,ref_type,ref_id,description)
  values(uid,'team_contribution',-p_amount,nb,'team',p_request_id,'مساهمة في صندوق الفريق: '||t.name);
  update public.medad_teams set shared_balance=shared_balance+p_amount where id=t.id returning shared_balance into tb;
  insert into public.medad_team_ledger(team_id,user_id,kind,amount,balance_after,ref_id,description)
  values(t.id,uid,'contribution',p_amount,tb,p_request_id,'مساهمة عضو');
  insert into public.medad_team_contributions(team_id,user_id,request_id,amount,wallet_balance_after)
  values(t.id,uid,p_request_id,p_amount,nb);
  insert into public.audit_logs(user_id,action,details) values(uid,'TEAM_CONTRIBUTION',jsonb_build_object('team_id',t.id,'amount',p_amount,'request_id',p_request_id));
  return jsonb_build_object('ok',true,'team_balance',tb,'goal',t.subscription_goal,'wallet_balance',nb);
end $$;

create or replace function public.medad_team_summary(p_month date default date_trunc('month',now())::date) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_usage jsonb; v_owner boolean; v_ledger jsonb;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select t.* into v_team from public.medad_teams t join public.medad_team_members m on m.team_id=t.id where m.user_id=auth.uid() limit 1;
  if v_team.id is null then return jsonb_build_object('team',null,'usage','[]'::jsonb,'ledger','[]'::jsonb); end if;
  v_owner := v_team.owner_id=auth.uid();
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,'role',m.role,
    'member_name',coalesce(nullif(p.full_name,''),split_part(u.email,'@',1)),
    'email',case when v_owner then u.email else null end,
    'generations',coalesce(x.generations,0),'units',coalesce(x.units,0),
    'contributed',coalesce(c.total,0)
  ) order by coalesce(c.total,0) desc,m.joined_at),'[]'::jsonb) into v_usage
  from public.medad_team_members m join auth.users u on u.id=m.user_id
  left join public.user_document_profiles p on p.user_id=m.user_id
  left join (select user_id,count(*) generations,sum(units) units from public.medad_team_usage
    where team_id=v_team.id and created_at>=date_trunc('month',p_month::timestamp)
    and created_at<date_trunc('month',p_month::timestamp)+interval '1 month' group by user_id) x on x.user_id=m.user_id
  left join (select user_id,sum(amount) total from public.medad_team_ledger where team_id=v_team.id and kind='contribution' group by user_id) c on c.user_id=m.user_id
  where m.team_id=v_team.id;
  select coalesce(jsonb_agg(jsonb_build_object('kind',l.kind,'amount',l.amount,'balance_after',l.balance_after,'description',l.description,
    'member_name',coalesce(nullif(p.full_name,''),split_part(u.email,'@',1)),'created_at',l.created_at) order by l.id desc),'[]'::jsonb)
  into v_ledger from (select * from public.medad_team_ledger where team_id=v_team.id order by id desc limit 30) l
  join auth.users u on u.id=l.user_id left join public.user_document_profiles p on p.user_id=l.user_id;
  return jsonb_build_object('team',jsonb_build_object('id',v_team.id,'name',v_team.name,'owner_id',v_team.owner_id,'is_owner',v_owner,
    'balance',v_team.shared_balance,'shared_balance',v_team.shared_balance,'subscription_goal',v_team.subscription_goal,
    'invite_code',case when v_owner then v_team.invite_code else null end,'invite_locked',false),
    'invite_status',null,'usage',v_usage,'ledger',v_ledger);
end $$;

revoke all on function public.medad_team_create(text), public.medad_team_create(text,integer), public.medad_team_contribute(integer,uuid), public.medad_team_summary(date) from public, anon;
grant execute on function public.medad_team_create(text), public.medad_team_create(text,integer), public.medad_team_contribute(integer,uuid), public.medad_team_summary(date) to authenticated;
