-- Migration: Rename raw_data to tailored_suggestions in resume_ai_tailorings
-- Date: 2025-11-26

ALTER TABLE resume_ai_tailorings RENAME COLUMN raw_data TO tailored_suggestions;
