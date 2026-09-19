create extension if not exists pgcrypto;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null default '',
  storage_path text,
  price_per_copy integer not null check (price_per_copy >= 0),
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id),
  copies_count integer not null check (copies_count between 1 and 99),
  calculated_price integer not null check (calculated_price >= 0),
  currency text not null default 'DZD',
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  provider_checkout_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider_reference text not null unique,
  amount integer not null check (amount >= 0),
  currency text not null default 'DZD',
  status text not null check (status in ('completed', 'failed')),
  raw_event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.print_licenses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  license_key text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id),
  total_prints_allowed integer not null check (total_prints_allowed > 0),
  prints_remaining integer not null check (prints_remaining >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.print_licenses enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists published_documents_read on public.documents;
create policy published_documents_read on public.documents for select using (is_published = true);

drop policy if exists own_orders_read on public.orders;
create policy own_orders_read on public.orders for select using (auth.uid() = user_id);

drop policy if exists own_licenses_read on public.print_licenses;
create policy own_licenses_read on public.print_licenses for select using (auth.uid() = user_id);

revoke all on public.payments from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.print_licenses from anon, authenticated;

create or replace function public.decrement_print_counter(p_license_key text, p_document_id uuid, p_user_id uuid)
returns table(success boolean, remaining_prints integer)
language plpgsql
security definer
set search_path = public
as $$
declare updated_count integer;
begin
  update public.print_licenses
  set prints_remaining = prints_remaining - 1
  where license_key = p_license_key
    and document_id = p_document_id
    and user_id = p_user_id
    and prints_remaining > 0
  returning prints_remaining into updated_count;

  if updated_count is null then
    return query select false, 0;
    return;
  end if;

  insert into public.audit_logs(user_id, action, details)
  values (p_user_id, 'PRINT_EXECUTED', jsonb_build_object('license_key', p_license_key, 'document_id', p_document_id, 'remaining_prints', updated_count));

  return query select true, updated_count;
end;
$$;

revoke all on function public.decrement_print_counter(text, uuid, uuid) from public;
grant execute on function public.decrement_print_counter(text, uuid, uuid) to service_role;
