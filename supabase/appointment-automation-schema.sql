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
  service_area_status text not null default 'In service area',
  booking_status text not null default 'Pending Confirmation',
  payment_status text not null default 'pending_checkout',
  stripe_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
for each row execute function public.handle_new_user();

alter table public.appointment_bookings
  add column if not exists service_subtotal numeric(10,2),
  add column if not exists hst_amount numeric(10,2),
  add column if not exists total_with_hst numeric(10,2),
  add column if not exists tax_rate numeric(6,4),
  add column if not exists vehicle_plate_number text,
  add column if not exists vehicle_colour text,
  add column if not exists linked_tires jsonb,
  add column if not exists new_tire_order_id uuid,
  add column if not exists new_tire_purchased_at timestamptz,
  add column if not exists install_location text;
