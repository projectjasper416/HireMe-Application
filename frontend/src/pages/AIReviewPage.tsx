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
        const initialHtml = reviewHtml ?? convertPlainTextToHtml(section.body);
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

      {loading ? (
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
  );
}

function NavigateToHome() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/');
  }, [navigate]);
  return null;
}


