create table if not exists public.resume_ai_tailorings (
  id uuid default gen_random_uuid() primary key,
  resume_id uuid references public.resumes(id) on delete cascade not null,
  job_id uuid references public.jobs(id) on delete set null,
  section_name text not null,
  tailored_html text not null,
  original_text text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(resume_id, job_id, section_name)
);

-- Enable RLS
alter table public.resume_ai_tailorings enable row level security;

-- Policies
create policy "Users can view their own tailorings"
  on public.resume_ai_tailorings for select
  using (auth.uid() in (
    select user_id from public.resumes where id = resume_ai_tailorings.resume_id
  ));

create policy "Users can insert their own tailorings"
  on public.resume_ai_tailorings for insert
  with check (auth.uid() in (
    select user_id from public.resumes where id = resume_ai_tailorings.resume_id
  ));

create policy "Users can update their own tailorings"
  on public.resume_ai_tailorings for update
  using (auth.uid() in (
    select user_id from public.resumes where id = resume_ai_tailorings.resume_id
  ));

create policy "Users can delete their own tailorings"
  on public.resume_ai_tailorings for delete
  using (auth.uid() in (
    select user_id from public.resumes where id = resume_ai_tailorings.resume_id
  ));
