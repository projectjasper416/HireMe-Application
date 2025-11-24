import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DOMPurify, { Config as DOMPurifyConfig } from 'dompurify';
import { AddJobModal } from '../components/AddJobModal';

interface Job {
    id: string;
    company: string;
    role: string;
    job_description: string;
    keywords?: any;
}

interface TailoringResult {
    section_name: string;
    tailored_html: string;
    original_text: string;
    job_id?: string;
    final_updated?: string | null;
}

interface SectionState {
    heading: string;
    body: string;
    raw_body?: unknown;
    tailoredHtml: string | null;
    editedHtml: string;
    saving: boolean;
    regenerating: boolean;
}

import { ResumeExportSidebar } from '../components/ResumeExportSidebar';

interface Props {
    apiBaseUrl: string;
    token: string;
}

const SANITIZE_CONFIG: DOMPurifyConfig = {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'span', 'div', 'del', 'ins'],
    ALLOWED_ATTR: ['class'],
    FORBID_ATTR: ['style'],
};

function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, SANITIZE_CONFIG) as string;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function convertPlainTextToHtml(text: string): string {
    const lines = text.split(/\r?\n/);
    const html = lines
        .map((line) => (line.trim().length ? `<p>${escapeHtml(line)}</p>` : '<p><br/></p>'))
        .join('');
    return sanitizeHtml(html);
}

