import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

interface ResumeSummary {
  id: string;
  original_name: string;
  created_at: string;
}

interface Props {
  apiBaseUrl: string;
  token: string;
}

export function ResumeWorkspace({ apiBaseUrl, token }: Props) {
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    [token]
  );

  async function loadResumes() {
    try {
      const res = await fetch(`${apiBaseUrl}/resumes`, { headers: authHeaders });
      if (!res.ok) return;
      const json = await res.json();
      setResumes(json.resumes);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadResumes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          const base64 = result.includes(',') ? result.split(',')[1]! : result;
          resolve(base64);
        } else {
          reject(new Error('Failed to read file.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const originalPdfBase64 = await fileToBase64(file);
      const res = await fetch(`${apiBaseUrl}/resumes`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ fileName: file.name, originalPdfBase64 }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Upload failed');
      }

      const json = await res.json();
      await loadResumes();
      navigate(`/ai-review/${json.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDeleteResume(resumeId: string) {
    if (!confirm('Are you sure you want to remove this resume?')) return;

    try {
      const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to delete resume');
      }

      // Remove from UI immediately
      setResumes((prev) => prev.filter((r) => r.id !== resumeId));
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="grid gap-8">
      <div>
        <h2 className="text-3xl font-bold">Resume Workspace</h2>
        <p className="text-base text-gray-600">
          Upload a resume and let AI craft review-ready, ATS-friendly sections in seconds.
        </p>
      </div>

      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div
          layout
          className="flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <div>
            <h3 className="text-2xl font-semibold">Upload Resume</h3>
            <p className="mt-2 text-sm text-gray-500">
              Supports PDF, DOCX, TXT. We automatically parse sections for AI review.
            </p>
          </div>
          <div className="mt-6">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-3 text-sm font-medium text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : 'Upload Resume'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.doc,.docx,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </motion.div>

        <motion.div
          layout
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-semibold">Your Resumes</h3>
              <p className="mt-1 text-sm text-gray-500">Select a resume to start an AI review.</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {resumes.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500">
                Upload a resume to get started.
              </div>
            )}

            {resumes.map((resume) => (
              <div
                key={resume.id}
                className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 transition-all hover:border-indigo-200 hover:shadow-sm md:flex-row md:items-center md:justify-between"
              >
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">{resume.original_name}</div>
                  <div className="text-xs text-gray-500">
                    Uploaded {new Date(resume.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <button
                    onClick={() => navigate(`/ai-review/${resume.id}`)}
                    className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
                  >
                    AI Review
                  </button>
                  <button
                    onClick={() => navigate(`/ai-tailor/${resume.id}`)}
                    className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-all hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700"
                  >
                    AI Tailor
                  </button>
                  <button
                    onClick={() => handleDeleteResume(resume.id)}
                    className="rounded-xl border border-red-200 px-3 py-2 text-sm text-red-600 transition-all hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                    aria-label="Delete resume"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}


