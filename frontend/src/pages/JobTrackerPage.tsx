import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { AddJobModal, STATUS_COLUMNS } from '../components/AddJobModal';

interface KeywordCategory {
  category: string;
  keywords: string[];
}

interface ExtractedKeywords {
  categories: KeywordCategory[];
}

interface Job {
  id: string;
  company: string;
  role: string;
  job_description?: string;
  status: string;
  notes?: string;
  source_url?: string;
  keywords?: ExtractedKeywords;
  created_at: string;
  updated_at: string;
  tailored_resume_id?: string;
}

interface Props {
  apiBaseUrl: string;
  token: string;
}



export function JobTrackerPage({ apiBaseUrl, token }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [draggedJob, setDraggedJob] = useState<Job | null>(null);
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null);

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  async function loadJobs() {
    setError(null);
    setLoading(true);
    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const res = await fetch(`${apiBaseUrl}/jobs`, {
        headers: authHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = 'Failed to load jobs';
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorMessage;
          if (errorJson.detail) {
            errorMessage += ` (${errorJson.detail})`;
          }
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const json = await res.json();
      setJobs(json.jobs || []);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Request timed out. Please check: 1) Backend server is running, 2) Database connection is working, 3) Check backend console for errors.');
      } else if (err.message) {
        setError(err.message);
      } else {
        setError('Failed to load jobs. Please check your backend server and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getJobsByStatus(status: string): Job[] {
    return jobs.filter((job) => job.status === status);
  }

  function handleDragStart(e: React.DragEvent, job: Job) {
    setDraggedJob(job);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', '');
  }

  function handleDragOver(e: React.DragEvent, status: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDraggedOverColumn(status);
  }

  function handleDragLeave() {
    setDraggedOverColumn(null);
  }

  async function handleDrop(e: React.DragEvent, targetStatus: string) {
    e.preventDefault();
    setDraggedOverColumn(null);

    if (!draggedJob || draggedJob.status === targetStatus) {
      setDraggedJob(null);
      return;
    }

    try {
      const res = await fetch(`${apiBaseUrl}/jobs/${draggedJob.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: targetStatus }),
      });

      if (!res.ok) throw new Error('Failed to update job status');

      const json = await res.json();
      setJobs((prev) => prev.map((job) => (job.id === draggedJob.id ? json.job : job)));
    } catch (err) {
      console.error('Error updating job status:', err);
      alert('Failed to update job status. Please try again.');
    } finally {
      setDraggedJob(null);
    }
  }

  async function handleDeleteJob(jobId: string) {
    if (!confirm('Are you sure you want to delete this job?')) return;

    try {
      const res = await fetch(`${apiBaseUrl}/jobs/${jobId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });

      if (!res.ok) throw new Error('Failed to delete job');

      setJobs((prev) => prev.filter((job) => job.id !== jobId));
      if (selectedJob?.id === jobId) {
        setSelectedJob(null);
      }
    } catch (err) {
      console.error('Error deleting job:', err);
      alert('Failed to delete job. Please try again.');
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-gray-600 mb-2">Loading jobs...</div>
          <div className="text-sm text-gray-400">This may take a moment</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <h2 className="mb-2 text-xl font-semibold text-red-900">Error Loading Jobs</h2>
          <p className="mb-4 text-sm text-red-700">{error}</p>
          <button
            onClick={loadJobs}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">Job Tracker</h1>
            <p className="mt-2 text-base text-gray-600">Manage your job applications in one place</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-3 text-sm font-medium text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg"
          >
            + Add Job
          </button>
        </div>

        {/* Kanban Board */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {STATUS_COLUMNS.map((status) => {
            const columnJobs = getJobsByStatus(status);
            const isDraggedOver = draggedOverColumn === status;

            return (
              <div
                key={status}
                className={`rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-4 transition-all ${isDraggedOver ? 'border-blue-400 bg-blue-50' : ''
                  }`}
                onDragOver={(e) => handleDragOver(e, status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, status)}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">{status}</h2>
                  <span className="rounded-full bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700">
                    {columnJobs.length}
                  </span>
                </div>

                <div className="space-y-3">
                  {columnJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      onDragStart={handleDragStart}
                      onClick={() => setSelectedJob(job)}
                      onDelete={handleDeleteJob}
                      isDragging={draggedJob?.id === job.id}
                    />
                  ))}
                  {columnJobs.length === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
                      No jobs
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Job Modal */}
      <AddJobModal
        apiBaseUrl={apiBaseUrl}
        token={token}
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => {
          setShowAddModal(false);
          loadJobs();
        }}
      />

      {/* Job Details Modal */}
      <JobDetailsModal
        job={selectedJob}
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        apiBaseUrl={apiBaseUrl}
        token={token}
        onUpdate={loadJobs}
        onDelete={handleDeleteJob}
      />
    </div>
  );
}

interface JobCardProps {
  job: Job;
  onDragStart: (e: React.DragEvent, job: Job) => void;
  onClick: () => void;
  onDelete: (jobId: string) => void;
  isDragging: boolean;
}

function JobCard({ job, onDragStart, onClick, onDelete, isDragging }: JobCardProps) {
  const navigate = useNavigate();

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, job)}
      onClick={onClick}
      className={`cursor-move rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:scale-[1.02] hover:shadow-md ${isDragging ? 'opacity-50' : ''
        }`}
    >
      <div className="mb-2">
        <h3 className="font-semibold text-gray-900">{job.company}</h3>
        <p className="text-sm text-gray-600">{job.role}</p>
      </div>
      {job.job_description && (
        <p className="line-clamp-2 text-xs text-gray-500">{job.job_description.substring(0, 100)}...</p>
      )}
      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span>{new Date(job.created_at).toLocaleDateString()}</span>
        <div className="flex gap-2">
          {job.tailored_resume_id && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/ai-tailor/${job.tailored_resume_id}?jobId=${job.id}`);
              }}
              className="rounded px-2 py-1 text-purple-600 hover:bg-purple-50"
              title="View Tailored Resume"
            >
              Tailored Resume
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(job.id);
            }}
            className="rounded px-2 py-1 text-red-500 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}



interface JobDetailsModalProps {
  job: Job | null;
  isOpen: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  token: string;
  onUpdate: () => void;
  onDelete: (jobId: string) => void;
}

function JobDetailsModal({ job, isOpen, onClose, apiBaseUrl, token, onUpdate, onDelete }: JobDetailsModalProps) {
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [status, setStatus] = useState('Interested');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<ExtractedKeywords | null>(null);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [keywordsError, setKeywordsError] = useState<string | null>(null);

  // Track if we've already initiated keyword extraction for this job to prevent duplicate calls
  const extractedJobIdRef = useRef<string | null>(null);
  const isExtractingRef = useRef<boolean>(false);
  const hasAutoExtractedRef = useRef<boolean>(false);

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }), [token]);

  const fetchKeywords = useCallback(async () => {
    if (!job || !job.job_description || job.job_description.trim().length === 0) {
      return;
    }

    // Prevent multiple simultaneous calls
    if (isExtractingRef.current) {
      console.log('Keyword extraction already in progress, skipping...');
      return;
    }

    // Mark that we're extracting for this job
    isExtractingRef.current = true;
    extractedJobIdRef.current = job.id;
    setLoadingKeywords(true);
    setKeywordsError(null);

    try {
      const res = await fetch(`${apiBaseUrl}/jobs/${job.id}/keywords`, {
        headers: authHeaders,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Failed to extract keywords');
      }

      const data = await res.json();
      setKeywords(data);

      // Mark that we've successfully extracted keywords for this job
      // This prevents re-extraction even if the job object changes
      extractedJobIdRef.current = job.id;
      hasAutoExtractedRef.current = true;

      // Don't call onUpdate() immediately - it causes the job object reference to change
      // which retriggers the useEffect. Keywords are already stored in DB and will be
      // loaded next time the modal opens. Only refresh when modal closes or user saves.
    } catch (err: any) {
      console.error('Error fetching keywords:', err);
      setKeywordsError(err.message || 'Failed to extract keywords. Please try again.');
      // Only reset on error if it's a real error (not just a retry)
      // Keep the ref set to prevent infinite retries
    } finally {
      setLoadingKeywords(false);
      isExtractingRef.current = false;
    }
  }, [job, apiBaseUrl, authHeaders]);

  // Save function for manual save
  const saveChanges = useCallback(async () => {
    if (!job) return false;

    if (!company.trim() || !role.trim()) {
      setError('Company and role are required');
      return false;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBaseUrl}/jobs/${job.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          company: company.trim(),
          role: role.trim(),
          job_description: jobDescription.trim() || null,
          status,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Failed to update job');
      }

      // Refresh jobs list to get updated data
      await onUpdate();
      onClose();

      return true;
    } catch (err: any) {
      console.error('Error updating job:', err);
      const errorMessage = err.message || 'Failed to update job. Please try again.';
      setError(errorMessage);
      return false;
    } finally {
      setSaving(false);
    }
  }, [job, company, role, jobDescription, status, notes, apiBaseUrl, authHeaders, onUpdate, onClose]);

  useEffect(() => {
    if (!job || !isOpen) {
      // Reset when modal closes
      // Don't reset extraction refs here - keep them to prevent re-extraction
      return;
    }

    const initialCompany = job.company || '';
    const initialRole = job.role || '';
    const initialJobDescription = job.job_description || '';
    const initialStatus = job.status || 'Interested';
    const initialNotes = job.notes || '';

    setCompany(initialCompany);
    setRole(initialRole);
    setJobDescription(initialJobDescription);
    setStatus(initialStatus);
    setNotes(initialNotes);
    setError(null);
    setKeywordsError(null);

    // Check if this is a different job ID than we've seen before
    const isDifferentJob = extractedJobIdRef.current !== job.id;

    // Load stored keywords if they exist
    if (job.keywords && job.keywords.categories && job.keywords.categories.length > 0) {
      setKeywords(job.keywords);
      // Mark that we have keywords for this job ID - prevent future extractions
      if (isDifferentJob) {
        extractedJobIdRef.current = job.id;
        hasAutoExtractedRef.current = true; // We have keywords, so mark as extracted
      }
      isExtractingRef.current = false;
    } else {
      setKeywords(null);
      // Only auto-extract ONCE when modal first opens for this specific job ID:
      // Conditions:
      // 1. This is a different job ID than we've processed before
      // 2. Job description exists
      // 3. We're not currently extracting
      // 4. Modal is open
      // 5. We haven't already extracted for this job ID
      const hasJobDescription = job.job_description && job.job_description.trim().length > 0;
      const shouldExtract = isDifferentJob &&
        hasJobDescription &&
        !isExtractingRef.current &&
        !hasAutoExtractedRef.current;

      if (shouldExtract) {
        // Mark that we're about to extract for this job ID BEFORE calling fetchKeywords
        // This prevents re-triggering if the effect runs again
        extractedJobIdRef.current = job.id;
        hasAutoExtractedRef.current = true;
        fetchKeywords();
      } else if (!isDifferentJob) {
        // Same job ID - don't extract again, just keep current state
        // This handles the case when job object updates but ID is the same
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, isOpen, fetchKeywords]); // Depend on job.id and isOpen


  if (!isOpen || !job) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-2xl max-h-[90vh] rounded-2xl border border-gray-200 bg-white shadow-xl flex flex-col"
        >
          <div className="p-6 pb-4 flex-shrink-0 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-gray-900">Edit Job</h2>
                <p className="text-base text-gray-600 mt-1">Update job details</p>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 flex-shrink-0"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6 flex-1 overflow-y-auto min-h-0">
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Status *</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
              >
                {STATUS_COLUMNS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Company *</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="Enter company name"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Role *</label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="Enter job role"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Job Description</label>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={8}
                className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                placeholder="Enter job description..."
              />
            </div>

            {jobDescription && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">Keywords (ATS Optimized)</label>
                  <button
                    onClick={() => {
                      // Only reset extraction flag to allow manual refresh
                      // Keep the job ID ref to prevent auto-extraction after refresh
                      hasAutoExtractedRef.current = false;
                      fetchKeywords();
                    }}
                    disabled={loadingKeywords}
                    className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                  >
                    {loadingKeywords ? 'Extracting...' : 'Refresh Keywords'}
                  </button>
                </div>

                {loadingKeywords && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-8 text-center">
                    <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-gray-300 border-r-gray-600"></div>
                    <p className="mt-2 text-xs text-gray-600">Extracting ATS-friendly keywords...</p>
                  </div>
                )}

                {keywordsError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {keywordsError}
                  </div>
                )}

                {keywords && keywords.categories.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4 space-y-4">
                    {keywords.categories.map((category, idx) => (
                      <div key={idx} className="bg-white rounded-lg p-4 shadow-sm">
                        <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                          {category.category}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {category.keywords.map((keyword, kidx) => (
                            <span
                              key={kidx}
                              className="inline-flex items-center px-3 py-1 rounded-lg bg-blue-100 text-blue-800 text-xs font-medium border border-blue-200"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-gray-600 italic mt-2">
                      💡 These keywords are optimized for ATS systems. Include them in your resume to boost your match score.
                    </p>
                  </div>
                )}

                {!loadingKeywords && !keywords && !keywordsError && (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-center">
                    <p className="text-xs text-gray-500">Click "Refresh Keywords" to extract ATS-friendly keywords</p>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                placeholder="Add any additional notes..."
              />
            </div>

            {job.source_url && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Source URL</label>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <a
                    href={job.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline break-all"
                  >
                    {job.source_url}
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-200 flex-shrink-0 bg-gray-50">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
              <span>Created: {new Date(job.created_at).toLocaleString()}</span>
              {job.updated_at !== job.created_at && (
                <span>• Updated: {new Date(job.updated_at).toLocaleString()}</span>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to delete this job?')) {
                    onDelete(job.id);
                    onClose();
                  }
                }}
                className="flex-1 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-50"
              >
                Delete
              </button>
              <button
                onClick={onClose}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveChanges}
                disabled={saving || !company.trim() || !role.trim()}
                className="flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

