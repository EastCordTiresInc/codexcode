-- Tire technician / installer applications from the public form.
-- Run in the Supabase SQL Editor.

create table if not exists public.installer_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  alternate_phone text not null default '',
  years_experience text not null default '',
  licensed_technician text not null default '',
  gst_hst_number text not null default '',
  city text not null default '',
  province text not null default 'Ontario',
  postal_code text not null default '',
  services text[] not null default '{}',
  vehicles text[] not null default '{}',
  equipment text[] not null default '{}',
  jobs_per_week text not null default '',
  service_area text not null default '',
  travel_radius text not null default '',
  weekday_hours text not null default '',
  saturday_hours text not null default '',
  sunday_hours text not null default '',
  after_hours text not null default '',
  liability_insurance text not null default '',
  liability_coverage text not null default '',
  wsib_coverage text not null default '',
  referral_source text not null default '',
  notes text not null default '',
  work_types text not null default 'Service calls',
  status text not null default 'new' check (status in ('new', 'reviewed', 'approved', 'declined')),
  staff_note text not null default '',
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists installer_applications_status_created_idx
  on public.installer_applications (status, created_at desc);

alter table public.installer_applications enable row level security;
