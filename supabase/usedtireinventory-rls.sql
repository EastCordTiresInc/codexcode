-- EastCord Tires: allow public read access to used tire inventory
-- Run in Supabase SQL Editor for project EastCordTiresInv
--
-- Public read on all rows lets the site show a "sold out" message when stock hits 0.
-- The search UI only lists in-stock sizes in the dropdowns.

alter table public.usedtireinventory enable row level security;

drop policy if exists "Public can read in-stock used tires" on public.usedtireinventory;
drop policy if exists "Public can read used tires" on public.usedtireinventory;

create policy "Public can read used tires"
on public.usedtireinventory
for select
using (true);
