alter table public.business_staff
  add column if not exists last_seen_at timestamptz;
