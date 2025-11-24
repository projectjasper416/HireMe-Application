-- Add keywords column to jobs table to store extracted ATS-friendly keywords
-- This allows keywords to be persisted and displayed when reopening job cards

alter table public.jobs 
add column if not exists keywords jsonb;

-- Add comment for documentation
comment on column public.jobs.keywords is 'Stored extracted keywords in JSON format: {"categories": [{"category": "...", "keywords": [...]}]}';

