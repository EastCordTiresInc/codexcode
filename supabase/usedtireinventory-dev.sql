-- Development copy of the used-tire inventory.
-- The live site keeps reading public.usedtireinventory.
-- Local development reads this table when INVENTORY_TABLE=usedtireinventory_dev.

create table if not exists public.usedtireinventory_dev (
  id text primary key,
  sheet_tab text not null,
  sheet_row integer not null,
  tire_size text not null,
  rim_size integer,
  brand text not null,
  model text not null default '',
  type text not null default '',
  season text not null default '',
  dot text not null default '',
  current_stock integer not null default 0,
  selling_price numeric(10, 2),
  price_is_final boolean not null default true,
  note text not null default '',
  category text not null default '',
  drive_link text not null default '',
  width text,
  profile text,
  wheel_size text,
  size_label text,
  is_flotation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.usedtireinventory_dev enable row level security;

drop policy if exists "Public can read dev used tires" on public.usedtireinventory_dev;
create policy "Public can read dev used tires"
on public.usedtireinventory_dev
for select
to anon, authenticated
using (true);

grant select on public.usedtireinventory_dev to anon, authenticated;
