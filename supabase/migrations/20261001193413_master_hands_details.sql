-- No row backfill, role/policy changes or financial recalculation. Existing
-- staff-only order UPDATE RLS and signed-session API authorization still apply.
alter table public.orders
  add column if not exists apartment text,
  add column if not exists hands_detail_overrides jsonb not null default '{}'::jsonb,
  add column if not exists hands_comment_source jsonb;

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_hands_details_shape') then
    alter table public.orders add constraint orders_hands_details_shape check (
      (apartment is null or char_length(apartment)<=120)
      and jsonb_typeof(hands_detail_overrides)='object'
      and hands_detail_overrides - 'apartment' - 'comment' = '{}'::jsonb
      and (not (hands_detail_overrides ? 'apartment') or jsonb_typeof(hands_detail_overrides->'apartment')='boolean')
      and (not (hands_detail_overrides ? 'comment') or jsonb_typeof(hands_detail_overrides->'comment')='boolean')
      and (hands_comment_source is null or jsonb_typeof(hands_comment_source)='object')
    );
  end if;
end $$;
comment on column public.orders.apartment is 'Local apartment, editable by existing order-management roles. Hands specialist feed currently omits this field.';
comment on column public.orders.hands_detail_overrides is 'Per-field manual edits, including explicit clearing. Never writable by masters.';
comment on column public.orders.hands_comment_source is 'Last nonempty Hands comment components; not a full customer payload.';
