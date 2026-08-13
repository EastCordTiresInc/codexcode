-- Fix flotation tire parsing + re-backfill width / profile / wheel_size
-- Run in Supabase SQL Editor

-- Ensure required columns exist
alter table public.usedtireinventory
  add column if not exists width text,
  add column if not exists profile text,
  add column if not exists wheel_size text;

-- ---------------------------------------------------------------------------
-- 1. Rim helper (accepts int, numeric, or text)
-- ---------------------------------------------------------------------------

create or replace function public.normalize_rim_for_search(rim_size numeric)
returns text
language sql
immutable
as $$
  select case
    when rim_size is null then null
    when rim_size >= 10 then trunc(rim_size)::text
    else (trunc(rim_size) * 10)::text
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Parser for metric + flotation
-- ---------------------------------------------------------------------------

create or replace function public.parse_tire_size_columns(
  raw_tire_size text,
  rim_size numeric default null,
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
  flotation_flag boolean;
begin
  value := btrim(coalesce(raw_tire_size, ''));
  if value = '' then
    return;
  end if;

  flotation_flag := coalesce(is_flotation, false);
  clean_value := regexp_replace(value, '\.0+$', '');
  rim := public.normalize_rim_for_search(rim_size);

  -- Standard: 205/55R16
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

  -- Encoded flotation with decimal FIRST: 35812.502 + rim_size 2 -> 35 / 12.50 / 20
  if flotation_flag and clean_value ~ '^\d+\.\d+' then
    integer_part := split_part(clean_value, '.', 1);
    fraction_part := split_part(clean_value, '.', 2);

    if length(integer_part) >= 4 then
      width := substr(integer_part, 1, 2);
      profile := substr(integer_part, 4, 2) || '.' || lpad(substr(fraction_part, 1, 2), 2, '0');
      wheel_size := coalesce(
        rim,
        case when length(integer_part) >= 5 then substr(integer_part, 5, 2) else null end
      );
      size_label := width || 'x' || profile || 'R' || wheel_size;
      return next;
      return;
    end if;
  end if;

  digits := regexp_replace(clean_value, '\D', '', 'g');

  -- Compact metric: 2055516
  if length(digits) = 7 and not flotation_flag then
    width := substr(digits, 1, 3);
    profile := substr(digits, 4, 2);
    wheel_size := substr(digits, 6, 2);
    size_label := width || '/' || profile || 'R' || wheel_size;
    return next;
    return;
  end if;

  -- Compact flotation: 35125020 -> 35 / 12.50 / 20
  if flotation_flag and length(digits) = 8 then
    width := substr(digits, 1, 2);
    profile := substr(digits, 3, 2) || '.' || substr(digits, 5, 2);
    wheel_size := coalesce(rim, substr(digits, 7, 2));
    size_label := width || 'x' || profile || 'R' || wheel_size;
    return next;
    return;
  end if;

  -- Last fallback for flagged flotation rows
  if flotation_flag and length(digits) >= 4 then
    width := substr(digits, 1, 2);
    profile := substr(digits, 3, 2);
    wheel_size := coalesce(rim, substr(digits, greatest(length(digits) - 1, 1), 2));
    size_label := width || 'x' || profile || 'R' || wheel_size;
    return next;
  end if;

  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Re-backfill ALL rows (including flotation)
-- ---------------------------------------------------------------------------

with parsed_rows as (
  select
    src.id,
    parsed.width,
    parsed.profile,
    parsed.wheel_size
  from public.usedtireinventory as src
  cross join lateral public.parse_tire_size_columns(
    src.tire_size::text,
    src.rim_size::numeric,
    coalesce(src.is_flotation, false)
  ) as parsed
  where parsed.width is not null
)
update public.usedtireinventory as inv
set
  width = parsed_rows.width,
  profile = parsed_rows.profile,
  wheel_size = parsed_rows.wheel_size
from parsed_rows
where inv.id = parsed_rows.id;

-- ---------------------------------------------------------------------------
-- 4. Hard fix for encoded flotation rows still missing (35812.502 pattern)
-- ---------------------------------------------------------------------------

update public.usedtireinventory
set
  width = substr(split_part(tire_size::text, '.', 1), 1, 2),
  profile = substr(split_part(tire_size::text, '.', 1), 4, 2)
    || '.'
    || lpad(substr(split_part(tire_size::text, '.', 2), 1, 2), 2, '0'),
  wheel_size = coalesce(
    public.normalize_rim_for_search(rim_size::numeric),
    substr(split_part(tire_size::text, '.', 1), 5, 2)
  )
where coalesce(is_flotation, false) = true
  and tire_size::text ~ '^\d+\.\d+'
  and (width is null or profile is null or wheel_size is null);

-- ---------------------------------------------------------------------------
-- 5. Verify
-- ---------------------------------------------------------------------------

select id, tire_size, rim_size, is_flotation, width, profile, wheel_size
from public.usedtireinventory
where is_flotation = true;
