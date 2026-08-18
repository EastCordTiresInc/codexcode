-- EastCord Tires: used-tire Stripe orders
-- Run in Supabase SQL Editor on the same project as usedtireinventory.

create table if not exists public.used_tire_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  customer_name text,
  customer_email text,
  customer_phone text,
  fulfillment_preference text not null default 'Pickup',
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  subtotal numeric(10,2) not null,
  hst_amount numeric(10,2) not null,
  total_with_hst numeric(10,2) not null,
  tax_rate numeric(6,4) not null default 0.13,
  payment_status text not null default 'pending_checkout',
  fulfillment_status text not null default 'unfulfilled',
  stripe_session_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.used_tire_orders enable row level security;

drop policy if exists "Customers can read own used tire orders" on public.used_tire_orders;
create policy "Customers can read own used tire orders"
on public.used_tire_orders for select
using (auth.uid() = customer_id);

create index if not exists used_tire_orders_customer_id_idx
  on public.used_tire_orders (customer_id);

create index if not exists used_tire_orders_stripe_session_id_idx
  on public.used_tire_orders (stripe_session_id);

-- Atomic stock hold / restore. Call from Netlify with the service role.
-- p_tire_id is the usedtireinventory.id number, not a column name.
create or replace function public.decrement_used_tire_stock(p_tire_id bigint, p_qty integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer;
begin
  if p_qty is null or p_qty < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  update public.usedtireinventory
  set
    current_stock = current_stock - p_qty,
    updated_at = now()
  where id = p_tire_id
    and current_stock >= p_qty
  returning current_stock into remaining;

  if remaining is null then
    raise exception 'Not enough stock for tire %', p_tire_id
      using errcode = 'P0001';
  end if;

  return remaining;
end;
$$;

create or replace function public.restore_used_tire_stock(p_tire_id bigint, p_qty integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer;
begin
  if p_qty is null or p_qty < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  update public.usedtireinventory
  set
    current_stock = current_stock + p_qty,
    updated_at = now()
  where id = p_tire_id
  returning current_stock into remaining;

  if remaining is null then
    raise exception 'Tire % was not found', p_tire_id
      using errcode = 'P0001';
  end if;

  return remaining;
end;
$$;

revoke all on function public.decrement_used_tire_stock(bigint, integer) from public;
revoke all on function public.restore_used_tire_stock(bigint, integer) from public;
grant execute on function public.decrement_used_tire_stock(bigint, integer) to service_role;
grant execute on function public.restore_used_tire_stock(bigint, integer) to service_role;
