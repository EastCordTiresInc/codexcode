-- Track incoming new-tire orders and when pickup/install emails go out.
-- Run in the Supabase SQL Editor.

alter table public.new_tire_orders
  add column if not exists pickup_ready_at timestamptz,
  add column if not exists pickup_ready_emailed_at timestamptz,
  add column if not exists picked_up_at timestamptz;

create index if not exists new_tire_orders_fulfillment_status_idx
  on public.new_tire_orders (fulfillment_status);

create index if not exists new_tire_orders_fulfillment_preference_idx
  on public.new_tire_orders (fulfillment_preference);
