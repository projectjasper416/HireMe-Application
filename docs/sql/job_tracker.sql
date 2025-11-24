-- PRD 6.4 Job Tracker
-- TDD 3.4 Jobs

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  company text not null,
  role text not null,
  job_description text,
  status text not null default 'Interested',
  notes text,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jobs enable row level security;

drop policy if exists jobs_select_own on public.jobs;
create policy jobs_select_own on public.jobs
  for select using (auth.uid() = user_id);

drop policy if exists jobs_insert_own on public.jobs;
create policy jobs_insert_own on public.jobs
  for insert with check (auth.uid() = user_id);

drop policy if exists jobs_update_own on public.jobs;
create policy jobs_update_own on public.jobs
  for update using (auth.uid() = user_id);

drop policy if exists jobs_delete_own on public.jobs;
create policy jobs_delete_own on public.jobs
  for delete using (auth.uid() = user_id);

-- Create index for faster queries
create index if not exists jobs_user_id_idx on public.jobs(user_id);
create index if not exists jobs_status_idx on public.jobs(status);

