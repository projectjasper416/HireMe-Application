-- Migration to add raw_data and final_updated columns to resume_ai_tailorings
-- Run this if the table already exists

ALTER TABLE public.resume_ai_tailorings 
ADD COLUMN IF NOT EXISTS raw_data jsonb,
ADD COLUMN IF NOT EXISTS final_updated jsonb;
