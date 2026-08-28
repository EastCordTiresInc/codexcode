-- EastCord Tires: run this entire script in Supabase → SQL Editor.
-- Safe to re-run. Creates/updates every table the site writes to:
--   customer_profiles, customer_carts, new_tire_orders,
--   appointment_bookings, used_tire_orders
-- New-tire installation cannot be booked until 4 days after paid_at
-- (Toronto calendar date) on the linked new_tire_orders row.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Customer profiles (created on signup)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;

drop policy if exists "Customers can read own profile" on public.customer_profiles;
create policy "Customers can read own profile"
on public.customer_profiles for select
using (auth.uid() = id);

drop policy if exists "Customers can insert own profile" on public.customer_profiles;
create policy "Customers can insert own profile"
on public.customer_profiles for insert
with check (auth.uid() = id);

drop policy if exists "Customers can update own profile" on public.customer_profiles;
create policy "Customers can update own profile"
on public.customer_profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.customer_profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone',
    coalesce(new.email, '')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Saved carts (appointment cart + used-tire cart)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  cart_type text not null check (cart_type in ('appointment', 'used_tire')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, cart_type)
);

alter table public.customer_carts enable row level security;

drop policy if exists "Customers can read own carts" on public.customer_carts;
create policy "Customers can read own carts"
on public.customer_carts for select
using (auth.uid() = customer_id);

drop policy if exists "Customers can insert own carts" on public.customer_carts;
create policy "Customers can insert own carts"
on public.customer_carts for insert
with check (auth.uid() = customer_id);

drop policy if exists "Customers can update own carts" on public.customer_carts;
create policy "Customers can update own carts"
on public.customer_carts for update
using (auth.uid() = customer_id)
with check (auth.uid() = customer_id);

drop policy if exists "Customers can delete own carts" on public.customer_carts;
create policy "Customers can delete own carts"
on public.customer_carts for delete
using (auth.uid() = customer_id);

-- ---------------------------------------------------------------------------
-- New tire orders (saved after a successful TireConnect widget ORDER)
-- paid_at is the purchase date used for the 4-day installation hold.
-- ---------------------------------------------------------------------------
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

alter table public.new_tire_orders
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text,
  add column if not exists fulfillment_preference text,
  add column if not exists items jsonb,
  add column if not exists vehicle jsonb,
  add column if not exists notes text,
  add column if not exists subtotal numeric(10,2),
  add column if not exists hst_amount numeric(10,2),
  add column if not exists total_with_hst numeric(10,2),
  add column if not exists tax_rate numeric(6,4),
  add column if not exists payment_status text,
  add column if not exists fulfillment_status text,
  add column if not exists stripe_session_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.new_tire_orders enable row level security;

drop policy if exists "Customers can read own new tire orders" on public.new_tire_orders;
create policy "Customers can read own new tire orders"
on public.new_tire_orders for select
using (auth.uid() = customer_id);

create index if not exists new_tire_orders_customer_id_idx
  on public.new_tire_orders (customer_id);

create index if not exists new_tire_orders_stripe_session_id_idx
  on public.new_tire_orders (stripe_session_id);

create index if not exists new_tire_orders_paid_at_idx
  on public.new_tire_orders (paid_at);

