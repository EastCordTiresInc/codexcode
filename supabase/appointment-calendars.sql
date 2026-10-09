-- Two calendars. A shop visit and a mobile service call can share an hour.
-- Each table allows only one appointment for a given date and time window.
-- Run this in the Supabase SQL editor. It is safe to run more than once.

create table if not exists public.shop_calendar_slots (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointment_bookings(id) on delete cascade,
  slot_date date not null,
  time_window text not null,
  created_at timestamptz not null default now(),
  unique (slot_date, time_window)
);

create table if not exists public.mobile_calendar_slots (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointment_bookings(id) on delete cascade,
  slot_date date not null,
  time_window text not null,
  created_at timestamptz not null default now(),
  unique (slot_date, time_window)
);

alter table public.shop_calendar_slots enable row level security;
alter table public.mobile_calendar_slots enable row level security;

revoke all on public.shop_calendar_slots from public, anon, authenticated;
revoke all on public.mobile_calendar_slots from public, anon, authenticated;

create index if not exists shop_calendar_slots_date_idx
  on public.shop_calendar_slots (slot_date, time_window);

create index if not exists mobile_calendar_slots_date_idx
  on public.mobile_calendar_slots (slot_date, time_window);

create or replace function public.sync_appointment_calendar_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  calendar text;
  holds boolean;
begin
  if tg_op = 'DELETE' then
    delete from public.shop_calendar_slots where appointment_id = old.id;
    delete from public.mobile_calendar_slots where appointment_id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE'
    and new.preferred_date is not distinct from old.preferred_date
    and new.preferred_time_window is not distinct from old.preferred_time_window
    and new.install_location is not distinct from old.install_location
    and new.city is not distinct from old.city
    and new.booking_status is not distinct from old.booking_status
  then
    return new;
  end if;

  calendar := case
    when lower(coalesce(new.install_location, '')) = 'shop' then 'shop'
    when lower(coalesce(new.install_location, '')) = 'mobile' then 'mobile'
    when lower(coalesce(new.city, '')) = 'eastcord shop' then 'shop'
    else 'mobile'
  end;

  holds := new.booking_status in ('Pending Confirmation', 'Confirmed', 'Completed')
    and new.preferred_date is not null
    and coalesce(new.preferred_time_window, '') <> ''
    and (
      new.booking_status in ('Confirmed', 'Completed')
      or new.payment_status = 'paid_deposit'
    );

  delete from public.shop_calendar_slots where appointment_id = new.id;
  delete from public.mobile_calendar_slots where appointment_id = new.id;

  if not holds then
    return new;
  end if;

  if calendar = 'shop' then
    insert into public.shop_calendar_slots (appointment_id, slot_date, time_window)
    values (new.id, new.preferred_date, new.preferred_time_window);
  else
    insert into public.mobile_calendar_slots (appointment_id, slot_date, time_window)
    values (new.id, new.preferred_date, new.preferred_time_window);
  end if;

  return new;
exception
  when unique_violation then
    raise exception 'That hour is already booked on the % calendar', calendar
      using errcode = '23505';
end;
$$;

revoke all on function public.sync_appointment_calendar_slot() from public, anon, authenticated;

drop trigger if exists appointment_calendar_slot_sync on public.appointment_bookings;
create trigger appointment_calendar_slot_sync
after insert or update or delete on public.appointment_bookings
for each row execute function public.sync_appointment_calendar_slot();

insert into public.shop_calendar_slots (appointment_id, slot_date, time_window)
select distinct on (preferred_date, preferred_time_window)
  id,
  preferred_date,
  preferred_time_window
from public.appointment_bookings
where preferred_date is not null
  and coalesce(preferred_time_window, '') <> ''
  and booking_status in ('Confirmed', 'Completed')
  and (
    lower(coalesce(install_location, '')) = 'shop'
    or (
      lower(coalesce(install_location, '')) not in ('shop', 'mobile')
      and lower(coalesce(city, '')) = 'eastcord shop'
    )
  )
  and not exists (
    select 1
    from public.shop_calendar_slots existing
    where existing.appointment_id = appointment_bookings.id
      or (
        existing.slot_date = appointment_bookings.preferred_date
        and existing.time_window = appointment_bookings.preferred_time_window
      )
  )
order by preferred_date, preferred_time_window, created_at;

insert into public.mobile_calendar_slots (appointment_id, slot_date, time_window)
select distinct on (preferred_date, preferred_time_window)
  id,
  preferred_date,
  preferred_time_window
from public.appointment_bookings
where preferred_date is not null
  and coalesce(preferred_time_window, '') <> ''
  and booking_status in ('Confirmed', 'Completed')
  and not (
    lower(coalesce(install_location, '')) = 'shop'
    or (
      lower(coalesce(install_location, '')) not in ('shop', 'mobile')
      and lower(coalesce(city, '')) = 'eastcord shop'
    )
  )
  and not exists (
    select 1
    from public.mobile_calendar_slots existing
    where existing.appointment_id = appointment_bookings.id
      or (
        existing.slot_date = appointment_bookings.preferred_date
        and existing.time_window = appointment_bookings.preferred_time_window
      )
  )
order by preferred_date, preferred_time_window, created_at;
