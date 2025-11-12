import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { extractContactSectionWithLLM, parseResumeWithLLM } from '../services/llmParser';
import { reviewSectionWithLLM } from '../services/reviewLLM';
import type { ResumeReview, ResumeSection } from '../types/resume';

function sanitizeUnicode(str: string): string {
  return str
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\\(?!["\\/bfnrtu])/g, '\\')
    .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\u')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeUnicode(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        sanitizeUnicode(key),
        sanitizeValue(val),
      ])
    );
  }

  return value;
}

function sanitizeSections(sections: any[]) {
  return sections.map((section) => {
    const heading = typeof section.heading === 'string' ? section.heading : '';
    const body = typeof section.body === 'string' ? section.body : '';
    const rawBody = sanitizeValue(section.raw_body ?? null);

    return {
      heading: sanitizeUnicode(heading),
      body: sanitizeUnicode(body),
      raw_body: rawBody,
    };
  });
}

export const resumeRouter = Router();

// PRD 6.1 Resume Workspace: secure APIs behind auth
resumeRouter.use(requireAuth());

// TDD 4.2 Resume Management Endpoints: upload + parse
resumeRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { fileName, originalPdfBase64 } = req.body as {
    fileName: string;
    originalPdfBase64: string;
  };

  if (!fileName) {
    return res.status(400).json({ error: 'fileName is required' });
  }

  if (!originalPdfBase64) {
    return res.status(400).json({ error: 'originalPdfBase64 is required' });
  }

  let parsedSections;
  try {
    parsedSections = await parseResumeWithLLM({ fileBase64: originalPdfBase64 });
  } catch (error) {
    console.error('Resume parsing LLM error:', error);
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return res.status(502).json({
      error: 'Unable to parse resume. Check parsing LLM configuration or credentials.',
      detail,
    });
  }

  const sanitizedSections = sanitizeSections(parsedSections);

  const hasContactSection = sanitizedSections.some((section) =>
    section.heading.toLowerCase().includes('contact')
  );
  if (!hasContactSection) {
    try {
      const contactSection = await extractContactSectionWithLLM({ fileBase64: originalPdfBase64 });
      if (contactSection) {
        const [sanitizedContact] = sanitizeSections([contactSection]);
        if (sanitizedContact) {
          sanitizedSections.unshift({
            ...sanitizedContact,
            heading: sanitizedContact.heading || 'Contact Information',
          });
        }
      }
    } catch (contactErr) {
      console.warn('Contact extraction via LLM failed, continuing without contact section.', contactErr);
    }
  }

  const normalizedContent = sanitizedSections
    .map((section) => `${section.heading}\n${section.body}`)
    .join('\n\n');
  const resumeId = uuid();

  const { error } = await supabaseAdmin.from('resumes').insert({
    id: resumeId,
    user_id: req.user!.id,
    original_name: fileName,
    original_content: normalizedContent,
    sections: sanitizedSections,
    original_pdf_base64: originalPdfBase64,
  });

  if (error) return res.status(400).json({ error: error.message });

  return res.status(201).json({ id: resumeId, sections: sanitizedSections });
});

resumeRouter.get('/:resumeId/sections', async (req: AuthenticatedRequest, res) => {
  const { resumeId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('resumes')
    .select('sections, created_at')
    .eq('id', resumeId)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: 'Resume not found' });
  }

  const { data: reviewData, error: reviewError } = await supabaseAdmin
    .from('resume_ai_reviews')
    .select('section_name, ai_suggestions_html, created_at')
    .eq('resume_id', resumeId);

  if (reviewError) {
    return res.status(400).json({ error: reviewError.message });
  }

  const reviewsBySection =
    reviewData?.reduce<Record<string, ResumeReview>>((acc, review) => {
      acc[review.section_name] = {
        section_name: review.section_name,
        ai_suggestions_html: review.ai_suggestions_html,
        created_at: review.created_at,
      };
      return acc;
    }, {}) ?? {};

  const sectionsWithReview = (data.sections as ResumeSection[]).map((section) => ({
    ...section,
    ai_review: reviewsBySection[section.heading] ?? null,
  }));

  return res.json({
    sections: sectionsWithReview,
    created_at: data.created_at,
  });
});

resumeRouter.post('/:resumeId/review', async (req: AuthenticatedRequest, res) => {
  const { resumeId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('resumes')
    .select('sections')
    .eq('id', resumeId)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: 'Resume not found' });
  }

  const sections = data.sections as ResumeSection[];
  const results: ResumeReview[] = [];

  for (const section of sections) {
    try {
      const review = await reviewSectionWithLLM({
        sectionName: section.heading,
        content: section.body,
      });
      results.push({
        section_name: review.section_name ?? section.heading,
        ai_suggestions_html: review.review_html,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(502).json({
        error: `Unable to review section "${section.heading}"`,
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  if (results.length > 0) {
    const { error: upsertError } = await supabaseAdmin
      .from('resume_ai_reviews')
      .upsert(
        results.map((review) => ({
          resume_id: resumeId,
          section_name: review.section_name,
          ai_suggestions_html: review.ai_suggestions_html,
        })),
        { onConflict: 'resume_id,section_name' }
      );

    if (upsertError) {
      return res.status(400).json({ error: upsertError.message });
    }
  }

  return res.json({ reviews: results });
});

resumeRouter.put('/:resumeId/sections/:index', async (req: AuthenticatedRequest, res) => {
  const { resumeId, index } = req.params;
  const sectionIndex = Number.parseInt(index, 10);
  if (Number.isNaN(sectionIndex) || sectionIndex < 0) {
    return res.status(400).json({ error: 'Invalid section index' });
  }

  const { content, rawBody } = req.body as { content: string; rawBody?: unknown };
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content must be provided' });
  }

  const { data, error } = await supabaseAdmin
    .from('resumes')
    .select('sections')
    .eq('id', resumeId)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: 'Resume not found' });
  }

  const sections = [...(data.sections as ResumeSection[])];
  if (!sections[sectionIndex]) {
    return res.status(404).json({ error: 'Section not found' });
  }

  sections[sectionIndex] = {
    ...sections[sectionIndex],
    body: sanitizeUnicode(content),
    raw_body: rawBody !== undefined ? sanitizeValue(rawBody) : sections[sectionIndex].raw_body,
  };

  const normalizedContent = sections.map((section) => `${section.heading}\n${section.body}`).join('\n\n');

  const { error: updateError } = await supabaseAdmin
    .from('resumes')
    .update({
      sections,
      original_content: normalizedContent,
    })
    .eq('id', resumeId);

  if (updateError) {
    return res.status(400).json({ error: updateError.message });
  }

  return res.json({ section: sections[sectionIndex] });
});

// List resumes
resumeRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('resumes')
    .select('id, original_name, sections, created_at')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ resumes: data });
});
