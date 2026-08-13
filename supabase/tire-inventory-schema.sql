-- EastCord Tires: live inventory table (synced from Google Sheets)
-- Run in Supabase SQL Editor after appointment-automation-schema.sql

create table if not exists public.tire_inventory (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  brand text not null,
  model text default '',
  size text not null,
  tire_type text default 'Used',
  season text default '',
  load_rating text default '',
  price numeric(10,2),
  stock integer not null default 0,
  condition text default '',
  details text default '',
  status text not null default 'published',
  sheet_row integer,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tire_inventory_status_check
    check (status in ('published', 'hidden', 'sold'))
);

create index if not exists tire_inventory_status_stock_idx
  on public.tire_inventory (status, stock);

create index if not exists tire_inventory_size_idx
  on public.tire_inventory (size);

create index if not exists tire_inventory_brand_idx
  on public.tire_inventory (brand);

alter table public.tire_inventory enable row level security;

drop policy if exists "Public can read published inventory" on public.tire_inventory;
create policy "Public can read published inventory"
on public.tire_inventory for select
using (status = 'published' and stock > 0);

-- Writes happen only via sync job using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)

create or replace function public.touch_tire_inventory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tire_inventory_updated_at on public.tire_inventory;
create trigger tire_inventory_updated_at
before update on public.tire_inventory
for each row execute function public.touch_tire_inventory_updated_at();
