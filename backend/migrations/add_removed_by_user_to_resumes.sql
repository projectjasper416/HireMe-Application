-- Add removed_by_user column to resumes table for soft delete functionality
-- When set to true, the resume is hidden from the user but not deleted from the database

ALTER TABLE public.resumes 
ADD COLUMN IF NOT EXISTS removed_by_user BOOLEAN DEFAULT FALSE NOT NULL;

-- Create index for filtering out removed resumes
CREATE INDEX IF NOT EXISTS resumes_removed_by_user_idx ON public.resumes(removed_by_user) 
WHERE removed_by_user = FALSE;

