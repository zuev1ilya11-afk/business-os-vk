create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.business_staff(id) on delete cascade,
  code_hash text not null unique,
  created_by_staff_id uuid not null references public.business_staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_vk_id text,
  revoked_at timestamptz,
  constraint staff_invites_code_hash_format check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint staff_invites_expiry_after_creation check (expires_at > created_at)
);

create index if not exists staff_invites_staff_active_idx
  on public.staff_invites(staff_id, expires_at desc)
  where consumed_at is null and revoked_at is null;

alter table public.staff_invites enable row level security;
revoke all on table public.staff_invites from anon, authenticated;
grant all on table public.staff_invites to service_role;

create or replace function public.guard_business_staff_vk_link()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.external_id is distinct from new.external_id
     and coalesce(old.external_id, '') !~ '^[1-9][0-9]*$'
     and coalesce(new.external_id, '') ~ '^[1-9][0-9]*$'
     and coalesce(current_setting('app.staff_invite_redeem', true), '') <> '1' then
    raise exception 'VK_LINK_REQUIRES_INVITE' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists business_staff_vk_link_guard on public.business_staff;
create trigger business_staff_vk_link_guard
before update of external_id on public.business_staff
for each row execute function public.guard_business_staff_vk_link();

revoke all on function public.guard_business_staff_vk_link() from public, anon, authenticated;
grant execute on function public.guard_business_staff_vk_link() to service_role;

create or replace function public.redeem_staff_invite(p_code_hash text, p_vk_external_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.staff_invites%rowtype;
  v_staff public.business_staff%rowtype;
  v_existing uuid;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INVITE_CODE' using errcode = '22023';
  end if;
  if p_vk_external_id is null or p_vk_external_id !~ '^[1-9][0-9]*$' then
    raise exception 'INVALID_VK_ID' using errcode = '22023';
  end if;

  select * into v_invite
  from public.staff_invites
  where code_hash = p_code_hash
    and consumed_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'INVITE_INVALID_OR_EXPIRED' using errcode = 'P0001';
  end if;

  select * into v_staff
  from public.business_staff
  where id = v_invite.staff_id
  for update;

  if not found or not coalesce(v_staff.is_active, false) then
    raise exception 'STAFF_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if v_staff.role = 'owner' then
    raise exception 'OWNER_INVITE_NOT_ALLOWED' using errcode = '42501';
  end if;
  if coalesce(v_staff.external_id, '') ~ '^[1-9][0-9]*$' then
    raise exception 'STAFF_ALREADY_LINKED' using errcode = '23505';
  end if;

  select id into v_existing
  from public.business_staff
  where external_id = p_vk_external_id
    and id <> v_staff.id
  limit 1;
  if found then
    raise exception 'VK_ALREADY_LINKED' using errcode = '23505';
  end if;

  perform set_config('app.staff_invite_redeem', '1', true);
  update public.business_staff
  set external_id = p_vk_external_id,
      updated_at = now()
  where id = v_staff.id
  returning * into v_staff;

  update public.staff_invites
  set consumed_at = now(), consumed_vk_id = p_vk_external_id
  where id = v_invite.id;

  update public.staff_invites
  set revoked_at = now()
  where staff_id = v_staff.id
    and id <> v_invite.id
    and consumed_at is null
    and revoked_at is null;

  return to_jsonb(v_staff) - 'password_hash' - 'password';
end;
$$;

revoke all on function public.redeem_staff_invite(text, text) from public, anon, authenticated;
grant execute on function public.redeem_staff_invite(text, text) to service_role;
