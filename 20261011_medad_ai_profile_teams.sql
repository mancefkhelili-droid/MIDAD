-- Medad v2: reusable profile, AI usage control, team workspaces (hardened).
-- Replaces the first draft of this file. Safe to run once; does not touch wallet/order/license tables.
create extension if not exists pgcrypto;

-- ===== Profile (private; RLS: owner only) =====
create table if not exists public.user_document_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  birth_date date,
  address text not null default '' check (char_length(address) <= 240),
  phone text not null default '' check (char_length(phone) <= 40),
  organization text not null default '' check (char_length(organization) <= 160),
  job_title text not null default '' check (char_length(job_title) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.user_document_profiles enable row level security;
drop policy if exists "profile owner read" on public.user_document_profiles;
create policy "profile owner read" on public.user_document_profiles for select to authenticated using (auth.uid() = user_id);
drop policy if exists "profile owner insert" on public.user_document_profiles;
create policy "profile owner insert" on public.user_document_profiles for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "profile owner update" on public.user_document_profiles;
create policy "profile owner update" on public.user_document_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===== AI settings (kill switch + cost limits; edit with SQL) =====
create table if not exists public.medad_ai_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  user_daily_limit int not null default 20 check (user_daily_limit between 1 and 200),
  global_daily_limit int not null default 400 check (global_daily_limit between 1 and 100000),
  require_paid boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.medad_ai_settings (id) values (1) on conflict (id) do nothing;
alter table public.medad_ai_settings enable row level security;

create table if not exists public.medad_ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'other',
  language text not null default 'ar',
  had_attachment boolean not null default false,
  model text not null,
  created_at timestamptz not null default now()
);
create index if not exists medad_ai_usage_user_created_idx on public.medad_ai_usage(user_id, created_at desc);
create index if not exists medad_ai_usage_created_idx on public.medad_ai_usage(created_at desc);
alter table public.medad_ai_usage enable row level security;
drop policy if exists "users read own ai usage" on public.medad_ai_usage;
create policy "users read own ai usage" on public.medad_ai_usage for select to authenticated using (user_id = auth.uid());

