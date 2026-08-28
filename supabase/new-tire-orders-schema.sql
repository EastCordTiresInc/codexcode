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

alter table public.appointment_bookings
  add column if not exists new_tire_order_id uuid references public.new_tire_orders(id),
  add column if not exists linked_tires jsonb,
  add column if not exists new_tire_purchased_at timestamptz,
  add column if not exists install_location text;

create index if not exists appointment_bookings_new_tire_order_id_idx
  on public.appointment_bookings (new_tire_order_id);

create or replace function public.assert_new_tire_install_hold()
returns trigger
language plpgsql
as $$
declare
  purchased date;
begin
  if new.new_tire_order_id is null or new.preferred_date is null then
    return new;
  end if;

  select (timezone('America/Toronto', coalesce(paid_at, created_at)))::date
    into purchased
  from public.new_tire_orders
  where id = new.new_tire_order_id;

  if purchased is not null and new.preferred_date <= (purchased + 4) then
    raise exception
      'New tire installation cannot be booked until 4 days after the tire purchase date (%).',
      purchased
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists appointment_new_tire_install_hold on public.appointment_bookings;
create trigger appointment_new_tire_install_hold
before insert or update of preferred_date, new_tire_order_id
on public.appointment_bookings
for each row execute procedure public.assert_new_tire_install_hold();
