import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { updateRawBodyWithText } from '../services/rawBodyUpdater';
import { rawBodyToText } from '../services/rawBodyToText';
import { renderResumePdf } from '../services/exportResume';
import { extractContactSectionWithLLM, parseResumeWithLLM } from '../services/llmParser';
import { reviewSectionWithLLM } from '../services/reviewLLM';
import { reviewSectionStructured } from '../services/structuredReviewLLM';
import { regenerateBulletWithLLM } from '../services/regenerateBulletLLM';
import { tailorSectionWithLLM, tailorSectionStructured } from '../services/tailorLLM';
import type { ResumeReview, ResumeSection } from '../types/resume';
import { Logger } from '../utils/Logger';

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
  const transactionId = `upload-resume-${uuid()}`;
  try {
    const { fileName, originalPdfBase64 } = req.body as {
      fileName: string;
      originalPdfBase64: string;
    };

    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    if (!originalPdfBase64) {
      await Logger.logBackendError('Resumes', new Error('originalPdfBase64 is required'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes',
        UserID: req.user?.id,
        Status: 'VALIDATION_ERROR'
      });
      return res.status(400).json({ error: 'originalPdfBase64 is required' });
    }

    let parsedSections;
    try {
      parsedSections = await parseResumeWithLLM({ fileBase64: originalPdfBase64 });
    } catch (error) {
      await Logger.logBackendError('Resumes', error, {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes',
        UserID: req.user?.id,
        Status: 'LLM_ERROR',
        Exception: 'Resume parsing LLM error'
      });
      const detail = error instanceof Error ? error.message : 'Unknown error';
      return res.status(502).json({
        error: 'Unable to parse resume. Check parsing LLM configuration or credentials.',
        detail,
      });
    }
  //console.log('[resumes.ts] parsedSections:', JSON.stringify(parsedSections));
  const sanitizedSections = sanitizeSections(parsedSections);
  //console.log('[resumes.ts] sanitizedSections:', JSON.stringify(sanitizedSections));
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
      await Logger.logBackendError('Resumes', contactErr as Error, {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes',
        UserID: req.user?.id,
        Status: 'LLM_WARNING',
        Exception: 'Contact extraction via LLM failed, continuing without contact section'
      });
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
  //console.log('[resumes.ts] normalizedSections:', JSON.stringify(normalizedSections));
    const { error } = await supabaseAdmin.from('resumes').insert({
      id: resumeId,
      user_id: req.user!.id,
      original_name: fileName,
      original_content: normalizedContent,
      sections: normalizedSections,
      original_pdf_base64: originalPdfBase64,
    });

    if (error) {
      await Logger.logBackendError('Resumes', error, {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes',
        UserID: req.user?.id,
        Status: 'DATABASE_ERROR'
      });
      return res.status(400).json({ error: error.message });
    }

    await Logger.logInfo('Resumes', 'Resume uploaded and parsed successfully', {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes',
      UserID: req.user?.id,
      Status: 'SUCCESS',
      RelatedTo: resumeId,
      ResponsePayload: { sectionsCount: normalizedSections.length }
    });

    return res.status(201).json({ id: resumeId, sections: normalizedSections });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes',
      UserID: req.user?.id,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

resumeRouter.get('/:resumeId/sections', async (req: AuthenticatedRequest, res) => {
  const transactionId = `get-sections-${uuid()}`;
  try {
    const { resumeId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('resumes')
      .select('sections, created_at')
      .eq('id', resumeId)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (error || !data) {
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'GET /resumes/:resumeId/sections',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
      return res.status(404).json({ error: 'Resume not found' });
    }

    const { data: reviewData, error: reviewError } = await supabaseAdmin
      .from('resume_ai_reviews')
      .select('section_name, ai_suggestions_html, raw_data, final_updated, created_at')
      .eq('resume_id', resumeId);

    if (reviewError) {
      await Logger.logBackendError('Resumes', reviewError, {
        TransactionID: transactionId,
        Endpoint: 'GET /resumes/:resumeId/sections',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'DATABASE_ERROR'
      });
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

    // Convert final_updated from JSONB to text for frontend
    let body = section.body;
    if (!useOriginal && review?.final_updated) {
      body = rawBodyToText(review.final_updated);
    }

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
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'GET /resumes/:resumeId/sections',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
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
  const transactionId = `export-resume-${uuid()}`;
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
      .select('section_name, final_updated, ai_suggestions_html')
      .eq('resume_id', resumeId);

    if (reviewData) {
      sections = sections.map((section) => {
        const review = reviewData.find(r => r.section_name === section.heading);
        if (review) {
          // If final_updated exists (user saved changes), use it as raw_body for structure
          if (review.final_updated) {
            return {
              ...section,
              raw_body: review.final_updated,  // Use structured data for perfect formatting!
            };
          }
          // Otherwise use ai_suggestions_html as body text
          if (review.ai_suggestions_html) {
            return {
              ...section,
              body: review.ai_suggestions_html,
            };
          }
        }
        return section;
      });
    }
  }
  // For AI Tailor exports (jobId provided): fetch tailorings from database
  else {
    const { data: tailorings, error: tailorError } = await supabaseAdmin
      .from('resume_ai_tailorings')
      .select('section_name, final_updated')
      .eq('resume_id', resumeId)
      .eq('job_id', jobId);

    if (!tailorError && tailorings) {
      sections = sections.map((section) => {
        const match = tailorings.find((t) => t.section_name === section.heading);
        if (match) {
          // Handle structured tailoring (final_updated is JSONB)
          if (match.final_updated) {
            // Use final_updated as raw_body for structured rendering
            return {
              ...section,
              raw_body: match.final_updated,
            };
          }

        }
        return section;
      });
    }
  }


  try {
    const pdfBuffer = await renderResumePdf(sections, templateId, req.user!.id);
    const safeName =
      typeof data.original_name === 'string'
        ? data.original_name.replace(/\.[^/.]+$/, '').replace(/[^\w\-]+/g, '_')
        : 'resume';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    await Logger.logBackendError('Resumes', err, {
      TransactionID: transactionId,
      Endpoint: 'GET /resumes/:resumeId/export',
      UserID: req.user?.id,
      RelatedTo: resumeId,
      Status: 'EXPORT_ERROR'
    });
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to export resume', detail: message });
  }
});

resumeRouter.post('/:resumeId/review', async (req: AuthenticatedRequest, res) => {
  const transactionId = `review-resume-${uuid()}`;
  try {
    const { resumeId } = req.params;


    const { data, error } = await supabaseAdmin
      .from('resumes')
      .select('sections')
      .eq('id', resumeId)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (error || !data) {
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/review',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
      return res.status(404).json({ error: 'Resume not found' });
    }

    const sections = data.sections as ResumeSection[];
    const results: ResumeReview[] = [];

    for (const section of sections) {
      try {
        // Always use structured review
        const structuredReview = await reviewSectionStructured({
          sectionName: section.heading,
          rawBody: section.raw_body || { summary: [section.body] },
        });

        // Store structured review as JSON string in ai_suggestions_html
        results.push({
          section_name: section.heading,
          ai_suggestions_html: JSON.stringify(structuredReview),
          raw_data: JSON.stringify(section.raw_body || { summary: [section.body] }),
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        await Logger.logBackendError('Resumes', err, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/review',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'LLM_ERROR',
          Exception: `Unable to review section "${section.heading}"`
        });
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
        await Logger.logBackendError('Resumes', upsertError, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/review',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'DATABASE_ERROR',
          Exception: 'Error upserting review results'
        });
        return res.status(400).json({ error: upsertError.message });
      }

    // Calculate generic resume score after review completes (async, don't block response)
    // This will create or update the score record
    (async () => {
      try {
        const { calculateGenericResumeScore } = await import('../services/genericResumeScore');

        const { data: resumeData } = await supabaseAdmin
          .from('resumes')
          .select('*')
          .eq('id', resumeId)
          .single();

        if (resumeData) {
          // Fetch latest final_updated data
          const { data: reviews } = await supabaseAdmin
            .from('resume_ai_reviews')
            .select('section_name, final_updated')
            .eq('resume_id', resumeId);

          const finalUpdatedBySection: Record<string, any> = {};
          reviews?.forEach(r => {
            if (r.final_updated !== null && r.final_updated !== undefined) {
              finalUpdatedBySection[r.section_name] = r.final_updated;
            }
          });

          const score = await calculateGenericResumeScore(resumeData, finalUpdatedBySection);

          // Upsert score - update existing or create new
          let existingScoreQuery = supabaseAdmin
            .from('resume_scores')
            .select('id')
            .eq('resume_id', resumeId)
            .eq('score_type', 'generic')
            .is('job_id', null);

          const { data: existingRecord } = await existingScoreQuery.maybeSingle();

          if (existingRecord) {
            // Update existing record
            await supabaseAdmin
              .from('resume_scores')
              .update({
                overall_score: score.overallScore,
                score_breakdown: score.breakdown,
                suggestions: score.suggestions,
                improvement_areas: score.improvementAreas,
                keyword_coverage: null,
                comparison_score: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingRecord.id);
          } else {
            // Insert new record
            await supabaseAdmin
              .from('resume_scores')
              .insert({
                resume_id: resumeId,
                job_id: null,
                score_type: 'generic',
                overall_score: score.overallScore,
                score_breakdown: score.breakdown,
                suggestions: score.suggestions,
                improvement_areas: score.improvementAreas,
                keyword_coverage: null,
                comparison_score: null,
              });
          }
        }
      } catch (err) {
        await Logger.logBackendError('Resumes', err, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/review',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'BACKGROUND_ERROR',
          Exception: 'Background score calculation failed'
        });
        // Don't fail the review request if score calculation fails
      }
    })();
    }

    await Logger.logInfo('Resumes', 'Resume review completed successfully', {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/review',
      UserID: req.user?.id,
      RelatedTo: resumeId,
      Status: 'SUCCESS',
      ResponsePayload: { reviewsCount: results.length }
    });

    return res.json({ reviews: results });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/review',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

resumeRouter.post('/:resumeId/tailor', async (req: AuthenticatedRequest, res) => {
  const transactionId = `tailor-resume-${uuid()}`;
  try {
    const { resumeId } = req.params;
    const { jobId, jobDescription, keywords, sectionName } = req.body as {
      jobId?: string;
      jobDescription?: string;
      keywords?: string[];
      sectionName?: string;
    };

    if (!jobId && (!jobDescription || !keywords)) {
      await Logger.logBackendError('Resumes', new Error('Either jobId OR (jobDescription AND keywords) must be provided'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/tailor',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'VALIDATION_ERROR'
      });
      return res.status(400).json({ error: 'Either jobId OR (jobDescription AND keywords) must be provided' });
    }

    const { data: resume, error } = await supabaseAdmin
      .from('resumes')
      .select('sections')
      .eq('id', resumeId)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (error || !resume) {
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/tailor',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
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
        await Logger.logBackendError('Resumes', new Error('Job not found'), {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/tailor',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'NOT_FOUND',
          Exception: `Job ${jobId} not found`
        });
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
        await Logger.logBackendError('Resumes', new Error('Section not found'), {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/tailor',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'NOT_FOUND',
          Exception: `Section "${sectionName}" not found`
        });
        return res.status(404).json({ error: 'Section not found' });
      }
    }

    const results: any[] = [];

    for (const section of sections) {
      try {
        // Call structured tailoring LLM
        const structuredResult = await tailorSectionStructured({
          sectionName: section.heading,
          rawBody: section.raw_body || { summary: [section.body] },
          jobDescription: targetJD,
          keywords: targetKeywords || [],
        });

        results.push({
          resume_id: resumeId,
          job_id: jobId || null,
          section_name: section.heading,

          final_updated: null,
          tailored_suggestions: JSON.stringify(structuredResult), // Stringify for text column
        });
      } catch (err) {
        await Logger.logBackendError('Resumes', err, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/tailor',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'TAILOR_ERROR',
          Exception: `Error tailoring section ${section.heading}`
        });
        // Continue with other sections
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
        await Logger.logBackendError('Resumes', insertError, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/tailor',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'DATABASE_ERROR',
          Exception: 'Error inserting tailoring results'
        });
        return res.status(400).json({ error: insertError.message });
      }

      // Calculate job-specific ATS score after tailoring completes (async, don't block response)
      // Only if jobId exists (job-specific tailoring)
      if (jobId) {
        (async () => {
        try {
          const { calculateJobSpecificATSScore } = await import('../services/jobSpecificATSScore');

          const { data: resumeData } = await supabaseAdmin
            .from('resumes')
            .select('*')
            .eq('id', resumeId)
            .single();

          const { data: job } = await supabaseAdmin
            .from('jobs')
            .select('*')
            .eq('id', jobId)
            .eq('user_id', req.user!.id)
            .maybeSingle();

          if (resumeData && job && job.job_description && job.keywords) {
            // Check if baseline score exists (first time tailoring)
            const { data: existingScore } = await supabaseAdmin
              .from('resume_scores')
              .select('comparison_score, overall_score')
              .eq('resume_id', resumeId)
              .eq('job_id', jobId)
              .eq('score_type', 'job_specific')
              .maybeSingle();

            const baselineScore = existingScore?.comparison_score;

            const { data: tailorings } = await supabaseAdmin
              .from('resume_ai_tailorings')
              .select('section_name, final_updated')
              .eq('resume_id', resumeId)
              .eq('job_id', jobId);

            const finalUpdatedBySection: Record<string, any> = {};
            tailorings?.forEach(t => {
              if (t.final_updated !== null && t.final_updated !== undefined) {
                finalUpdatedBySection[t.section_name] = t.final_updated;
              }
            });

            const score = await calculateJobSpecificATSScore(
              resumeData,
              job.job_description,
              job.keywords as any,
              finalUpdatedBySection,
              baselineScore
            );

            // Upsert score - update existing or create new
            let existingScoreQuery = supabaseAdmin
              .from('resume_scores')
              .select('id')
              .eq('resume_id', resumeId)
              .eq('job_id', jobId)
              .eq('score_type', 'job_specific');

            const { data: existingRecord } = await existingScoreQuery.maybeSingle();

            if (existingRecord) {
              // Update existing record - always update all fields
              await supabaseAdmin
                .from('resume_scores')
                .update({
                  overall_score: score.overallScore,
                  score_breakdown: score.breakdown,
                  suggestions: score.suggestions,
                  improvement_areas: score.improvementAreas,
                  keyword_coverage: score.keywordCoverage,
                  comparison_score: baselineScore !== undefined ? baselineScore : score.overallScore,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', existingRecord.id);
            } else {
              // Insert new record with baseline as comparison
              await supabaseAdmin
                .from('resume_scores')
                .insert({
                  resume_id: resumeId,
                  job_id: jobId,
                  score_type: 'job_specific',
                  overall_score: score.overallScore,
                  score_breakdown: score.breakdown,
                  suggestions: score.suggestions,
                  improvement_areas: score.improvementAreas,
                  keyword_coverage: score.keywordCoverage,
                  comparison_score: score.overallScore, // First score is the baseline
                });
            }
          }
        } catch (err) {
          await Logger.logBackendError('Resumes', err, {
            TransactionID: transactionId,
            Endpoint: 'POST /resumes/:resumeId/tailor',
            UserID: req.user?.id,
            RelatedTo: resumeId,
            Status: 'BACKGROUND_ERROR',
            Exception: 'Background score calculation failed'
          });
          // Don't fail the tailor request if score calculation fails
        }
        })();
      }
    }

    await Logger.logInfo('Resumes', 'Resume tailoring completed successfully', {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/tailor',
      UserID: req.user?.id,
      RelatedTo: resumeId,
      Status: 'SUCCESS',
      ResponsePayload: { tailoringsCount: results.length, jobId }
    });

    return res.json({ tailorings: results });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/tailor',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

resumeRouter.get('/:resumeId/tailorings', async (req: AuthenticatedRequest, res) => {
  const transactionId = `get-tailorings-${uuid()}`;
  try {
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
      await Logger.logBackendError('Resumes', error, {
        TransactionID: transactionId,
        Endpoint: 'GET /resumes/:resumeId/tailorings',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'DATABASE_ERROR'
      });
      return res.status(400).json({ error: error.message });
    }

    return res.json({ tailorings: data });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'GET /resumes/:resumeId/tailorings',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

resumeRouter.put('/:resumeId/tailorings', async (req: AuthenticatedRequest, res) => {
  const transactionId = `update-tailorings-${uuid()}`;
  try {
    const { resumeId } = req.params;
    const { jobId, sectionName, tailoredHtml, originalText } = req.body as {
      jobId: string;
      sectionName: string;
      tailoredHtml: string;
      originalText: string;
    };

    if (!jobId || !sectionName || tailoredHtml === undefined || originalText === undefined) {
      await Logger.logBackendError('Resumes', new Error('Missing required fields'), {
        TransactionID: transactionId,
        Endpoint: 'PUT /resumes/:resumeId/tailorings',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'VALIDATION_ERROR'
      });
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
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'PUT /resumes/:resumeId/tailorings',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
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

        final_updated: sanitizeUnicode(tailoredHtml),
      })
      .select()
      .single();
    data = inserted;
    opError = error;
  }

    if (opError) {
      await Logger.logBackendError('Resumes', opError, {
        TransactionID: transactionId,
        Endpoint: 'PUT /resumes/:resumeId/tailorings',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'DATABASE_ERROR'
      });
      return res.status(400).json({ error: opError.message });
    }

    await Logger.logInfo('Resumes', 'Tailoring updated successfully', {
      TransactionID: transactionId,
      Endpoint: 'PUT /resumes/:resumeId/tailorings',
      UserID: req.user?.id,
      RelatedTo: resumeId,
      Status: 'SUCCESS'
    });

    return res.json({ tailoring: data });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'PUT /resumes/:resumeId/tailorings',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:resumeId/tailorings/:jobId/sections/:sectionIndex/regenerate-bullet
// Regenerate a single bullet for tailoring
resumeRouter.post('/:resumeId/tailorings/:jobId/sections/:sectionIndex/regenerate-bullet', async (req: AuthenticatedRequest, res) => {
  const transactionId = `regenerate-bullet-tailoring-${uuid()}`;
  try {
    const { resumeId, jobId, sectionIndex } = req.params;
    const { bulletId, bulletText, context } = req.body as {
      bulletId: string;
      bulletText: string;
      context: {
        sectionName: string;
        jobDescription: string;
        keywords?: string[];
        company?: string;
        title?: string;
        dates?: string;
        otherBullets?: string[];
      };
    };

    if (!bulletText || !context) {
      await Logger.logBackendError('Resumes', new Error('Missing bulletText or context'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/regenerate-bullet',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'VALIDATION_ERROR'
      });
      return res.status(400).json({ error: 'Missing bulletText or context' });
    }

    try {
      const result = await regenerateBulletWithLLM({
        bulletText,
        context,
      });

      await Logger.logInfo('Resumes', 'Bullet regenerated successfully', {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/regenerate-bullet',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'SUCCESS'
      });

      return res.json({
        bulletId,
        suggested: result.suggested,
      });
    } catch (err) {
      await Logger.logBackendError('Resumes', err, {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/regenerate-bullet',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'LLM_ERROR'
      });
      return res.status(502).json({
        error: 'Failed to regenerate bullet',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/regenerate-bullet',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:resumeId/tailorings/:jobId/sections/:sectionIndex/save-structured
// Save structured edits for tailoring (auto-save)
resumeRouter.post('/:resumeId/tailorings/:jobId/sections/:sectionIndex/save-structured', async (req: AuthenticatedRequest, res) => {
  const transactionId = `save-structured-tailoring-${uuid()}`;
  try {
    const { resumeId, jobId, sectionIndex } = req.params;
    const { finalUpdated } = req.body as { finalUpdated: any };

    const { data, error } = await supabaseAdmin
      .from('resumes')
      .select('sections')
      .eq('id', resumeId)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (error || !data) {
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/save-structured',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
      return res.status(404).json({ error: 'Resume not found' });
    }

    const sections = data.sections as ResumeSection[];
    const idx = parseInt(sectionIndex, 10);

    if (idx < 0 || idx >= sections.length) {
      await Logger.logBackendError('Resumes', new Error('Invalid section index'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/save-structured',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'VALIDATION_ERROR'
      });
      return res.status(400).json({ error: 'Invalid section index' });
    }

    const sectionHeading = sections[idx].heading;

    // Upsert the final_updated in resume_ai_tailorings
    const { data: existingTailoring } = await supabaseAdmin
    .from('resume_ai_tailorings')
    .select('*')
    .eq('resume_id', resumeId)
    .eq('job_id', jobId)
    .eq('section_name', sectionHeading)
    .maybeSingle();

  if (existingTailoring) {
    const { error: updateError } = await supabaseAdmin
      .from('resume_ai_tailorings')
      .update({ final_updated: finalUpdated })
      .eq('resume_id', resumeId)
      .eq('job_id', jobId)
      .eq('section_name', sectionHeading)
      .select(); // Select to ensure the update is committed

    if (updateError) {
      await Logger.logBackendError('Resumes', updateError, {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/save-structured',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'DATABASE_ERROR'
      });
      return res.status(400).json({ error: updateError.message });
    }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('resume_ai_tailorings')
        .insert({
          resume_id: resumeId,
          job_id: jobId,
          section_name: sectionHeading,
          final_updated: finalUpdated,

          tailored_suggestions: null,
        });

      if (insertError) {
        await Logger.logBackendError('Resumes', insertError, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/save-structured',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'DATABASE_ERROR'
        });
        return res.status(400).json({ error: insertError.message });
      }
    }

    await Logger.logInfo('Resumes', 'Structured edits saved successfully', {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/save-structured',
      UserID: req.user?.id,
      RelatedTo: resumeId,
      Status: 'SUCCESS'
    });

    return res.json({ success: true });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/tailorings/:jobId/sections/:sectionIndex/save-structured',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

resumeRouter.put('/:resumeId/sections/:index', async (req: AuthenticatedRequest, res) => {
  const transactionId = `update-section-${uuid()}`;
  try {
    const { resumeId, index } = req.params;
    const sectionIndex = Number.parseInt(index, 10);
    if (Number.isNaN(sectionIndex) || sectionIndex < 0) {
      await Logger.logBackendError('Resumes', new Error('Invalid section index'), {
        TransactionID: transactionId,
        Endpoint: 'PUT /resumes/:resumeId/sections/:index',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'VALIDATION_ERROR'
      });
      return res.status(400).json({ error: 'Invalid section index' });
    }

    const { content, rawBody } = req.body as { content: string; rawBody?: unknown };
    if (typeof content !== 'string') {
      await Logger.logBackendError('Resumes', new Error('content must be provided'), {
        TransactionID: transactionId,
        Endpoint: 'PUT /resumes/:resumeId/sections/:index',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'VALIDATION_ERROR'
      });
      return res.status(400).json({ error: 'content must be provided' });
    }

    const { data, error } = await supabaseAdmin
      .from('resumes')
      .select('sections')
      .eq('id', resumeId)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (error || !data) {
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'PUT /resumes/:resumeId/sections/:index',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
      return res.status(404).json({ error: 'Resume not found' });
    }

    const sections = [...(data.sections as ResumeSection[])];
    if (!sections[sectionIndex]) {
      await Logger.logBackendError('Resumes', new Error('Section not found'), {
        TransactionID: transactionId,
        Endpoint: 'PUT /resumes/:resumeId/sections/:index',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
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

  // Get the original raw_body structure
  const originalRawBody = sections[sectionIndex].raw_body;

  // Update the raw_body structure with the new text content
  const updatedRawBody = updateRawBodyWithText(originalRawBody, content);

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
        final_updated: updatedRawBody,  // Store structured data as JSONB
      })
      .eq('resume_id', resumeId)
      .eq('section_name', sectionHeading);

    if (updateError) {
      await Logger.logBackendError('Resumes', updateError, {
        TransactionID: transactionId,
        Endpoint: 'PUT /resumes/:resumeId/sections/:index',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'DATABASE_ERROR'
      });
      return res.status(400).json({ error: updateError.message });
    }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('resume_ai_reviews')
        .insert({
          resume_id: resumeId,
          section_name: sectionHeading,
          final_updated: updatedRawBody,  // Store structured data as JSONB
          raw_data: JSON.stringify(originalRawBody),  // Keep original for reference
          ai_suggestions_html: '',
        });

      if (insertError) {
        await Logger.logBackendError('Resumes', insertError, {
          TransactionID: transactionId,
          Endpoint: 'PUT /resumes/:resumeId/sections/:index',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'DATABASE_ERROR'
        });
        return res.status(400).json({ error: insertError.message });
      }
    }

    return res.json({ section: sections[sectionIndex] });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'PUT /resumes/:resumeId/sections/:index',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:resumeId/sections/:sectionIndex/save-structured
// Save structured edits (auto-save)
resumeRouter.post('/:resumeId/sections/:sectionIndex/save-structured', async (req: AuthenticatedRequest, res) => {
  const transactionId = `save-structured-${uuid()}`;
  try {
    const { resumeId, sectionIndex } = req.params;
    const { finalUpdated } = req.body as { finalUpdated: any };


    const { data, error } = await supabaseAdmin
      .from('resumes')
      .select('sections')
      .eq('id', resumeId)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (error || !data) {
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/sections/:sectionIndex/save-structured',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
      return res.status(404).json({ error: 'Resume not found' });
    }

    const sections = data.sections as ResumeSection[];
    const idx = parseInt(sectionIndex, 10);

    if (idx < 0 || idx >= sections.length) {
      await Logger.logBackendError('Resumes', new Error('Invalid section index'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/sections/:sectionIndex/save-structured',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'VALIDATION_ERROR'
      });
      return res.status(400).json({ error: 'Invalid section index' });
    }

  const sectionHeading = sections[idx].heading;

  // Upsert the final_updated in resume_ai_reviews
  const { data: existingReview } = await supabaseAdmin
    .from('resume_ai_reviews')
    .select('*')
    .eq('resume_id', resumeId)
    .eq('section_name', sectionHeading)
    .maybeSingle();

  if (existingReview) {
    const { error: updateError } = await supabaseAdmin
      .from('resume_ai_reviews')
      .update({ final_updated: finalUpdated })
      .eq('resume_id', resumeId)
      .eq('section_name', sectionHeading)
      .select(); // Select to ensure the update is committed

    if (updateError) {
      await Logger.logBackendError('Resumes', updateError, {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/sections/:sectionIndex/save-structured',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'DATABASE_ERROR'
      });
      return res.status(400).json({ error: updateError.message });
    }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('resume_ai_reviews')
        .insert({
          resume_id: resumeId,
          section_name: sectionHeading,
          final_updated: finalUpdated,
          ai_suggestions_html: '',
          tailored_suggestions: null,
        });

      if (insertError) {
        await Logger.logBackendError('Resumes', insertError, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/sections/:sectionIndex/save-structured',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'DATABASE_ERROR'
        });
        return res.status(400).json({ error: insertError.message });
      }
    }

    await Logger.logInfo('Resumes', 'Structured edits saved successfully', {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/sections/:sectionIndex/save-structured',
      UserID: req.user?.id,
      RelatedTo: resumeId,
      Status: 'SUCCESS'
    });

    return res.json({ success: true });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/sections/:sectionIndex/save-structured',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:resumeId/sections/:sectionIndex/regenerate-bullet
// Regenerate a single bullet point
resumeRouter.post('/:resumeId/sections/:sectionIndex/regenerate-bullet', async (req: AuthenticatedRequest, res) => {
  const transactionId = `regenerate-bullet-${uuid()}`;
  try {
    const { resumeId, sectionIndex } = req.params;
    const { bulletId, bulletText, context } = req.body as {
      bulletId: string;
      bulletText: string;
      context: {
        sectionName: string;
        company?: string;
        title?: string;
        dates?: string;
        otherBullets?: string[];
      };
    };

  if (!bulletText || !context) {
    return res.status(400).json({ error: 'Missing bulletText or context' });
  }

  try {
    const result = await regenerateBulletWithLLM({
      bulletText,
      context,
    });

    await Logger.logInfo('Resumes', 'Bullet regenerated successfully', {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/sections/:sectionIndex/regenerate-bullet',
      UserID: req.user?.id,
      RelatedTo: resumeId,
      Status: 'SUCCESS',
      ResponsePayload: { bulletId, sectionName: context.sectionName }
    });

    return res.json({
      bulletId,
      suggested: result.suggested,
    });
  } catch (err) {
      await Logger.logBackendError('Resumes', err, {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/sections/:sectionIndex/regenerate-bullet',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'LLM_ERROR'
      });
      return res.status(502).json({
        error: 'Failed to regenerate bullet',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/sections/:sectionIndex/regenerate-bullet',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:resumeId/score - Get resume score (generic or job-specific)
// Query param: ?jobId=xxx for job-specific score
resumeRouter.get('/:resumeId/score', async (req: AuthenticatedRequest, res) => {
  const transactionId = `get-score-${uuid()}`;
  try {
    const { resumeId } = req.params;
    const jobId = req.query.jobId as string | undefined;
    const scoreType = jobId ? 'job_specific' : 'generic';

    // Verify resume ownership
    const { data: resume, error: resumeError } = await supabaseAdmin
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (resumeError || !resume) {
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'GET /resumes/:resumeId/score',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
      return res.status(404).json({ error: 'Resume not found' });
    }

    // Check for existing score - handle NULL job_id correctly
    let existingScoreQuery = supabaseAdmin
      .from('resume_scores')
      .select('*')
      .eq('resume_id', resumeId)
      .eq('score_type', scoreType);

    // For NULL job_id (generic scores), use .is() instead of .eq()
    if (jobId) {
      existingScoreQuery = existingScoreQuery.eq('job_id', jobId);
    } else {
      existingScoreQuery = existingScoreQuery.is('job_id', null);
    }

    const { data: existingScore, error: fetchError } = await existingScoreQuery.maybeSingle();

    if (fetchError) {
      await Logger.logBackendError('Resumes', fetchError, {
        TransactionID: transactionId,
        Endpoint: 'GET /resumes/:resumeId/score',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'DATABASE_ERROR',
        Exception: 'Error fetching existing score'
      });
    }

    // Only return existing score - do NOT calculate automatically
    // Calculation should only happen via POST /calculate-score endpoint
    if (existingScore) {
      return res.json({ score: existingScore });
    }

    // No score exists - return 404 instead of calculating
   
    return res.status(404).json({
      error: 'Score not found. Please calculate the score first using POST /calculate-score',
      score: null
    });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'GET /resumes/:resumeId/score',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:resumeId/calculate-score - Force recalculation and update score
// Query param: ?jobId=xxx for job-specific score
resumeRouter.post('/:resumeId/calculate-score', async (req: AuthenticatedRequest, res) => {
  const transactionId = `calculate-score-${uuid()}`;
  try {
    const { resumeId } = req.params;
    const jobId = req.query.jobId as string | undefined;
    const scoreType = jobId ? 'job_specific' : 'generic';

    // Verify resume ownership
    const { data: resume, error: resumeError } = await supabaseAdmin
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (resumeError || !resume) {
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'POST /resumes/:resumeId/calculate-score',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
      return res.status(404).json({ error: 'Resume not found' });
    }
    const { calculateGenericResumeScore } = await import('../services/genericResumeScore');
    const { calculateJobSpecificATSScore } = await import('../services/jobSpecificATSScore');

    let scoreData: any;

    if (jobId) {
      // Job-specific score
      const { data: job } = await supabaseAdmin
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .eq('user_id', req.user!.id)
        .maybeSingle();

      if (!job || !job.job_description) {
        await Logger.logBackendError('Resumes', new Error('Job not found or missing job description'), {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/calculate-score',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'NOT_FOUND'
        });
        return res.status(404).json({ error: 'Job not found or missing job description' });
      }

      if (!job.keywords) {
        await Logger.logBackendError('Resumes', new Error('Job keywords not extracted'), {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/calculate-score',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'VALIDATION_ERROR'
        });
        return res.status(400).json({ error: 'Job keywords not extracted. Please extract keywords first.' });
      }

      // Get existing baseline score (only if score already exists)
      const { data: existingScore } = await supabaseAdmin
        .from('resume_scores')
        .select('comparison_score, overall_score')
        .eq('resume_id', resumeId)
        .eq('job_id', jobId)
        .eq('score_type', 'job_specific')
        .maybeSingle();

      // Preserve existing comparison_score as baseline (original score before any changes)
      // If no baseline exists yet, current score will become the baseline
      const baselineScore = existingScore?.comparison_score;

      // Fetch latest final_updated from resume_ai_tailorings
      // Use a small delay to ensure any pending writes are committed
      await new Promise(resolve => setTimeout(resolve, 100));

      const { data: tailorings, error: tailoringsError } = await supabaseAdmin
        .from('resume_ai_tailorings')
        .select('section_name, final_updated')
        .eq('resume_id', resumeId)
        .eq('job_id', jobId);

      if (tailoringsError) {
        await Logger.logBackendError('Resumes', tailoringsError, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/score',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'DATABASE_ERROR',
          Exception: 'Error fetching final_updated for score calculation (tailorings)'
        });
      }

      const finalUpdatedBySection: Record<string, any> = {};
      tailorings?.forEach(t => {
        // Include final_updated even if it's null (to distinguish from missing sections)
        if (t.final_updated !== null && t.final_updated !== undefined) {
          finalUpdatedBySection[t.section_name] = t.final_updated;
        }
      });

      //console.log(`[Score Calculation] Using final_updated for ${Object.keys(finalUpdatedBySection).length} sections:`, Object.keys(finalUpdatedBySection));

      const score = await calculateJobSpecificATSScore(
        resume,
        job.job_description,
        job.keywords as any,
        finalUpdatedBySection,
        baselineScore
      );

      scoreData = {
        resume_id: resumeId,
        job_id: jobId,
        score_type: 'job_specific',
        overall_score: score.overallScore,
        score_breakdown: score.breakdown,
        suggestions: score.suggestions,
        improvement_areas: score.improvementAreas,
        keyword_coverage: score.keywordCoverage,
        comparison_score: baselineScore !== undefined && baselineScore !== null ? baselineScore : score.overallScore, // Preserve baseline or set current as baseline
      };
    } else {
      // Generic score - fetch latest final_updated data from database
      // Use a small delay to ensure any pending writes are committed
      await new Promise(resolve => setTimeout(resolve, 100));

      const { data: reviews, error: reviewsError } = await supabaseAdmin
        .from('resume_ai_reviews')
        .select('section_name, final_updated')
        .eq('resume_id', resumeId);

      if (reviewsError) {
        await Logger.logBackendError('Resumes', reviewsError, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/score',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'DATABASE_ERROR',
          Exception: 'Error fetching final_updated for score calculation (reviews)'
        });
      }

      const finalUpdatedBySection: Record<string, any> = {};
      reviews?.forEach(r => {
        // Include final_updated even if it's null (to distinguish from missing sections)
        // The calculation functions will handle null appropriately
        if (r.final_updated !== null && r.final_updated !== undefined) {
          finalUpdatedBySection[r.section_name] = r.final_updated;
        }
      });

      //console.log(`[Score Calculation] Using final_updated for ${Object.keys(finalUpdatedBySection).length} sections:`, Object.keys(finalUpdatedBySection));

      const score = await calculateGenericResumeScore(resume, finalUpdatedBySection);

      scoreData = {
        resume_id: resumeId,
        job_id: null,
        score_type: 'generic',
        overall_score: score.overallScore,
        score_breakdown: score.breakdown,
        suggestions: score.suggestions,
        improvement_areas: score.improvementAreas,
        keyword_coverage: null,
        comparison_score: null,
      };
    }

    // Use atomic UPSERT to prevent race conditions and duplicates
    // First check if record exists to handle NULL job_id correctly
    let existingScoreQuery = supabaseAdmin
      .from('resume_scores')
      .select('id')
      .eq('resume_id', resumeId)
      .eq('score_type', scoreType);

    if (jobId) {
      existingScoreQuery = existingScoreQuery.eq('job_id', jobId);
    } else {
      existingScoreQuery = existingScoreQuery.is('job_id', null);
    }

    const { data: existingRecord } = await existingScoreQuery.maybeSingle();

    let storedScore: any;
    if (existingRecord) {
      // Always update existing record with all fields (even if score didn't change)
      // This ensures suggestions, improvement_areas, keyword_coverage are always fresh
      const { data: updatedScore, error: updateError } = await supabaseAdmin
        .from('resume_scores')
        .update({
          overall_score: scoreData.overall_score,
          score_breakdown: scoreData.score_breakdown,
          suggestions: scoreData.suggestions,
          improvement_areas: scoreData.improvement_areas,
          keyword_coverage: scoreData.keyword_coverage,
          comparison_score: scoreData.comparison_score,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRecord.id)
        .select()
        .single();

      if (updateError) {
        await Logger.logBackendError('Resumes', updateError, {
          TransactionID: transactionId,
          Endpoint: 'POST /resumes/:resumeId/score',
          UserID: req.user?.id,
          RelatedTo: resumeId,
          Status: 'DATABASE_ERROR',
          Exception: 'Error updating score'
        });
        return res.status(500).json({
          error: 'Failed to update score',
          detail: updateError.message,
        });
      }
      storedScore = updatedScore;
    } else {
      // Insert new record (using insert to ensure atomicity)
      const { data: insertedScore, error: insertError } = await supabaseAdmin
        .from('resume_scores')
        .insert({
          ...scoreData,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        // If duplicate key error, try to fetch existing record
        if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
          const { data: existingScore } = await existingScoreQuery.maybeSingle();
          if (existingScore) {
            // Return existing score instead of error
            storedScore = existingScore;
          } else {
            await Logger.logBackendError('Resumes', insertError, {
              TransactionID: transactionId,
              Endpoint: 'POST /resumes/:resumeId/score',
              UserID: req.user?.id,
              RelatedTo: resumeId,
              Status: 'DATABASE_ERROR',
              Exception: 'Error inserting score (duplicate but not found)'
            });
            return res.status(500).json({
              error: 'Failed to store score',
              detail: insertError.message,
            });
          }
        } else {
          await Logger.logBackendError('Resumes', insertError, {
            TransactionID: transactionId,
            Endpoint: 'POST /resumes/:resumeId/score',
            UserID: req.user?.id,
            RelatedTo: resumeId,
            Status: 'DATABASE_ERROR',
            Exception: 'Error inserting score'
          });
          return res.status(500).json({
            error: 'Failed to store score',
            detail: insertError.message,
          });
        }
      } else {
        storedScore = insertedScore;
      }
    }

    return res.json({ score: storedScore });
  } catch (err: any) {
    await Logger.logBackendError('Resumes', err, {
      TransactionID: transactionId,
      Endpoint: 'POST /resumes/:resumeId/calculate-score',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'SCORE_ERROR'
    });
    return res.status(500).json({
      error: 'Failed to calculate score',
      detail: err.message,
    });
  }
});

// List resumes
resumeRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const transactionId = `list-resumes-${uuid()}`;
  try {
    const { data, error } = await supabaseAdmin
      .from('resumes')
      .select('id, original_name, sections, created_at')
      .eq('user_id', req.user!.id)
      .eq('removed_by_user', false)
      .order('created_at', { ascending: false });

    if (error) {
      await Logger.logBackendError('Resumes', error, {
        TransactionID: transactionId,
        Endpoint: 'GET /resumes',
        UserID: req.user?.id,
        Status: 'DATABASE_ERROR'
      });
      return res.status(400).json({ error: error.message });
    }
    return res.json({ resumes: data });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'GET /resumes',
      UserID: req.user?.id,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Soft delete resume: set removed_by_user to true
resumeRouter.delete('/:resumeId', async (req: AuthenticatedRequest, res) => {
  const transactionId = `delete-resume-${uuid()}`;
  try {
    const { resumeId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('resumes')
      .update({ removed_by_user: true })
      .eq('id', resumeId)
      .eq('user_id', req.user!.id)
      .select('id')
      .maybeSingle();

    if (error) {
      await Logger.logBackendError('Resumes', error, {
        TransactionID: transactionId,
        Endpoint: 'DELETE /resumes/:resumeId',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'DATABASE_ERROR'
      });
      return res.status(400).json({ error: error.message });
    }
    if (!data) {
      await Logger.logBackendError('Resumes', new Error('Resume not found'), {
        TransactionID: transactionId,
        Endpoint: 'DELETE /resumes/:resumeId',
        UserID: req.user?.id,
        RelatedTo: resumeId,
        Status: 'NOT_FOUND'
      });
      return res.status(404).json({ error: 'Resume not found' });
    }

    await Logger.logInfo('Resumes', 'Resume soft deleted successfully', {
      TransactionID: transactionId,
      Endpoint: 'DELETE /resumes/:resumeId',
      UserID: req.user?.id,
      RelatedTo: resumeId,
      Status: 'SUCCESS'
    });

    return res.json({ success: true });
  } catch (error) {
    await Logger.logBackendError('Resumes', error, {
      TransactionID: transactionId,
      Endpoint: 'DELETE /resumes/:resumeId',
      UserID: req.user?.id,
      RelatedTo: req.params.resumeId,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});
