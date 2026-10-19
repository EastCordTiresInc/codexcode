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
  start_text text;
  hour_part int;
  minute_part int;
  period text;
begin
  if new.new_tire_order_id is null or new.preferred_date is null then
    return new;
  end if;

  select (timezone('America/Toronto', coalesce(paid_at, created_at)))::date
    into purchased
  from public.new_tire_orders
  where id = new.new_tire_order_id;

  if purchased is not null and new.preferred_date < (purchased + 1) then
    raise exception
      'New tire installation starts at 1:00 PM the day after the purchase date (%).',
      purchased
      using errcode = 'P0001';
  end if;

  if purchased is not null
     and new.preferred_date = (purchased + 1)
     and coalesce(new.preferred_time_window, '') <> '' then
    start_text := btrim(split_part(new.preferred_time_window, '-', 1));
    if start_text ~* '^[0-9]{1,2}:[0-9]{2}\s+(AM|PM)$' then
      hour_part := split_part(start_text, ':', 1)::int;
      minute_part := split_part(split_part(start_text, ':', 2), ' ', 1)::int;
      period := upper((regexp_match(start_text, '(AM|PM)$', 'i'))[1]);
      if period = 'AM' and hour_part = 12 then
        hour_part := 0;
      elsif period = 'PM' and hour_part <> 12 then
        hour_part := hour_part + 12;
      end if;
      if (hour_part * 60 + minute_part) < (13 * 60) then
        raise exception
          'New tire installation on the day after purchase starts at 1:00 PM. Purchase date: %.',
          purchased
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointment_new_tire_install_hold on public.appointment_bookings;
create trigger appointment_new_tire_install_hold
before insert or update of preferred_date, preferred_time_window, new_tire_order_id
on public.appointment_bookings
for each row execute procedure public.assert_new_tire_install_hold();
