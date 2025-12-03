-- Create resume_scores table for storing generic and job-specific resume scores
-- This table stores both generic resume scores (job_id IS NULL) and job-specific scores (job_id IS NOT NULL)

CREATE TABLE IF NOT EXISTS public.resume_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id UUID REFERENCES public.resumes(id) ON DELETE CASCADE NOT NULL,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL, -- NULL for generic scores
  score_type TEXT NOT NULL CHECK (score_type IN ('generic', 'job_specific')),
  overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  score_breakdown JSONB NOT NULL,
  suggestions TEXT[],
  improvement_areas TEXT[],
  keyword_coverage JSONB, -- Only for job_specific scores
  comparison_score INTEGER, -- Only for job_specific (baseline before tailoring)
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS resume_scores_resume_id_idx ON public.resume_scores(resume_id);
CREATE INDEX IF NOT EXISTS resume_scores_job_id_idx ON public.resume_scores(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS resume_scores_score_type_idx ON public.resume_scores(score_type);

-- Create partial unique indexes to handle NULL job_id correctly
-- Generic scores: one per resume (where job_id IS NULL and score_type = 'generic')
-- This prevents multiple generic scores for the same resume
CREATE UNIQUE INDEX IF NOT EXISTS resume_scores_generic_unique_idx 
  ON public.resume_scores(resume_id) 
  WHERE job_id IS NULL AND score_type = 'generic';

-- Job-specific scores: one per resume+job combination (where job_id IS NOT NULL)
-- This prevents multiple job-specific scores for the same resume+job
CREATE UNIQUE INDEX IF NOT EXISTS resume_scores_job_specific_unique_idx 
  ON public.resume_scores(resume_id, job_id) 
  WHERE job_id IS NOT NULL AND score_type = 'job_specific';

-- Enable RLS
ALTER TABLE public.resume_scores ENABLE ROW LEVEL SECURITY;

-- Policies for RLS
CREATE POLICY "Users can view their own resume scores"
  ON public.resume_scores FOR SELECT
  USING (auth.uid() IN (
    SELECT user_id FROM public.resumes WHERE id = resume_scores.resume_id
  ));

CREATE POLICY "Users can insert their own resume scores"
  ON public.resume_scores FOR INSERT
  WITH CHECK (auth.uid() IN (
    SELECT user_id FROM public.resumes WHERE id = resume_scores.resume_id
  ));

CREATE POLICY "Users can update their own resume scores"
  ON public.resume_scores FOR UPDATE
  USING (auth.uid() IN (
    SELECT user_id FROM public.resumes WHERE id = resume_scores.resume_id
  ));

CREATE POLICY "Users can delete their own resume scores"
  ON public.resume_scores FOR DELETE
  USING (auth.uid() IN (
    SELECT user_id FROM public.resumes WHERE id = resume_scores.resume_id
  ));

