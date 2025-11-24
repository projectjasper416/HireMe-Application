import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DOMPurify, { Config as DOMPurifyConfig } from 'dompurify';

interface SectionReview {
  heading: string;
  body: string;
  raw_body?: unknown;
  ai_review?: {
    section_name: string;
    ai_suggestions_html: string;
    final_updated?: string | null;
    created_at: string;
  } | null;
}

interface Props {
  apiBaseUrl: string;
  token: string;
}

interface SectionState {
  heading: string;
  body: string;
  raw_body?: unknown;
  reviewHtml: string | null;
  editedHtml: string;
  saving: boolean;
}

import { ResumeExportSidebar, ResumeTemplate } from '../components/ResumeExportSidebar';

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

export function AIReviewPage({ apiBaseUrl, token }: Props) {
  const { resumeId } = useParams<{ resumeId: string }>();
  const navigate = useNavigate();
  const [sections, setSections] = useState<SectionState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewRunning, setReviewRunning] = useState(false);
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



  async function fetchSections() {
    if (!resumeId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/sections`, {
        headers: authHeaders,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to load sections');
      }
      const json = await res.json();
      const mapped: SectionState[] = (json.sections as SectionReview[]).map((section) => {
        const reviewHtml = section.ai_review?.ai_suggestions_html
          ? sanitizeHtml(section.ai_review.ai_suggestions_html)
          : null;

        // If final_updated exists (which means section.body is the updated content), use that.
        // Otherwise, use reviewHtml if available.
        // Otherwise, use original body.
        const hasFinalUpdated = !!section.ai_review?.final_updated;
        const initialHtml = hasFinalUpdated
          ? convertPlainTextToHtml(section.body)
          : (reviewHtml ?? convertPlainTextToHtml(section.body));
        return {
          heading: section.heading,
          body: section.body,
          raw_body: section.raw_body,
          reviewHtml,
          editedHtml: initialHtml,
          saving: false,
        };
      });
      setSections(mapped);
      sectionRefs.current = mapped.map(() => null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);

  async function runReview() {
    if (!resumeId) return;
    setReviewRunning(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/review`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Review failed');
      }
      await fetchSections();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReviewRunning(false);
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
      const plainText = stripRedlineToPlainText(currentHtml);
      const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/sections/${index}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ content: plainText, rawBody: section.raw_body ?? null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to save section');
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
              reviewHtml: item.reviewHtml,
              saving: false,
            }
            : item
        )
      );
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

  function handleAcceptAll(index: number) {
    setSections((prev) =>
      prev.map((item, idx) =>
        idx === index ? { ...item, editedHtml: acceptAllHtml(item.editedHtml) } : item
      )
    );
  }

  function handleRevert(index: number) {
    setSections((prev) =>
      prev.map((item, idx) =>
        idx === index
          ? { ...item, editedHtml: item.reviewHtml ?? convertPlainTextToHtml(item.body) }
          : item
      )
    );
  }

  const isSectionDirty = (section: SectionState) =>
    stripRedlineToPlainText(section.editedHtml) !== section.body;

  const hasUnsavedChanges = sections.some((section) => section.saving || isSectionDirty(section));
  const canDownload = !hasUnsavedChanges && sections.length > 0;



  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        window.URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!resumeId) {
    return <NavigateToHome />;
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-3xl font-bold">AI Resume Review</h2>
          <p className="text-sm text-gray-600">
            AI suggestions appear inline: red (strike-through) words are removals, green insertions
            are additions. Edit freely before saving.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => navigate('/')}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-all hover:border-black/40"
          >
            ← Back to Dashboard
          </button>
          <button
            onClick={runReview}
            disabled={reviewRunning}
            className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
          >
            {reviewRunning ? 'Reviewing…' : 'Run AI Review'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Sections or Preview */}
        <div className="lg:col-span-2">
          {showPreview && previewUrl ? (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-lg">
              {/* Preview Header */}
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
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to AI Review
                </button>
              </div>

              {/* PDF Preview Container */}
              <div className="relative bg-gradient-to-br from-gray-50 to-gray-100 p-8">
                <div className="mx-auto max-w-4xl">
                  {/* Document-like Preview Frame */}
                  <div className="relative">
                    {/* Paper Shadow Effect */}
                    <div className="absolute -inset-4 rounded-lg bg-gradient-to-br from-gray-300 to-gray-400 opacity-30 blur-xl"></div>

                    {/* Paper Container */}
                    <div className="relative rounded-lg border-8 border-white bg-white shadow-2xl">
                      {/* Document Header Bar (like a PDF viewer) */}
                      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className="h-2 w-2 rounded-full bg-red-400"></div>
                            <div className="h-2 w-2 rounded-full bg-yellow-400"></div>
                            <div className="h-2 w-2 rounded-full bg-green-400"></div>
                          </div>
                          <span className="ml-2 text-xs font-medium text-gray-600">
                            {selectedTemplateName} Preview
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const newWindow = window.open(previewUrl, '_blank');
                              if (newWindow) {
                                newWindow.focus();
                              }
                            }}
                            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-200"
                            title="Open in new tab"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* PDF Content - Native Browser PDF Viewer */}
                      <div className="relative overflow-hidden bg-white">
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

                {/* Preview Actions */}

              </div>
            </div>
          ) : loading ? (
            <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
              Loading sections…
            </div>
          ) : sections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
              No sections available. Upload a resume first.
            </div>
          ) : (
            <div className="grid gap-6">
              {sections.map((section, index) => (
                <section key={section.heading} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">{section.heading}</h3>
                      {!section.reviewHtml && (
                        <p className="mt-1 text-sm text-gray-500">
                          Run AI review to generate inline suggestions for this section.
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAcceptAll(index)}
                        disabled={!section.reviewHtml}
                        className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-all hover:border-black/40 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Accept All
                      </button>
                      <button
                        onClick={() => handleRevert(index)}
                        className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-all hover:border-black/40"
                      >
                        Revert
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
                      Tip: Adjust wording directly. Red <del>deletions</del> are removed words; green{' '}
                      <ins>insertions</ins> are AI-suggested replacements.
                    </p>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Template Selection & Preview */}
        <div className="lg:col-span-1">
          <ResumeExportSidebar
            apiBaseUrl={apiBaseUrl}
            token={token}
            resumeId={resumeId}
            hasUnsavedChanges={hasUnsavedChanges}
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
    </div>
  );
}

function NavigateToHome() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/');
  }, [navigate]);
  return null;
}


