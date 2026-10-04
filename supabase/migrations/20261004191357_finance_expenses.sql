-- Company operating expenses are separate from order/payroll accounting.
create table public.finance_expenses (
  id uuid primary key,
  expense_date date not null check (expense_date between date '1900-01-01' and date '9999-12-31'),
  amount numeric(11,2) not null check (amount > 0 and amount <= 999999999.99),
  category text not null check (char_length(category) between 1 and 40),
  comment text not null default '' check (char_length(comment) <= 500),
  city text check (char_length(city) between 1 and 100),
  order_id bigint references public.orders(id) on delete set null,
  employee_id uuid references public.business_staff(id) on delete set null,
  created_by_staff_id uuid not null references public.business_staff(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_other_description check (category <> 'other' or length(trim(comment)) > 0)
);
create index finance_expenses_date_id on public.finance_expenses(expense_date desc, id);
create index finance_expenses_order_id on public.finance_expenses(order_id) where order_id is not null;
create index finance_expenses_employee_id on public.finance_expenses(employee_id) where employee_id is not null;
create index finance_expenses_author_id on public.finance_expenses(created_by_staff_id);
alter table public.finance_expenses enable row level security;
revoke all on public.finance_expenses from public, anon, authenticated;
grant select, insert, update, delete on public.finance_expenses to service_role;
-- Explicit deny documents that authorization belongs to the existing Edge API.
create policy finance_expenses_no_direct_access on public.finance_expenses
  for all to anon, authenticated using (false) with check (false);
