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