-- ===== Teams =====
create table if not exists public.medad_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(encode(gen_random_bytes(6), 'hex')),
  shared_balance numeric(12,2) not null default 0 check (shared_balance >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.medad_team_members (
  team_id uuid not null references public.medad_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create unique index if not exists medad_team_members_one_team on public.medad_team_members(user_id);
create table if not exists public.medad_team_usage (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.medad_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null default 'ai_document',
  units integer not null default 1 check (units > 0),
  created_at timestamptz not null default now()
);
create table if not exists public.medad_team_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists medad_team_usage_team_created_idx on public.medad_team_usage(team_id, created_at desc);
create index if not exists medad_team_join_attempts_idx on public.medad_team_join_attempts(user_id, created_at desc);

alter table public.medad_teams enable row level security;
alter table public.medad_team_members enable row level security;
alter table public.medad_team_usage enable row level security;
alter table public.medad_team_join_attempts enable row level security;

drop policy if exists "team members can read their teams" on public.medad_teams;
create policy "team members can read their teams" on public.medad_teams for select to authenticated
  using (exists (select 1 from public.medad_team_members m where m.team_id = medad_teams.id and m.user_id = auth.uid()));
drop policy if exists "members can read own memberships" on public.medad_team_members;
create policy "members can read own memberships" on public.medad_team_members for select to authenticated using (user_id = auth.uid());
-- The first draft compared m.team_id = team_id, which resolved to m.team_id = m.team_id and exposed every team's usage to any member.
drop policy if exists "members can read team usage" on public.medad_team_usage;
create policy "members can read team usage" on public.medad_team_usage for select to authenticated
  using (exists (select 1 from public.medad_team_members m where m.team_id = medad_team_usage.team_id and m.user_id = auth.uid()));

-- ===== Table privileges: reads through RLS only; all writes go through the functions below =====
revoke all on public.user_document_profiles, public.medad_ai_settings, public.medad_ai_usage, public.medad_teams,
  public.medad_team_members, public.medad_team_usage, public.medad_team_join_attempts from anon, authenticated;
grant select, insert, update on public.user_document_profiles to authenticated;
grant select on public.medad_ai_usage, public.medad_teams, public.medad_team_members, public.medad_team_usage to authenticated;

-- ===== Who may invite / use paid AI: an active PAID subscription, or MORE than 10 sheets left =====
create or replace function public.medad_paid_status(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'subscribed', coalesce(bool_or(plan <> 'promo'), false),
    'unlimited', coalesce(bool_or(sheets_total is null), false),
    'sheets_remaining', coalesce(sum(case when sheets_total is not null then greatest(sheets_total - sheets_used, 0) else 0 end), 0),
    'required_sheets', 10,
    'eligible', coalesce(bool_or(plan <> 'promo'), false)
                or coalesce(sum(case when sheets_total is not null then greatest(sheets_total - sheets_used, 0) else 0 end), 0) > 10)
  from public.subscriptions where user_id = p_user and starts_at <= now() and expires_at > now();
$$;
revoke all on function public.medad_paid_status(uuid) from public, anon, authenticated;
grant execute on function public.medad_paid_status(uuid) to service_role;

create or replace function public.medad_invite_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  return public.medad_paid_status(auth.uid());
end $$;

create or replace function public.medad_team_create(p_name text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_ok boolean; v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 then raise exception 'bad_name'; end if;
  if exists (select 1 from public.medad_team_members where user_id = auth.uid()) then raise exception 'already_in_team'; end if;
  insert into public.medad_teams(name, owner_id) values (v_name, auth.uid()) returning * into v_team;
  insert into public.medad_team_members(team_id, user_id, role) values (v_team.id, auth.uid(), 'owner');
  v_ok := (public.medad_paid_status(auth.uid())->>'eligible')::boolean;
  return jsonb_build_object('id', v_team.id, 'name', v_team.name,
    'invite_code', case when v_ok then v_team.invite_code else null end, 'invite_locked', not v_ok);
end $$;

create or replace function public.medad_team_join(p_code text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_members int;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if exists (select 1 from public.medad_team_members where user_id = auth.uid()) then raise exception 'already_in_team'; end if;
  if (select count(*) from public.medad_team_join_attempts where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_attempts';
  end if;
  select * into v_team from public.medad_teams where invite_code = upper(trim(coalesce(p_code, '')));
  if v_team.id is null then
    insert into public.medad_team_join_attempts(user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'invalid_invite_code');
  end if;
  -- Invitations only work while the team owner is subscribed or still has more than 10 sheets.
  if not (public.medad_paid_status(v_team.owner_id)->>'eligible')::boolean then
    return jsonb_build_object('ok', false, 'error', 'inviter_not_eligible');
  end if;
  select count(*) into v_members from public.medad_team_members where team_id = v_team.id;
  if v_members >= 20 then return jsonb_build_object('ok', false, 'error', 'team_full'); end if;
  insert into public.medad_team_members(team_id, user_id, role) values (v_team.id, auth.uid(), 'member');
  return jsonb_build_object('ok', true, 'id', v_team.id, 'name', v_team.name);
end $$;

create or replace function public.medad_team_summary(p_month date default date_trunc('month', now())::date) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_usage jsonb; v_owner boolean; v_status jsonb; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select t.* into v_team from public.medad_teams t join public.medad_team_members m on m.team_id = t.id where m.user_id = auth.uid() limit 1;
  if v_team.id is null then return jsonb_build_object('team', null, 'usage', '[]'::jsonb); end if;
  v_owner := v_team.owner_id = auth.uid();
  v_status := public.medad_paid_status(v_team.owner_id);
  v_ok := (v_status->>'eligible')::boolean;
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', m.user_id, 'role', m.role,
      'member_name', coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)),
      'email', case when v_owner then u.email else null end,
      'generations', coalesce(x.generations, 0), 'units', coalesce(x.units, 0)) order by coalesce(x.generations, 0) desc), '[]'::jsonb)
    into v_usage
    from public.medad_team_members m join auth.users u on u.id = m.user_id
    left join public.user_document_profiles p on p.user_id = m.user_id
    left join (select user_id, count(*) generations, sum(units) units from public.medad_team_usage
               where team_id = v_team.id and created_at >= date_trunc('month', p_month::timestamp)
                 and created_at < date_trunc('month', p_month::timestamp) + interval '1 month' group by user_id) x on x.user_id = m.user_id
    where m.team_id = v_team.id;
  return jsonb_build_object(
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'owner_id', v_team.owner_id, 'is_owner', v_owner,
      'invite_code', case when v_owner and v_ok then v_team.invite_code else null end,
      'invite_locked', v_owner and not v_ok),
    'invite_status', case when v_owner then v_status else null end,
    'usage', v_usage);
