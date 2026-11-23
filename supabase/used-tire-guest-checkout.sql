-- Let a used-tire purchase save the customer and tires without an account.
-- Run once in the Supabase SQL editor. Do not drop the tables.

alter table public.used_tire_orders
  alter column customer_id drop not null;

alter table public.used_tire_orders
  add column if not exists preferred_contact text;

alter table public.appointment_bookings
  alter column customer_id drop not null;
