-- Staff role for the EastCord admin dashboard.
-- Only info@eastcordtires.ca should be marked admin for now.

alter table public.customer_profiles
  add column if not exists role text not null default 'customer'
  check (role in ('customer', 'admin'));

create index if not exists customer_profiles_role_idx
  on public.customer_profiles (role);

-- Promote the staff account if it already exists.
update public.customer_profiles
set role = 'admin',
    updated_at = now()
where lower(email) = 'info@eastcordtires.ca';