end $$;

create or replace function public.medad_team_regenerate_code() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams; v_code text;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into v_team from public.medad_teams where owner_id = auth.uid();
  if v_team.id is null then raise exception 'not_owner'; end if;
  if not (public.medad_paid_status(auth.uid())->>'eligible')::boolean then raise exception 'invite_not_allowed'; end if;
  v_code := upper(encode(gen_random_bytes(6), 'hex'));
  update public.medad_teams set invite_code = v_code where id = v_team.id;
  return jsonb_build_object('invite_code', v_code);
end $$;

create or replace function public.medad_team_leave() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_m public.medad_team_members; v_others int;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into v_m from public.medad_team_members where user_id = auth.uid();
  if v_m.user_id is null then raise exception 'not_in_team'; end if;
  select count(*) into v_others from public.medad_team_members where team_id = v_m.team_id and user_id <> auth.uid();
  if v_m.role = 'owner' then
    if v_others > 0 then raise exception 'owner_has_members'; end if;
    delete from public.medad_teams where id = v_m.team_id;
  else
    delete from public.medad_team_members where team_id = v_m.team_id and user_id = auth.uid();
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.medad_team_remove_member(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_team public.medad_teams;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into v_team from public.medad_teams where owner_id = auth.uid();
  if v_team.id is null then raise exception 'not_owner'; end if;
  if p_user = auth.uid() then raise exception 'cannot_remove_owner'; end if;
  delete from public.medad_team_members where team_id = v_team.id and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

-- ===== AI: atomic reservation BEFORE calling the model (service role only, used by the Edge Function) =====
create or replace function public.medad_ai_reserve(p_user uuid, p_kind text, p_language text, p_had_attachment boolean, p_model text) returns bigint
language plpgsql security definer set search_path = public as $$
declare s public.medad_ai_settings; v_id bigint;
begin
  select * into s from public.medad_ai_settings where id = 1;
  if not s.enabled then raise exception 'ai_disabled'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 7));
  if s.require_paid and not (public.medad_paid_status(p_user)->>'eligible')::boolean then raise exception 'paid_required'; end if;
  if (select count(*) from public.medad_ai_usage where user_id = p_user and created_at > now() - interval '24 hours') >= s.user_daily_limit then raise exception 'rate_limited'; end if;
  if (select count(*) from public.medad_ai_usage where created_at > now() - interval '24 hours') >= s.global_daily_limit then raise exception 'global_limit'; end if;
  insert into public.medad_ai_usage(user_id, kind, language, had_attachment, model) values (p_user, p_kind, p_language, p_had_attachment, p_model) returning id into v_id;
  return v_id;
end $$;
create or replace function public.medad_ai_release(p_id bigint) returns void
language sql security definer set search_path = public as $$ delete from public.medad_ai_usage where id = p_id; $$;

create or replace function public.medad_record_team_ai_usage(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.medad_team_usage(team_id, user_id, action, units)
  select m.team_id, p_user_id, 'ai_document', 1 from public.medad_team_members m where m.user_id = p_user_id;
end $$;

-- ===== Function privileges =====
do $$
declare f text;
begin
  foreach f in array array['medad_ai_reserve(uuid,text,text,boolean,text)','medad_ai_release(bigint)','medad_record_team_ai_usage(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['medad_invite_status()','medad_team_create(text)','medad_team_join(text)','medad_team_summary(date)',
                           'medad_team_regenerate_code()','medad_team_leave()','medad_team_remove_member(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
