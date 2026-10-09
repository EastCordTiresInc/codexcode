-- One-hour appointment reminders.
-- Safe to re-run in the Supabase SQL editor.

alter table public.appointment_bookings
  add column if not exists reminder_sent_at timestamptz;
