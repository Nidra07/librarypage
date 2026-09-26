insert into public.study_slots (label, duration_hours, active)
select duration.hours || '-hour slot', duration.hours, true
from (values (4), (6), (8), (12)) as duration(hours)
where not exists (
  select 1 from public.study_slots existing
  where existing.duration_hours = duration.hours
);