-- Split tire_size into width, profile, and wheel_size
-- Example: 1856515 -> width 185, profile 65, wheel_size 15
-- Example: 2055516 -> width 205, profile 55, wheel_size 16
--
-- Paste into Supabase SQL Editor and run.

-- 1. Add the three columns (safe to re-run)
alter table public.usedtireinventory
  add column if not exists width text,
  add column if not exists profile text,
  add column if not exists wheel_size text;

-- 2. Ensure tire_size is text so parsing is reliable
alter table public.usedtireinventory
  alter column tire_size type text
  using tire_size::text;

-- 3. Backfill from tire_size
--    Strips trailing ".0", keeps digits only, splits 3-2-2 when exactly 7 digits
update public.usedtireinventory
set
  width = substr(digits, 1, 3),
  profile = substr(digits, 4, 2),
  wheel_size = substr(digits, 6, 2)
from (
  select
    id,
    regexp_replace(
      regexp_replace(coalesce(tire_size, ''), '\.0+$', ''),
      '\D',
      '',
      'g'
    ) as digits
  from public.usedtireinventory
) as parsed
where public.usedtireinventory.id = parsed.id
  and length(parsed.digits) = 7;

-- 4. Optional: formatted label for display (205/55R16)
alter table public.usedtireinventory
  add column if not exists size_label text;

update public.usedtireinventory
set size_label = width || '/' || profile || 'R' || wheel_size
where width is not null
  and profile is not null
  and wheel_size is not null;

-- 5. Verify
-- select id, tire_size, width, profile, wheel_size, size_label
-- from public.usedtireinventory
-- order by id
-- limit 20;

-- Rows that did not parse (usually flotation sizes like 35812.502)
-- select id, tire_size, rim_size, brand
-- from public.usedtireinventory
-- where width is null;
