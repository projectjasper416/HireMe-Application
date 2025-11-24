import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { extractContactSectionWithLLM, parseResumeWithLLM } from '../services/llmParser';
import { reviewSectionWithLLM } from '../services/reviewLLM';
import { tailorSectionWithLLM } from '../services/tailorLLM';
import { renderResumePdf } from '../services/exportResume';
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

function cleanupSectionBody(heading: string, body: string): string {
  if (!body) return body;
  const lowerHeading = heading.toLowerCase();
  if (lowerHeading.includes('contact')) {
    return body;
  }

  const labelRegex = /^([\u2022•\-\*]?\s*)([A-Za-z][A-Za-z0-9 &'()/\-]{2,40}):\s*/;

  const cleaned = body
    .split('\n')
    .map((line) => {
      let updated = line;
      let iterations = 0;
      while (labelRegex.test(updated) && iterations < 3) {
        updated = updated.replace(labelRegex, (_, bullet) => (bullet ?? ''));
        iterations += 1;
      }
      return updated;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned.length > 0 ? cleaned : body;
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

  const normalizedSections = sanitizedSections.map((section) => ({
    ...section,
    body: cleanupSectionBody(section.heading, section.body),
  }));

  const normalizedContent = normalizedSections
    .map((section) => `${section.heading}\n${section.body}`)
    .join('\n\n');
  const resumeId = uuid();

  const { error } = await supabaseAdmin.from('resumes').insert({
    id: resumeId,
    user_id: req.user!.id,
    original_name: fileName,
    original_content: normalizedContent,
    sections: normalizedSections,
    original_pdf_base64: originalPdfBase64,
  });

  if (error) return res.status(400).json({ error: error.message });

  return res.status(201).json({ id: resumeId, sections: normalizedSections });
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
    .select('section_name, ai_suggestions_html, raw_data, final_updated, created_at')
    .eq('resume_id', resumeId);

  if (reviewError) {
    return res.status(400).json({ error: reviewError.message });
  }

  const reviewsBySection =
    reviewData?.reduce<Record<string, ResumeReview>>((acc, review) => {
      acc[review.section_name] = {
        section_name: review.section_name,
        ai_suggestions_html: review.ai_suggestions_html,
        raw_data: review.raw_data,
        final_updated: review.final_updated,
        created_at: review.created_at,
      };
      return acc;
    }, {}) ?? {};

  const sectionsWithReview = (data.sections as ResumeSection[]).map((section) => {
    const review = reviewsBySection[section.heading];
    // If there is a final_updated version AND we are not requesting original, use that as the body
    const useOriginal = req.query.original === 'true';
    const body = (!useOriginal && review?.final_updated) ? review.final_updated : section.body;
    return {
      ...section,
      body,
      ai_review: review ?? null,
    };
  });

  return res.json({
    sections: sectionsWithReview,
    created_at: data.created_at,
  });
});

function acceptTailoringChanges(html: string): string {
  // 1. Remove <del>...</del> and its content
  let text = html.replace(/<del[^>]*>[\s\S]*?<\/del>/gi, '');

  // 2. Remove <ins> tags but keep content
  text = text.replace(/<ins[^>]*>([\s\S]*?)<\/ins>/gi, '$1');

  // 3. Handle lists: convert <li> to bullets
  text = text.replace(/<li[^>]*>/gi, '\n• ');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/ul>/gi, '\n');
  text = text.replace(/<\/ol>/gi, '\n');

  // 4. Replace <br>, <p>, <div> with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');

  // 5. Remove all other tags
  text = text.replace(/<[^>]+>/g, '');

  // 6. Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 7. Fix multiple newlines and trim
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

resumeRouter.post('/:resumeId/export', async (req: AuthenticatedRequest, res) => {
  const { resumeId } = req.params;
  const { templateId, jobId } = (req.body ?? {}) as {
    templateId?: string;
    jobId?: string;
  };

  if (!templateId) {
    return res.status(400).json({ error: 'templateId is required' });
  }

  const { data, error } = await supabaseAdmin
    .from('resumes')
    .select('sections, original_name')
    .eq('id', resumeId)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: 'Resume not found' });
  }

  let sections = (data.sections as ResumeSection[]) ?? [];
  if (sections.length === 0) {
    return res.status(400).json({ error: 'Resume has no sections to export' });
  }

  // For AI Review exports (no jobId): merge final_updated or ai_suggestions_html
  if (!jobId) {
    const { data: reviewData } = await supabaseAdmin
      .from('resume_ai_reviews')
      .select('section_name, final_updated, ai_suggestions_html, raw_data')
      .eq('resume_id', resumeId);

    if (reviewData) {
      const updates = reviewData.reduce((acc: Record<string, { body: string; raw_body?: any }>, review: any) => {
        // Use final_updated if available, otherwise ai_suggestions_html
        const content = review.final_updated || review.ai_suggestions_html;
        if (content) {
          acc[review.section_name] = {
            body: content,
            // Only use saved raw_body if we're using ai_suggestions (not final_updated)
            // This ensures user edits are visible in PDF
            raw_body: review.final_updated ? undefined : (review.raw_data ? JSON.parse(review.raw_data) : undefined),
          };
        }
        return acc;
      }, {} as Record<string, { body: string; raw_body?: any }>);

      sections = sections.map((section) => {
        const update = updates[section.heading];
        if (update) {
          return {
            ...section,
            body: update.body,
            raw_body: update.raw_body,
          };
        }
        return section;
      });
    }
  }
  // For AI Tailor exports (jobId provided): fetch tailorings from database
  else {
    const { data: tailorings, error: tailorError } = await supabaseAdmin
      .from('resume_ai_tailorings')
      .select('section_name, tailored_html, final_updated')
      .eq('resume_id', resumeId)
      .eq('job_id', jobId);

    if (!tailorError && tailorings) {
      sections = sections.map((section) => {
        const match = tailorings.find((t) => t.section_name === section.heading);
        if (match) {
          // Use final_updated if available, otherwise tailored_html
          const content = match.final_updated || match.tailored_html;
          if (content) {
            return {
              ...section,
              body: acceptTailoringChanges(content),
              // Clear raw_body when using tailored content
              raw_body: undefined,
            };
          }
        }
        return section;
      });
    }
  }


  try {
    const pdfBuffer = await renderResumePdf(sections, templateId);
    const safeName =
      typeof data.original_name === 'string'
        ? data.original_name.replace(/\.[^/.]+$/, '').replace(/[^\w\-]+/g, '_')
        : 'resume';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Failed to render resume PDF', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to export resume', detail: message });
  }
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
        section_name: section.heading, // Enforce original section name
        ai_suggestions_html: review.review_html,
        raw_data: section.body,
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
          raw_data: review.raw_data,
          final_updated: null, // Clear previous edits so new suggestions are shown
        })),
        { onConflict: 'resume_id,section_name' }
      );

    if (upsertError) {
      return res.status(400).json({ error: upsertError.message });
    }
  }

  return res.json({ reviews: results });
});

