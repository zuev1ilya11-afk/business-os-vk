create table if not exists public.bos_login_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_seen_at timestamptz not null default now(),
  constraint bos_login_rate_limits_key_hash_format check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint bos_login_rate_limits_attempts_nonnegative check (attempts >= 0)
);

alter table public.bos_login_rate_limits enable row level security;
revoke all on table public.bos_login_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.bos_login_rate_limits to service_role;

create or replace function public.bos_consume_login_attempt(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.bos_login_rate_limits%rowtype;
  v_now timestamptz := now();
  v_retry integer := 0;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_RATE_LIMIT_KEY' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'INVALID_RATE_LIMIT_LIMIT' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 10 or p_window_seconds > 86400 then
    raise exception 'INVALID_RATE_LIMIT_WINDOW' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));

  select * into v_row
  from public.bos_login_rate_limits
  where key_hash = p_key_hash
  for update;

  if not found then
    insert into public.bos_login_rate_limits(key_hash, window_started_at, attempts, last_seen_at)
    values (p_key_hash, v_now, 1, v_now);
    return jsonb_build_object('allowed', true, 'retry_after', 0);
  end if;

  if v_row.window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    update public.bos_login_rate_limits
       set window_started_at = v_now, attempts = 1, last_seen_at = v_now
     where key_hash = p_key_hash;
    return jsonb_build_object('allowed', true, 'retry_after', 0);
  end if;

  if v_row.attempts >= p_limit then
    v_retry := greatest(1, ceil(extract(epoch from (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer);
    update public.bos_login_rate_limits set last_seen_at = v_now where key_hash = p_key_hash;
    return jsonb_build_object('allowed', false, 'retry_after', v_retry);
  end if;

  update public.bos_login_rate_limits
     set attempts = attempts + 1, last_seen_at = v_now
   where key_hash = p_key_hash;
  return jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;

revoke all on function public.bos_consume_login_attempt(text, integer, integer) from public, anon, authenticated;
grant execute on function public.bos_consume_login_attempt(text, integer, integer) to service_role;

create or replace function public.bos_set_staff_credentials(p_staff_id uuid, p_login text, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(trim(coalesce(p_login,''))) < 3 then raise exception 'Логин должен быть не короче 3 символов'; end if;
  if length(trim(coalesce(p_login,''))) > 64 then raise exception 'Логин слишком длинный'; end if;
  if length(coalesce(p_password,'')) < 10 then raise exception 'Пароль должен быть не короче 10 символов'; end if;
  if length(coalesce(p_password,'')) > 128 then raise exception 'Пароль слишком длинный'; end if;
  update public.business_staff
     set login=trim(p_login), password_hash=extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at=now()
   where id=p_staff_id and is_active=true;
  if not found then raise exception 'Сотрудник не найден'; end if;
end;
$$;

revoke all on function public.bos_set_staff_credentials(uuid,text,text) from public, anon, authenticated;
grant execute on function public.bos_set_staff_credentials(uuid,text,text) to service_role;