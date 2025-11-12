-- PRD 6.1 Resume Workspace
-- TDD 3.2 Resumes

create table if not exists public.resumes (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  original_name text not null,
  original_content text not null,
  sections jsonb not null,
  original_pdf_base64 text,
  created_at timestamptz not null default now()
);

create table if not exists public.resume_ai_reviews (
  id serial primary key,
  resume_id uuid references public.resumes(id) on delete cascade,
  section_name text not null,
  ai_suggestions_html text not null,
  created_at timestamptz not null default now(),
  unique (resume_id, section_name)
);

alter table public.resumes enable row level security;
alter table public.resume_ai_reviews enable row level security;

drop policy if exists resumes_select_own on public.resumes;
create policy resumes_select_own on public.resumes
  for select using (auth.uid() = user_id);

drop policy if exists resumes_insert_own on public.resumes;
create policy resumes_insert_own on public.resumes
  for insert with check (auth.uid() = user_id);

drop policy if exists resumes_update_own on public.resumes;
create policy resumes_update_own on public.resumes
  for update using (auth.uid() = user_id);

drop policy if exists resume_ai_reviews_select_owner on public.resume_ai_reviews;
create policy resume_ai_reviews_select_owner on public.resume_ai_reviews
  for select using (
    exists (
      select 1 from public.resumes r
      where r.id = resume_ai_reviews.resume_id and r.user_id = auth.uid()
    )
  );

drop policy if exists resume_ai_reviews_insert_owner on public.resume_ai_reviews;
create policy resume_ai_reviews_insert_owner on public.resume_ai_reviews
  for insert with check (
    exists (
      select 1 from public.resumes r
      where r.id = resume_ai_reviews.resume_id and r.user_id = auth.uid()
    )
  );

drop policy if exists resume_ai_reviews_update_owner on public.resume_ai_reviews;
create policy resume_ai_reviews_update_owner on public.resume_ai_reviews
  for update using (
    exists (
      select 1 from public.resumes r
      where r.id = resume_ai_reviews.resume_id and r.user_id = auth.uid()
    )
  );