-- ---------------------------------------------------------------------------
-- Appointment bookings (date lives in preferred_date, time in preferred_time_window)
-- Linked new tires: new_tire_order_id + linked_tires jsonb
-- ---------------------------------------------------------------------------
create table if not exists public.appointment_bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  customer_name text,
  customer_email text,
  customer_phone text,
  service_id text not null,
  service_name text not null,
  starting_price numeric(10,2) not null,
  service_subtotal numeric(10,2),
  hst_amount numeric(10,2),
  total_with_hst numeric(10,2),
  tax_rate numeric(6,4),
  deposit_amount numeric(10,2) not null,
  remaining_balance numeric(10,2) not null,
  preferred_date date not null,
  preferred_time_window text not null,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vehicle_plate_number text,
  vehicle_colour text,
  tire_size text,
  tires_already_on_rims text,
  number_of_tires integer,
  full_service_address text,
  city text not null,
  postal_code text,
  parking_access_notes text,
  additional_notes text,
  linked_tires jsonb not null default '[]'::jsonb,
  new_tire_order_id uuid references public.new_tire_orders(id),
  new_tire_purchased_at timestamptz,
  install_location text,
  service_area_status text not null default 'In service area',
  booking_status text not null default 'Pending Confirmation',
  payment_status text not null default 'pending_checkout',
  stripe_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointment_bookings
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text,
  add column if not exists service_id text,
  add column if not exists service_name text,
  add column if not exists starting_price numeric(10,2),
  add column if not exists service_subtotal numeric(10,2),
  add column if not exists hst_amount numeric(10,2),
  add column if not exists total_with_hst numeric(10,2),
  add column if not exists tax_rate numeric(6,4),
  add column if not exists deposit_amount numeric(10,2),
  add column if not exists remaining_balance numeric(10,2),
  add column if not exists preferred_date date,
  add column if not exists preferred_time_window text,
  add column if not exists vehicle_year text,
  add column if not exists vehicle_make text,
  add column if not exists vehicle_model text,
  add column if not exists vehicle_plate_number text,
  add column if not exists vehicle_colour text,
  add column if not exists tire_size text,
  add column if not exists tires_already_on_rims text,
  add column if not exists number_of_tires integer,
  add column if not exists full_service_address text,
  add column if not exists city text,
  add column if not exists postal_code text,
  add column if not exists parking_access_notes text,
  add column if not exists additional_notes text,
  add column if not exists linked_tires jsonb,
  add column if not exists new_tire_order_id uuid,
  add column if not exists new_tire_purchased_at timestamptz,
  add column if not exists install_location text,
  add column if not exists service_area_status text,
  add column if not exists booking_status text,
  add column if not exists payment_status text,
  add column if not exists stripe_session_id text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointment_bookings_new_tire_order_id_fkey'
  ) then
    alter table public.appointment_bookings
      add constraint appointment_bookings_new_tire_order_id_fkey
      foreign key (new_tire_order_id) references public.new_tire_orders(id);
  end if;
end $$;

alter table public.appointment_bookings enable row level security;

drop policy if exists "Customers can read own bookings" on public.appointment_bookings;
create policy "Customers can read own bookings"
on public.appointment_bookings for select
using (auth.uid() = customer_id);

drop policy if exists "Customers can insert own bookings" on public.appointment_bookings;
create policy "Customers can insert own bookings"
on public.appointment_bookings for insert
with check (auth.uid() = customer_id);

drop policy if exists "Customers can update own pending checkout bookings" on public.appointment_bookings;
create policy "Customers can update own pending checkout bookings"
on public.appointment_bookings for update
using (auth.uid() = customer_id and payment_status in ('not_started', 'pending_checkout'))
with check (auth.uid() = customer_id);

create index if not exists appointment_bookings_customer_id_idx
  on public.appointment_bookings (customer_id);

create index if not exists appointment_bookings_preferred_date_idx
  on public.appointment_bookings (preferred_date, preferred_time_window);

create index if not exists appointment_bookings_new_tire_order_id_idx
  on public.appointment_bookings (new_tire_order_id);

create index if not exists appointment_bookings_payment_status_idx
  on public.appointment_bookings (payment_status, booking_status);

-- Block the purchase date and the next 4 days. First bookable day is purchase + 5.
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

-- ---------------------------------------------------------------------------
-- Used tire orders (Stripe used-tire checkout)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Confirm the tables exist
-- ---------------------------------------------------------------------------
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'customer_profiles',
    'customer_carts',
    'new_tire_orders',
    'appointment_bookings',
    'used_tire_orders'
  )
order by table_name;
