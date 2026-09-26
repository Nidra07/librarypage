alter table public.bookings
  add column entry_time time,
  add column exit_time time,
  add column exit_day_offset smallint;

create or replace function public.calculate_booking_exit_time()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_registered_entry time;
  v_duration integer;
  v_total_minutes integer;
begin
  select r.entry_time into v_registered_entry
  from public.student_registrations r
  where r.student_id = new.student_id;

  if new.entry_time is null then
    new.entry_time := coalesce(v_registered_entry, time '08:00');
  end if;

  select s.duration_hours into v_duration
  from public.study_slots s
  where s.id = new.slot_id;

  if v_duration is null then
    raise exception 'The selected booking duration is unavailable.';
  end if;

  v_total_minutes :=
    extract(hour from new.entry_time)::integer * 60
    + extract(minute from new.entry_time)::integer
    + v_duration * 60;

  new.exit_time := (
    time '00:00' + ((v_total_minutes % 1440) * interval '1 minute')
  )::time;
  new.exit_day_offset := (v_total_minutes / 1440)::smallint;
  return new;
end;
$$;

revoke execute on function public.calculate_booking_exit_time() from public, anon, authenticated;
drop trigger if exists calculate_booking_exit_time on public.bookings;
create trigger calculate_booking_exit_time
  before insert or update of student_id, slot_id, entry_time on public.bookings
  for each row execute procedure public.calculate_booking_exit_time();

update public.bookings set slot_id = slot_id;

alter table public.bookings alter column entry_time set not null;
alter table public.bookings alter column exit_time set not null;
alter table public.bookings alter column exit_day_offset set default 0;
alter table public.bookings alter column exit_day_offset set not null;
alter table public.bookings
  add constraint bookings_exit_day_offset_valid check (exit_day_offset in (0, 1));
