import { Router, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { extractKeywordsFromJobDescription } from '../services/extractKeywords';

const jobsRouter = Router();

// PRD 6.4.2 MVP Scope: Job Tracker endpoints
// TDD 4.3 Job Management Endpoints

// POST /jobs/ – Create job entry
jobsRouter.post('/', requireAuth(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { company, role, job_description, status = 'Interested', notes, source_url } = req.body;
    const userId = req.user!.id;

    if (!company || !role) {
      return res.status(400).json({ error: 'Company and role are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('jobs')
      .insert({
        user_id: userId,
        company: company.trim(),
        role: role.trim(),
        job_description: job_description?.trim() || null,
        status: status || 'Interested',
        notes: notes?.trim() || null,
        source_url: source_url?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating job:', error);
      return res.status(500).json({ error: 'Failed to create job entry' });
    }

    res.status(201).json({ job: data });
  } catch (err: any) {
    console.error('Error in POST /jobs:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /jobs/ – List user jobs
jobsRouter.get('/', requireAuth(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabaseAdmin
      .from('jobs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      // Check if table doesn't exist
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return res.status(500).json({
          error: 'Database table not found. Please run the migration: docs/sql/job_tracker.sql',
          detail: error.message,
        });
      }
      return res.status(500).json({ error: 'Failed to fetch jobs', detail: error.message });
    }

    // Fetch tailoring info for these jobs
    // We want to know if there is a tailored resume for each job.
    // We can do this by querying resume_ai_tailorings where job_id is in the list of job IDs.
    const jobIds = (data || []).map(j => j.id);
    let tailoringsMap: Record<string, string> = {};

    if (jobIds.length > 0) {
      const { data: tailorings, error: tailoringsError } = await supabaseAdmin
        .from('resume_ai_tailorings')
        .select('job_id, resume_id')
        .in('job_id', jobIds);

      if (!tailoringsError && tailorings) {
        // Map job_id -> resume_id (taking the first one found if multiple, though usually one resume per job makes sense or most recent)
        tailorings.forEach(t => {
          if (t.job_id) tailoringsMap[t.job_id] = t.resume_id;
        });
      }
    }

    const jobsWithTailoring = (data || []).map(job => ({
      ...job,
      tailored_resume_id: tailoringsMap[job.id] || null
    }));

    res.json({ jobs: jobsWithTailoring });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// PATCH /jobs/:id – Update status (drag-and-drop) or other fields
jobsRouter.patch('/:id', requireAuth(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { company, role, job_description, status, notes, source_url } = req.body;

    // First verify the job belongs to the user
    const { data: existingJob, error: fetchError } = await supabaseAdmin
      .from('jobs')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingJob) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (company !== undefined) updateData.company = company.trim();
    if (role !== undefined) updateData.role = role.trim();
    if (job_description !== undefined) updateData.job_description = job_description?.trim() || null;
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes?.trim() || null;
    if (source_url !== undefined) updateData.source_url = source_url?.trim() || null;

    const { data, error } = await supabaseAdmin
      .from('jobs')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating job:', error);
      return res.status(500).json({ error: 'Failed to update job' });
    }

    res.json({ job: data });
  } catch (err: any) {
    console.error('Error in PATCH /jobs/:id:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// DELETE /jobs/:id – Remove job
jobsRouter.delete('/:id', requireAuth(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // First verify the job belongs to the user
    const { data: existingJob, error: fetchError } = await supabaseAdmin
      .from('jobs')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingJob) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const { error } = await supabaseAdmin.from('jobs').delete().eq('id', id).eq('user_id', userId);

    if (error) {
      console.error('Error deleting job:', error);
      return res.status(500).json({ error: 'Failed to delete job' });
    }

    res.status(204).send();
  } catch (err: any) {
    console.error('Error in DELETE /jobs/:id:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /jobs/:id/keywords – Extract keywords from job description and store them
jobsRouter.get('/:id/keywords', requireAuth(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // First verify the job belongs to the user and get job description
    const { data: job, error: fetchError } = await supabaseAdmin
      .from('jobs')
      .select('id, user_id, job_description')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!job.job_description || job.job_description.trim().length === 0) {
      return res.status(400).json({ error: 'Job description is required to extract keywords' });
    }

    try {
      const keywords = await extractKeywordsFromJobDescription(job.job_description);

      // Store keywords in the database
      const { error: updateError } = await supabaseAdmin
        .from('jobs')
        .update({
          keywords: keywords,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error storing keywords:', updateError);
        // Still return keywords even if storage fails
      }

      res.json(keywords);
    } catch (err: any) {
      console.error('Error extracting keywords:', err);
      return res.status(500).json({
        error: 'Failed to extract keywords',
        detail: err.message || 'LLM keywords extraction failed',
      });
    }
  } catch (err: any) {
    console.error('Error in GET /jobs/:id/keywords:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

export { jobsRouter };