resumeRouter.post('/:resumeId/tailor', async (req: AuthenticatedRequest, res) => {
  const { resumeId } = req.params;
  const { jobId, jobDescription, keywords, sectionName } = req.body as {
    jobId?: string;
    jobDescription?: string;
    keywords?: string[];
    sectionName?: string;
  };

  if (!jobId && (!jobDescription || !keywords)) {
    return res.status(400).json({ error: 'Either jobId OR (jobDescription AND keywords) must be provided' });
  }

  const { data: resume, error } = await supabaseAdmin
    .from('resumes')
    .select('sections')
    .eq('id', resumeId)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (error || !resume) {
    return res.status(404).json({ error: 'Resume not found' });
  }

  let targetJD = jobDescription;
  let targetKeywords = keywords;

  if (jobId) {
    const { data: job, error: jobError } = await supabaseAdmin
      .from('jobs')
      .select('job_description, keywords')
      .eq('id', jobId)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (jobError || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    targetJD = job.job_description;
    const rawKeywords = job.keywords as any;
    if (rawKeywords?.categories && Array.isArray(rawKeywords.categories)) {
      targetKeywords = rawKeywords.categories.flatMap((c: any) => c.keywords || []);
    } else if (Array.isArray(rawKeywords)) {
      targetKeywords = rawKeywords;
    } else {
      targetKeywords = [];
    }
  }

  if (!targetJD) {
    return res.status(400).json({ error: 'Job description is missing' });
  }

  let sections = resume.sections as ResumeSection[];

  // We intentionally DO NOT merge final_updated here.
  // Tailoring should always start from the ORIGINAL resume content.

  if (sectionName) {
    sections = sections.filter((s) => s.heading === sectionName);
    if (sections.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
  }

  const results: any[] = [];

  for (const section of sections) {
    try {
      // Skip contact info for tailoring usually, but let's keep it consistent or skip if needed.
      // The prompt handles it (instructions say "For contact information, only normalize...").
      const tailorResult = await tailorSectionWithLLM({
        sectionName: section.heading,
        content: section.body,
        jobDescription: targetJD,
        keywords: targetKeywords || [],
      });

      results.push({
        resume_id: resumeId,
        job_id: jobId || null,
        section_name: section.heading, // Enforce original section name
        tailored_html: tailorResult.tailored_html,
        original_text: section.body,
        final_updated: null,
      });
    } catch (err) {
      console.error(`Error tailoring section ${section.heading}:`, err);
      // Continue with other sections or fail? Let's continue and return what we have, or fail partially.
      // For now, let's just log and continue.
    }
  }

  if (results.length > 0) {
    // Delete existing tailorings for this resume+job to avoid duplicates/stale data
    if (jobId) {
      await supabaseAdmin
        .from('resume_ai_tailorings')
        .delete()
        .eq('resume_id', resumeId)
        .eq('job_id', jobId);
    } else {
      // If no job ID, we might want to clear previous ad-hoc tailorings or just insert new ones.
      // Since unique constraint is (resume_id, job_id, section_name), and job_id is nullable...
      // We should probably clear where job_id is null.
      await supabaseAdmin
        .from('resume_ai_tailorings')
        .delete()
        .eq('resume_id', resumeId)
        .is('job_id', null);
    }

    const { error: insertError } = await supabaseAdmin
      .from('resume_ai_tailorings')
      .insert(results);

    if (insertError) {
      return res.status(400).json({ error: insertError.message });
    }
  }

  return res.json({ tailorings: results });
});

resumeRouter.get('/:resumeId/tailorings', async (req: AuthenticatedRequest, res) => {
  const { resumeId } = req.params;
  const { jobId } = req.query;

  let query = supabaseAdmin
    .from('resume_ai_tailorings')
    .select('*, final_updated') // Explicitly selecting final_updated just in case * doesn't catch it immediately or for clarity
    .eq('resume_id', resumeId);

  if (jobId) {
    query = query.eq('job_id', jobId);
  } else {
    query = query.is('job_id', null);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ tailorings: data });
});

resumeRouter.put('/:resumeId/tailorings', async (req: AuthenticatedRequest, res) => {
  const { resumeId } = req.params;
  const { jobId, sectionName, tailoredHtml, originalText } = req.body as {
    jobId: string;
    sectionName: string;
    tailoredHtml: string;
    originalText: string;
  };

  if (!jobId || !sectionName || tailoredHtml === undefined || originalText === undefined) {
    return res.status(400).json({ error: 'Missing required fields: jobId, sectionName, tailoredHtml, originalText' });
  }

  // Verify resume ownership
  const { data: resume, error: resumeError } = await supabaseAdmin
    .from('resumes')
    .select('id')
    .eq('id', resumeId)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (resumeError || !resume) {
    return res.status(404).json({ error: 'Resume not found' });
  }

  // Upsert tailoring
  // Check if tailoring exists
  const { data: existing } = await supabaseAdmin
    .from('resume_ai_tailorings')
    .select('*')
    .eq('resume_id', resumeId)
    .eq('job_id', jobId)
    .eq('section_name', sectionName)
    .maybeSingle();

  let data;
  let opError;

  if (existing) {
    const { data: updated, error } = await supabaseAdmin
      .from('resume_ai_tailorings')
      .update({ final_updated: sanitizeUnicode(tailoredHtml) })
      .eq('resume_id', resumeId)
      .eq('job_id', jobId)
      .eq('section_name', sectionName)
      .select()
      .single();
    data = updated;
    opError = error;
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from('resume_ai_tailorings')
      .insert({
        resume_id: resumeId,
        job_id: jobId,
        section_name: sectionName,
        tailored_html: sanitizeUnicode(tailoredHtml),
        final_updated: sanitizeUnicode(tailoredHtml),
        original_text: sanitizeUnicode(originalText),
      })
      .select()
      .single();
    data = inserted;
    opError = error;
  }

  if (opError) {
    return res.status(400).json({ error: opError.message });
  }

  return res.json({ tailoring: data });
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

  // We DO NOT update the 'resumes' table anymore to preserve original content.
  // Instead, we upsert into 'resume_ai_reviews' with final_updated.

  const sectionHeading = sections[sectionIndex].heading;

  // Check if review exists
  const { data: existingReview } = await supabaseAdmin
    .from('resume_ai_reviews')
    .select('*')
    .eq('resume_id', resumeId)
    .eq('section_name', sectionHeading)
    .maybeSingle();

  if (existingReview) {
    const { error: updateError } = await supabaseAdmin
      .from('resume_ai_reviews')
      .update({
        final_updated: sanitizeUnicode(content),
        raw_data: rawBody !== undefined ? JSON.stringify(sanitizeValue(rawBody)) : existingReview.raw_data,
      })
      .eq('resume_id', resumeId)
      .eq('section_name', sectionHeading);

    if (updateError) return res.status(400).json({ error: updateError.message });
  } else {
    const { error: insertError } = await supabaseAdmin
      .from('resume_ai_reviews')
      .insert({
        resume_id: resumeId,
        section_name: sectionHeading,
        final_updated: sanitizeUnicode(content),
        raw_data: rawBody !== undefined ? JSON.stringify(sanitizeValue(rawBody)) : sections[sectionIndex].body,
        ai_suggestions_html: '', // No AI suggestions yet
      });

    if (insertError) return res.status(400).json({ error: insertError.message });
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
