-- TDD 3.1 Users, 8 Security & Compliance
-- Application-level users table linked to Supabase auth.users

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  avatar_url text,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep email in sync from auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, coalesce((new.raw_user_meta_data->>'role'), 'user'))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Update timestamp
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.users enable row level security;

-- Policies
drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select
  using (auth.uid() = id);

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update
  using (auth.uid() = id);

-- Optional: admin role can read all (requires JWT claim role = 'admin')
drop policy if exists users_admin_read_all on public.users;
create policy users_admin_read_all on public.users
  for select
  using (
    (auth.jwt()->'app_metadata'->>'role') = 'admin'
    or (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );


