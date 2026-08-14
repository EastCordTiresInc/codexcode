-- EastCord Tires: search-optimized used tire inventory table
-- Project: EastCordTiresInv
-- Paste into Supabase SQL Editor and run as one script.
--
-- Matches the used-tires search engine:
--   Width, Profile, Wheel Size, Season, Brand
--
-- Safe to run on a fresh project or an existing usedtireinventory table.

-- ---------------------------------------------------------------------------
-- 1. Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.normalize_tire_season(raw_type text)
returns text
language sql
immutable
as $$
  select case
    when raw_type is null or btrim(raw_type) = '' then ''
    when lower(raw_type) like '%winter%' then 'winter'
    when lower(raw_type) like '%summer%' then 'summer'
    when lower(raw_type) like '%terrain%' then 'all-season'
    when lower(raw_type) like '%all%' then 'all-season'
    else lower(btrim(raw_type))
  end;
$$;

drop function if exists public.normalize_rim_for_search(integer);
drop function if exists public.normalize_rim_for_search(bigint);

create or replace function public.normalize_rim_for_search(rim_size bigint)
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

drop function if exists public.parse_tire_size_for_search(text, integer, boolean);
drop function if exists public.parse_tire_size_for_search(text, bigint, boolean);

create or replace function public.parse_tire_size_for_search(
  raw_tire_size text,
  rim_size bigint default null,
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
  digits text;
  std_match text[];
  flt_match text[];
  rim text;
begin
  value := btrim(coalesce(raw_tire_size, ''));
  if value = '' then
    return;
  end if;

  -- Already formatted like 205/55R16
  std_match := regexp_match(value, '^(\d{3})\s*[/\-]\s*(\d{2})\s*[rR]?\s*(\d{2})$');
  if std_match is not null then
    width := std_match[1];
    profile := std_match[2];
    wheel_size := std_match[3];
    size_label := width || '/' || profile || 'R' || wheel_size;
    return next;
    return;
  end if;

  -- Flotation text like 35x12.50R20
  flt_match := regexp_match(value, '^(\d{2})\s*[xX]\s*(\d{2}(?:\.\d+)?)\s*[rR]?\s*(\d{2})$');
  if flt_match is not null then
    width := flt_match[1];
    profile := flt_match[2];
    wheel_size := flt_match[3];
    size_label := width || 'x' || profile || 'R' || wheel_size;
    return next;
    return;
  end if;

  digits := regexp_replace(value, '\D', '', 'g');

  -- Compact metric code like 2055516 -> 205/55R16
  if length(digits) = 7 then
    width := substr(digits, 1, 3);
    profile := substr(digits, 4, 2);
    wheel_size := substr(digits, 6, 2);
    size_label := width || '/' || profile || 'R' || wheel_size;
    return next;
    return;
  end if;

  rim := public.normalize_rim_for_search(rim_size);

  -- Best-effort flotation / odd encoded values
  if is_flotation and rim is not null and length(digits) >= 5 then
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
-- 2. Create table (fresh install)
-- ---------------------------------------------------------------------------

create table if not exists public.usedtireinventory (
  id bigint primary key,
  tire_size text not null,
  rim_size integer,
  type text,
  brand text not null,
  opening_qty integer not null default 0,
  add_qty integer not null default 0,
  remove_qty integer not null default 0,
  current_stock integer not null default 0,
  selling_price numeric(10, 2),
  drive_link text,
  is_flotation boolean not null default false,

  -- Search-engine columns (used by dropdowns + filters)
  width text,
  profile text,
  wheel_size text,
  size_label text,
  season text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Upgrade an existing table (adds search columns if missing)
-- ---------------------------------------------------------------------------

alter table public.usedtireinventory
  add column if not exists width text,
  add column if not exists profile text,
  add column if not exists wheel_size text,
  add column if not exists size_label text,
  add column if not exists season text,
  add column if not exists is_flotation boolean not null default false,
  add column if not exists drive_link text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Ensure tire_size is text for reliable parsing
alter table public.usedtireinventory
  alter column tire_size type text
  using tire_size::text;

-- ---------------------------------------------------------------------------
-- 4. Backfill search columns from existing tire_size / type values
-- ---------------------------------------------------------------------------

with parsed_rows as (
  select
    src.id,
    parsed.width,
    parsed.profile,
    parsed.wheel_size,
    parsed.size_label
  from public.usedtireinventory as src
  cross join lateral public.parse_tire_size_for_search(
    regexp_replace(src.tire_size, '\.0+$', ''),
    src.rim_size::bigint,
    coalesce(src.is_flotation, false)
  ) as parsed
  where parsed.width is not null
)
update public.usedtireinventory as inv
set
  width = parsed_rows.width,
  profile = parsed_rows.profile,
  wheel_size = parsed_rows.wheel_size,
  size_label = coalesce(parsed_rows.size_label, inv.tire_size),
  season = public.normalize_tire_season(inv.type)
from parsed_rows
where inv.id = parsed_rows.id;

-- Keep season populated even when size parsing fails
update public.usedtireinventory
set season = public.normalize_tire_season(type)
where season is null or season = '';

-- ---------------------------------------------------------------------------
-- 5. Auto-maintain search columns on insert/update
-- ---------------------------------------------------------------------------

create or replace function public.sync_usedtireinventory_search_fields()
returns trigger
language plpgsql
as $$
declare
  parsed record;
  clean_size text;
begin
  clean_size := regexp_replace(coalesce(new.tire_size, ''), '\.0+$', '');
  new.season := public.normalize_tire_season(new.type);

  select *
  into parsed
  from public.parse_tire_size_for_search(
    clean_size,
    new.rim_size::bigint,
    coalesce(new.is_flotation, false)
  );

  if parsed.width is not null then
    new.width := parsed.width;
    new.profile := parsed.profile;
    new.wheel_size := parsed.wheel_size;
    new.size_label := parsed.size_label;
  else
    new.size_label := coalesce(new.size_label, clean_size);
  end if;

  return new;
end;
$$;

drop trigger if exists usedtireinventory_search_fields on public.usedtireinventory;
create trigger usedtireinventory_search_fields
before insert or update on public.usedtireinventory
for each row execute function public.sync_usedtireinventory_search_fields();

-- ---------------------------------------------------------------------------
-- 6. Indexes for the search engine
-- ---------------------------------------------------------------------------

create index if not exists usedtireinventory_width_idx
  on public.usedtireinventory (width);

create index if not exists usedtireinventory_profile_idx
  on public.usedtireinventory (profile);

create index if not exists usedtireinventory_wheel_size_idx
  on public.usedtireinventory (wheel_size);

create index if not exists usedtireinventory_season_idx
  on public.usedtireinventory (season);

create index if not exists usedtireinventory_brand_idx
  on public.usedtireinventory (brand);

create index if not exists usedtireinventory_stock_idx
  on public.usedtireinventory (current_stock);

create index if not exists usedtireinventory_search_combo_idx
  on public.usedtireinventory (width, profile, wheel_size, season, brand)
  where current_stock > 0;

-- ---------------------------------------------------------------------------
-- 7. Row Level Security (website reads in-stock rows only)
-- ---------------------------------------------------------------------------

alter table public.usedtireinventory enable row level security;

drop policy if exists "Public can read in-stock used tires" on public.usedtireinventory;
create policy "Public can read in-stock used tires"
on public.usedtireinventory
for select
using (current_stock > 0);

-- ---------------------------------------------------------------------------
-- 8. Optional helper view for debugging the search engine
-- ---------------------------------------------------------------------------

create or replace view public.usedtireinventory_search_view as
select
  id,
  brand,
  width,
  profile,
  wheel_size,
  size_label,
  season,
  type as raw_type,
  current_stock,
  selling_price,
  drive_link,
  is_flotation
from public.usedtireinventory
where current_stock > 0
order by brand, width, profile, wheel_size;

-- ---------------------------------------------------------------------------
-- 9. Quick verification queries
-- ---------------------------------------------------------------------------

-- Row count
-- select count(*) from public.usedtireinventory;

-- Dropdown values the site will use
-- select distinct width from public.usedtireinventory where current_stock > 0 order by width;
-- select distinct profile from public.usedtireinventory where current_stock > 0 order by profile;
-- select distinct wheel_size from public.usedtireinventory where current_stock > 0 order by wheel_size;
-- select distinct season from public.usedtireinventory where current_stock > 0 order by season;

-- Rows that could not be parsed for search
-- select id, tire_size, rim_size, type, brand, is_flotation
-- from public.usedtireinventory
-- where current_stock > 0 and (width is null or profile is null or wheel_size is null);
