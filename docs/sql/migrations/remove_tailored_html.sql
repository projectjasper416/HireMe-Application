-- Migration: Remove deprecated tailored_html column from resume_ai_tailorings
-- Date: 2025-11-26

ALTER TABLE resume_ai_tailorings DROP COLUMN IF EXISTS tailored_html;
