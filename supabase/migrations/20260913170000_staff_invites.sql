create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.business_staff(id) on delete cascade,
  issued_by_staff_id uuid not null references public.business_staff(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_vk_id text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staff_invites_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint staff_invites_vk_id_format check (consumed_by_vk_id is null or consumed_by_vk_id ~ '^[1-9][0-9]*$')
);

create index if not exists staff_invites_staff_active_idx
  on public.staff_invites(staff_id, expires_at desc)
  where consumed_at is null and revoked_at is null;

alter table public.staff_invites enable row level security;
revoke all on table public.staff_invites from anon, authenticated;
grant all on table public.staff_invites to service_role;

create or replace function public.accept_staff_invite(p_token_hash text, p_vk_user_id text)
returns public.business_staff
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.staff_invites%rowtype;
  v_staff public.business_staff%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INVITE';
  end if;
  if p_vk_user_id is null or p_vk_user_id !~ '^[1-9][0-9]*$' then
    raise exception 'INVALID_VK_USER';
  end if;

  select * into v_invite
  from public.staff_invites
  where token_hash = p_token_hash
  for update;

  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  if v_invite.revoked_at is not null then raise exception 'INVITE_REVOKED'; end if;
  if v_invite.consumed_at is not null then raise exception 'INVITE_USED'; end if;
  if v_invite.expires_at <= now() then raise exception 'INVITE_EXPIRED'; end if;

  if exists (
    select 1 from public.business_staff
    where external_id = p_vk_user_id and id <> v_invite.staff_id
  ) then
    raise exception 'VK_ALREADY_LINKED';
  end if;

  select * into v_staff
  from public.business_staff
  where id = v_invite.staff_id
  for update;

  if not found or not v_staff.is_active then raise exception 'STAFF_INACTIVE'; end if;
  if v_staff.role = 'owner' then raise exception 'OWNER_INVITE_FORBIDDEN'; end if;
  if v_staff.external_id ~ '^[1-9][0-9]*$' and v_staff.external_id <> p_vk_user_id then
    raise exception 'STAFF_ALREADY_LINKED';
  end if;

  update public.business_staff
  set external_id = p_vk_user_id, updated_at = now()
  where id = v_invite.staff_id
  returning * into v_staff;

  update public.staff_invites
  set consumed_at = now(), consumed_by_vk_id = p_vk_user_id
  where id = v_invite.id;

  update public.staff_invites
  set revoked_at = now()
  where staff_id = v_invite.staff_id
    and id <> v_invite.id
    and consumed_at is null
    and revoked_at is null;

  return v_staff;
end;
$$;

revoke all on function public.accept_staff_invite(text,text) from public, anon, authenticated;
grant execute on function public.accept_staff_invite(text,text) to service_role;
