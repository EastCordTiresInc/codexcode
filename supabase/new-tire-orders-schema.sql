-- EastCord Tires: new-tire orders from the TireConnect widget (and optional Stripe).
-- Run in Supabase SQL Editor on the same project as used_tire_orders.

create table if not exists public.new_tire_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  customer_name text,
  customer_email text,
  customer_phone text,
  fulfillment_preference text not null default 'Pickup',
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  vehicle jsonb not null default '{}'::jsonb,
  notes text,
  subtotal numeric(10,2) not null,
  hst_amount numeric(10,2) not null default 0,
  total_with_hst numeric(10,2) not null,
  tax_rate numeric(6,4) not null default 0,
  payment_status text not null default 'pending_checkout',
  fulfillment_status text not null default 'unfulfilled',
  stripe_session_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.new_tire_orders enable row level security;

drop policy if exists "Customers can read own new tire orders" on public.new_tire_orders;
create policy "Customers can read own new tire orders"
on public.new_tire_orders for select
using (auth.uid() = customer_id);

create index if not exists new_tire_orders_customer_id_idx
  on public.new_tire_orders (customer_id);

create index if not exists new_tire_orders_stripe_session_id_idx
  on public.new_tire_orders (stripe_session_id);
