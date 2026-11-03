-- Phone appointments are created only from the admin desk.
-- A row here means a verified staff login booked it.
-- Safe to re-run in the Supabase SQL editor.

create table if not exists public.phone_appointments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.appointment_bookings(id) on delete cascade,
  booked_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists phone_appointments_created_at_idx
  on public.phone_appointments (created_at desc);

alter table public.phone_appointments enable row level security;
