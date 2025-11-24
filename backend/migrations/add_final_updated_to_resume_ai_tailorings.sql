-- Add final_updated column to resume_ai_tailorings table

ALTER TABLE resume_ai_tailorings
ADD COLUMN IF NOT EXISTS final_updated TEXT;
