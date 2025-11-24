-- Add raw_data and final_updated columns to resume_ai_reviews table

ALTER TABLE resume_ai_reviews
ADD COLUMN IF NOT EXISTS raw_data TEXT,
ADD COLUMN IF NOT EXISTS final_updated TEXT;
