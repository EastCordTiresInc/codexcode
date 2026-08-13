-- Split tire_size into width, profile, and wheel_size
-- Supports BOTH:
--   Metric:  1856515  -> 185 / 65 / 15
--   Flotation text: 35x12.50R20 -> 35 / 12.50 / 20
--   Flotation encoded: 35812.502 + rim_size 2 -> 35 / 12.50 / 20
--
-- Paste into Supabase SQL Editor and run.

-- ---------------------------------------------------------------------------
-- 1. Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.normalize_rim_for_search(rim_size integer)
returns text
language sql
immutable
as $$
  select case
    when rim_size is null then null
    when rim_size >= 10 then rim_size::text
    else (rim_size * 10)::text
  end;
$$;

create or replace function public.parse_tire_size_columns(
  raw_tire_size text,
  rim_size integer default null,
  is_flotation boolean default false
)
returns table (
  width text,
  profile text,
  wheel_size text,
  size_label text
)
language plpgsql
immutable
as $$
declare
  value text;
  clean_value text;
  digits text;
  integer_part text;
  fraction_part text;
  std_match text[];
  flt_match text[];
  rim text;
begin
  value := btrim(coalesce(raw_tire_size, ''));
  if value = '' then
    return;
  end if;

  clean_value := regexp_replace(value, '\.0+$', '');

  -- Standard format: 205/55R16
  std_match := regexp_match(clean_value, '^(\d{3})\s*[/\-]\s*(\d{2})\s*[rR]?\s*(\d{2})$');
  if std_match is not null then
    width := std_match[1];
    profile := std_match[2];
    wheel_size := std_match[3];
    size_label := width || '/' || profile || 'R' || wheel_size;
    return next;
    return;
  end if;

  -- Flotation text: 35x12.50R20
  flt_match := regexp_match(
    clean_value,
    '^(\d{2})\s*[xX]\s*(\d{2}(?:\.\d+)?)\s*[rR]?\s*(\d{2})$'
  );
  if flt_match is not null then
    width := flt_match[1];
    profile := flt_match[2];
    wheel_size := flt_match[3];
    size_label := width || 'x' || profile || 'R' || wheel_size;
    return next;
    return;
  end if;

  digits := regexp_replace(clean_value, '\D', '', 'g');

  -- Compact metric: 2055516
  if length(digits) = 7 and not coalesce(is_flotation, false) then
    width := substr(digits, 1, 3);
    profile := substr(digits, 4, 2);
    wheel_size := substr(digits, 6, 2);
    size_label := width || '/' || profile || 'R' || wheel_size;
    return next;
    return;
  end if;

  rim := public.normalize_rim_for_search(rim_size);

  -- Encoded flotation with decimal, e.g. 35812.502 + rim_size 2 -> 35x12.50R20
  if coalesce(is_flotation, false) and clean_value ~ '^\d+\.\d+$' then
    integer_part := split_part(clean_value, '.', 1);
    fraction_part := split_part(clean_value, '.', 2);

    if length(integer_part) >= 4 and rim is not null then
      width := substr(integer_part, 1, 2);
      profile := substr(integer_part, 4, 2) || '.' || lpad(substr(fraction_part, 1, 2), 2, '0');
      wheel_size := rim;
      size_label := width || 'x' || profile || 'R' || wheel_size;
      return next;
      return;
    end if;
  end if;

  -- Compact flotation digits, e.g. 35125020 -> 35 / 12.50 / 20
  if coalesce(is_flotation, false) and length(digits) = 8 then
    width := substr(digits, 1, 2);
    profile := substr(substr(digits, 3, 4), 1, 2) || '.' || substr(substr(digits, 3, 4), 3, 2);
    wheel_size := substr(digits, 7, 2);
    size_label := width || 'x' || profile || 'R' || wheel_size;
    return next;
    return;
  end if;

  -- Fallback for flagged flotation rows
  if coalesce(is_flotation, false) and rim is not null and length(digits) >= 4 then
    width := substr(digits, 1, 2);
    profile := substr(digits, 3, 2);
    wheel_size := rim;
    size_label := width || 'x' || profile || 'R' || wheel_size;
    return next;
  end if;

  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Ensure columns exist
-- ---------------------------------------------------------------------------

alter table public.usedtireinventory
  add column if not exists width text,
  add column if not exists profile text,
  add column if not exists wheel_size text,
  add column if not exists size_label text,
  add column if not exists is_flotation boolean not null default false;

alter table public.usedtireinventory
  alter column tire_size type text
  using tire_size::text;

-- ---------------------------------------------------------------------------
-- 3. Backfill metric + flotation rows
-- ---------------------------------------------------------------------------

with parsed_rows as (
  select
    src.id,
    parsed.width,
    parsed.profile,
    parsed.wheel_size,
    parsed.size_label
  from public.usedtireinventory as src
  cross join lateral public.parse_tire_size_columns(
    src.tire_size,
    src.rim_size,
    coalesce(src.is_flotation, false)
  ) as parsed
  where parsed.width is not null
)
update public.usedtireinventory as inv
set
  width = parsed_rows.width,
  profile = parsed_rows.profile,
  wheel_size = parsed_rows.wheel_size,
  size_label = coalesce(parsed_rows.size_label, inv.tire_size)
from parsed_rows
where inv.id = parsed_rows.id;

-- ---------------------------------------------------------------------------
-- 4. Auto-fill on future inserts/updates
-- ---------------------------------------------------------------------------

create or replace function public.sync_tire_size_columns()
returns trigger
language plpgsql
as $$
declare
  parsed record;
begin
  select *
  into parsed
  from public.parse_tire_size_columns(
    new.tire_size,
    new.rim_size,
    coalesce(new.is_flotation, false)
  );

  if parsed.width is not null then
    new.width := parsed.width;
    new.profile := parsed.profile;
    new.wheel_size := parsed.wheel_size;
    new.size_label := parsed.size_label;
  end if;

  return new;
end;
$$;

drop trigger if exists usedtireinventory_tire_size_columns on public.usedtireinventory;
create trigger usedtireinventory_tire_size_columns
before insert or update of tire_size, rim_size, is_flotation
on public.usedtireinventory
for each row execute function public.sync_tire_size_columns();

-- ---------------------------------------------------------------------------
-- 5. Verify
-- ---------------------------------------------------------------------------

-- Metric example
-- select id, tire_size, is_flotation, width, profile, wheel_size, size_label
-- from public.usedtireinventory
-- where id = 2;

-- Flotation example
-- select id, tire_size, rim_size, is_flotation, width, profile, wheel_size, size_label
-- from public.usedtireinventory
-- where is_flotation = true;

-- Anything still missing
-- select id, tire_size, rim_size, is_flotation, brand
-- from public.usedtireinventory
-- where width is null or profile is null or wheel_size is null;
