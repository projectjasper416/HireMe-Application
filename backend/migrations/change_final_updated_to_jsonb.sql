-- Change final_updated column to JSONB to store structured data
-- This allows us to maintain formatting while preserving user edits

-- First, clear existing data (it's plain text, not JSON)
UPDATE resume_ai_reviews SET final_updated = NULL WHERE final_updated IS NOT NULL;
UPDATE resume_ai_tailorings SET final_updated = NULL WHERE final_updated IS NOT NULL;

-- Now convert to JSONB
ALTER TABLE resume_ai_reviews 
ALTER COLUMN final_updated TYPE JSONB USING final_updated::JSONB;

ALTER TABLE resume_ai_tailorings
ALTER COLUMN final_updated TYPE JSONB USING final_updated::JSONB;