function stripRedlineToPlainText(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('del').forEach((node) => node.remove());
    doc.querySelectorAll('ins').forEach((node) => node.replaceWith(node.textContent ?? ''));
    doc.body.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    const blocks = Array.from(doc.body.querySelectorAll('p, div'));
    blocks.forEach((block, idx) => {
        const textContent = block.textContent ?? '';
        const suffix = idx === blocks.length - 1 ? '' : '\n';
        block.replaceWith(doc.createTextNode(textContent + suffix));
    });
    const plain = doc.body.textContent ?? '';
    return plain
        .replace(/\u00A0/g, ' ')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function acceptAllHtml(html: string): string {
    const text = stripRedlineToPlainText(html);
    return convertPlainTextToHtml(text);
}

export function AITailorPage({ apiBaseUrl, token }: Props) {
    const { resumeId } = useParams<{ resumeId: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [sections, setSections] = useState<SectionState[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [selectedJobId, setSelectedJobId] = useState<string>(searchParams.get('jobId') || '');
    const [loading, setLoading] = useState(true);
    const [tailoring, setTailoring] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showAddJobModal, setShowAddJobModal] = useState(false);
    const [selectedTemplateName, setSelectedTemplateName] = useState<string>('Template');
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const sectionRefs = useRef<Array<HTMLDivElement | null>>([]);

    const authHeaders = useMemo(
        () => ({
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        }),
        [token]
    );

    useEffect(() => {
        async function loadData() {
            setLoading(true);
            try {
                // Load Jobs
                const jobsRes = await fetch(`${apiBaseUrl}/jobs`, { headers: authHeaders });
                if (jobsRes.ok) {
                    const jobsJson = await jobsRes.json();
                    setJobs(jobsJson.jobs || []);
                }

                // Load Resume Sections
                if (resumeId) {
                    const sectionsRes = await fetch(`${apiBaseUrl}/resumes/${resumeId}/sections?original=true`, { headers: authHeaders });
                    if (!sectionsRes.ok) throw new Error('Failed to load sections');
                    const sectionsJson = await sectionsRes.json();

                    // Initialize sections without tailoring first
                    const initialSections: SectionState[] = (sectionsJson.sections as any[]).map((s) => ({
                        heading: s.heading,
                        body: s.body,
                        raw_body: s.raw_body,
                        tailoredHtml: null,
                        editedHtml: convertPlainTextToHtml(s.body),
                        saving: false,
                        regenerating: false,
                    }));
                    setSections(initialSections);
                    sectionRefs.current = initialSections.map(() => null);
                }
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        }
        loadData();
        loadData();
    }, [apiBaseUrl, authHeaders, resumeId]);



    // Cleanup preview URL on unmount
    useEffect(() => {
        return () => {
            if (previewUrl) {
                window.URL.revokeObjectURL(previewUrl);
            }
        };
    }, [previewUrl]);

    // Fetch existing tailorings when job is selected
    useEffect(() => {
        if (!resumeId || !selectedJobId) return;

        async function fetchTailorings() {
            try {
                const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/tailorings?jobId=${selectedJobId}`, {
                    headers: authHeaders,
                });
                if (res.ok) {
                    const json = await res.json();
                    const tailorings = json.tailorings as TailoringResult[];

                    setSections((prev) =>
                        prev.map((section) => {
                            const match = tailorings.find((t) => t.section_name === section.heading);
                            if (match) {
                                return {
                                    ...section,
                                    tailoredHtml: sanitizeHtml(match.tailored_html),
                                    editedHtml: sanitizeHtml(match.final_updated || match.tailored_html),
                                    section_name: section.heading, // Enforce original heading
                                };
                            }
                            // Reset to original if no tailoring found for this job
                            return {
                                ...section,
                                section_name: section.heading, // Enforce original heading
                                tailoredHtml: null,
                                editedHtml: convertPlainTextToHtml(section.body),
                                original_text: section.body,
                            };
                        })
                    );
                }
            } catch (err) {
                console.error('Failed to fetch tailorings', err);
            }
        }
        fetchTailorings();
    }, [resumeId, selectedJobId, apiBaseUrl, authHeaders]);

    async function runTailoring() {
        if (!resumeId || !selectedJobId) return;
        setTailoring(true);
        setError(null);
        try {
            const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/tailor`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ jobId: selectedJobId }),
            });

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || 'Tailoring failed');
            }

            const json = await res.json();
            const results = json.tailorings as TailoringResult[];

            setSections((prev) =>
                prev.map((section) => {
                    const match = results.find((t) => t.section_name === section.heading);
                    if (match) {
                        return {
                            ...section,
                            tailoredHtml: sanitizeHtml(match.tailored_html),
                            editedHtml: sanitizeHtml(match.tailored_html),
                        };
                    }
                    return section;
                })
            );
        } catch (err: any) {
            setError(err.message);
        } finally {
            setTailoring(false);
        }
    }

    async function regenerateSection(index: number) {
        if (!resumeId || !selectedJobId) return;

        setSections((prev) =>
            prev.map((section, idx) => (idx === index ? { ...section, regenerating: true } : section))
        );
        setError(null);

        try {
            const section = sections[index];
            const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/tailor`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    jobId: selectedJobId,
                    sectionName: section.heading
                }),
            });

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || 'Regeneration failed');
            }

            const json = await res.json();
            const results = json.tailorings as TailoringResult[];
            const match = results.find((t) => t.section_name === section.heading);

            if (match) {
                setSections((prev) =>
                    prev.map((item, idx) =>
                        idx === index
                            ? {
                                ...item,
                                tailoredHtml: sanitizeHtml(match.tailored_html),
                                editedHtml: sanitizeHtml(match.tailored_html),
                                regenerating: false,
                            }
                            : item
                    )
                );
            } else {
                throw new Error('No suggestion returned');
            }
        } catch (err: any) {
            setError(err.message);
            setSections((prev) =>
                prev.map((section, idx) => (idx === index ? { ...section, regenerating: false } : section))
            );
        }
    }

    async function saveSection(index: number) {
        if (!resumeId) return;
        setSections((prev) =>
            prev.map((section, idx) => (idx === index ? { ...section, saving: true } : section))
        );
        setError(null);
        try {
            const section = sections[index];
            const node = sectionRefs.current[index];
            const currentHtml = node ? sanitizeHtml(node.innerHTML) : section.editedHtml;

            if (selectedJobId) {
                // Save to tailorings (specific to this job)
                // We save the current HTML (preserving diffs if any, or clean text if accepted)
                const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/tailorings`, {
                    method: 'PUT',
                    headers: authHeaders,
                    body: JSON.stringify({
                        jobId: selectedJobId,
                        sectionName: section.heading,
                        tailoredHtml: currentHtml,
                        originalText: section.body,
                    }),
                });

                if (!res.ok) {
                    const json = await res.json();
                    throw new Error(json.error || 'Failed to save tailoring');
                }

                const json = await res.json();
                setSections((prev) =>
                    prev.map((item, idx) =>
                        idx === index
                            ? {
                                ...item,
                                tailoredHtml: sanitizeHtml(json.tailoring.tailored_html),
                                editedHtml: sanitizeHtml(json.tailoring.final_updated || json.tailoring.tailored_html),
                                saving: false,
                            }
                            : item
                    )
                );
            } else {
                // Save to base resume (global)
                const plainText = stripRedlineToPlainText(currentHtml);
                const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/sections/${index}`, {
                    method: 'PUT',
                    headers: authHeaders,
                    body: JSON.stringify({ content: plainText, rawBody: section.raw_body ?? null }),
                });

                if (!res.ok) {
                    throw new Error('Failed to save section');
                }

                const json = await res.json();
                setSections((prev) =>
                    prev.map((item, idx) =>
                        idx === index
                            ? {
                                ...item,
                                body: json.section.body,
                                raw_body: json.section.raw_body,
                                editedHtml: convertPlainTextToHtml(json.section.body),
                                tailoredHtml: null,
                                saving: false,
                            }
                            : item
                    )
                );
            }
        } catch (err: any) {
            setError(err.message);
            setSections((prev) =>
                prev.map((section, idx) => (idx === index ? { ...section, saving: false } : section))
            );
        }
    }

    function updateEditedHtml(index: number, html: string) {
        const sanitized = sanitizeHtml(html);
        setSections((prev) =>
            prev.map((item, idx) => {
                if (idx !== index || item.editedHtml === sanitized) return item;
                return { ...item, editedHtml: sanitized };
            })
        );
    }

    function handleAccept(index: number) {
        setSections((prev) =>
            prev.map((item, idx) =>
                idx === index ? { ...item, editedHtml: acceptAllHtml(item.editedHtml) } : item
            )
        );
    }

    function handleReject(index: number) {
        setSections((prev) =>
            prev.map((item, idx) =>
                idx === index
                    ? { ...item, editedHtml: convertPlainTextToHtml(item.body) } // Revert to original body
                    : item
            )
        );
    }



    if (!resumeId) return null;

    return (
        <div className="grid gap-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                    <h2 className="text-3xl font-bold">AI Resume Tailor</h2>
                    <p className="text-sm text-gray-600">
                        Select a job to tailor your resume for. AI will suggest changes to match the Job Description.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                        onClick={() => navigate('/')}
                        className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-all hover:border-black/40"
                    >
                        ← Back to Dashboard
                    </button>
                </div>
            </div>

            {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <label className="mb-2 block text-sm font-medium text-gray-700">Select Target Job</label>
                        <select
                            value={selectedJobId}
                            onChange={(e) => setSelectedJobId(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                        >
                            <option value="">-- Select a Job --</option>
                            {jobs.map((job) => (
                                <option key={job.id} value={job.id}>
                                    {job.company} - {job.role}
                                </option>
                            ))}
                        </select>
                        <div className="mt-2 text-xs text-gray-500">
                            or{' '}
                            <button
                                onClick={() => setShowAddJobModal(true)}
                                className="text-indigo-600 hover:text-indigo-800 hover:underline"
                            >
                                create a new job
                            </button>
                        </div>
                    </div>
                    <button
                        onClick={runTailoring}
                        disabled={!selectedJobId || tailoring}
                        className="rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 px-6 py-2 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {tailoring ? 'Tailoring...' : 'Tailor Resume'}
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-12">Loading...</div>
            ) : (
                <div className="grid gap-6 lg:grid-cols-3">
                    <div className="lg:col-span-2">
                        {showPreview && previewUrl ? (
                            <div className="rounded-2xl border border-gray-200 bg-white shadow-lg">
                                <div className="flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-4">
                                    <div>
                                        <h3 className="text-xl font-semibold text-gray-900">Resume Preview</h3>
                                        <p className="mt-1 text-sm text-gray-600">
                                            {selectedTemplateName} Preview
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setShowPreview(false)}
                                        className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                        </svg>
                                        Back to Editing
                                    </button>
                                </div>
                                <div className="relative bg-gradient-to-br from-gray-50 to-gray-100 p-8">
                                    <div className="mx-auto max-w-4xl">
                                        <div className="relative rounded-lg border-8 border-white bg-white shadow-2xl overflow-hidden">
                                            <iframe
                                                src={`${previewUrl}#toolbar=1&navpanes=1&scrollbar=1&view=FitH`}
                                                className="h-[900px] w-full border-0"
                                                title="Resume Preview"
                                                style={{ minHeight: '900px' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="grid gap-6">
                                {sections.map((section, index) => (
                                    <section key={section.heading} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                                        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <h3 className="text-xl font-semibold text-gray-900">{section.heading}</h3>
                                                {!section.tailoredHtml && (
                                                    <p className="mt-1 text-sm text-gray-500">
                                                        Select a job and click "Tailor Resume" to see suggestions.
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleAccept(index)}
                                                    disabled={!section.tailoredHtml}
                                                    className="flex items-center gap-1 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 transition-all hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                    title="Accept All Changes"
                                                >
                                                    <span>👍</span> Accept
                                                </button>
                                                <button
                                                    onClick={() => handleReject(index)}
                                                    disabled={!section.tailoredHtml}
                                                    className="flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 transition-all hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                    title="Reject All Changes"
                                                >
                                                    <span>👎</span> Reject
                                                </button>
                                                <button
                                                    onClick={() => saveSection(index)}
                                                    disabled={section.saving}
                                                    className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
                                                >
                                                    {section.saving ? 'Saving…' : 'Save Section'}
                                                </button>
                                            </div>
                                        </header>

                                        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
                                            <div className="mb-2 flex justify-end">
                                                {section.tailoredHtml && (
                                                    <button
                                                        onClick={() => regenerateSection(index)}
                                                        disabled={section.regenerating}
                                                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:underline disabled:opacity-50"
                                                    >
                                                        <span className="text-lg">↻</span> {section.regenerating ? 'Regenerating...' : 'Regenerate with AI'}
                                                    </button>
                                                )}
                                            </div>
                                            <div
                                                className="min-h-[12rem] rounded-xl bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-900 focus-within:ring-2 focus-within:ring-indigo-200"
                                                contentEditable
                                                suppressContentEditableWarning
                                                onInput={(e) => updateEditedHtml(index, e.currentTarget.innerHTML)}
                                                ref={(el) => {
                                                    sectionRefs.current[index] = el;
                                                    if (el && el.innerHTML !== section.editedHtml) {
                                                        el.innerHTML = section.editedHtml;
                                                    }
                                                }}
                                            />
                                            <p className="mt-2 text-xs text-gray-500">
                                                <span className="text-red-600 line-through">Red strike-through</span> = removal,{' '}
                                                <span className="text-green-600 underline">Green underline</span> = addition.
                                            </p>
                                        </div>
                                    </section>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-1">
                        <ResumeExportSidebar
                            apiBaseUrl={apiBaseUrl}
                            token={token}
                            resumeId={resumeId}
                            selectedJobId={selectedJobId}
                            onPreviewReady={(url) => {
                                if (previewUrl) window.URL.revokeObjectURL(previewUrl);
                                setPreviewUrl(url);
                                setShowPreview(true);
                            }}
                            onTemplateChange={(t) => {
                                setSelectedTemplateName(t.name);
                                setShowPreview(false);
                            }}
                        />
                    </div>
                </div>
            )}

            <AddJobModal
                apiBaseUrl={apiBaseUrl}
                token={token}
                isOpen={showAddJobModal}
                onClose={() => setShowAddJobModal(false)}
                onSuccess={async () => {
                    setShowAddJobModal(false);
                    // Reload jobs
                    try {
                        const jobsRes = await fetch(`${apiBaseUrl}/jobs`, { headers: authHeaders });
                        if (jobsRes.ok) {
                            const jobsJson = await jobsRes.json();
                            setJobs(jobsJson.jobs || []);
                            // Optionally select the newest job?
                            // For now just reload list so user can select it
                        }
                    } catch (err) {
                        console.error('Failed to reload jobs', err);
                    }
                }}
            />
        </div>
    );
}
