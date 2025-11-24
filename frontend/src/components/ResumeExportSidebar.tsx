import { useEffect, useMemo, useState } from 'react';

export interface ResumeTemplate {
    id: string;
    name: string;
    description: string;
}

interface Props {
    apiBaseUrl: string;
    token: string;
    resumeId: string;
    selectedJobId?: string;
    hasUnsavedChanges?: boolean;
    onPreviewReady: (url: string) => void;
    onTemplateChange: (template: ResumeTemplate) => void;
}

export function ResumeExportSidebar({
    apiBaseUrl,
    token,
    resumeId,
    selectedJobId,
    hasUnsavedChanges = false,
    onPreviewReady,
    onTemplateChange,
}: Props) {
    const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    const authHeaders = useMemo(
        () => ({
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        }),
        [token]
    );

    // Fetch templates
    useEffect(() => {
        async function loadTemplates() {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`${apiBaseUrl}/templates`, {
                    headers: authHeaders,
                });
                if (!res.ok) {
                    const json = await res.json().catch(() => ({}));
                    throw new Error(json.error || 'Failed to load templates');
                }
                const json = await res.json();
                setTemplates(json.templates ?? []);
            } catch (err: any) {
                setError(err.message || 'Unable to load templates');
            } finally {
                setLoading(false);
            }
        }

        loadTemplates();
    }, [apiBaseUrl, authHeaders]);

    // Select default template
    useEffect(() => {
        if (templates.length > 0 && !selectedTemplate) {
            const defaultTemplate = templates[0];
            setSelectedTemplate(defaultTemplate.id);
            onTemplateChange(defaultTemplate);
        }
    }, [templates, selectedTemplate, onTemplateChange]);

    const handleTemplateClick = (template: ResumeTemplate) => {
        setSelectedTemplate(template.id);
        onTemplateChange(template);
    };

    const buildExportBody = () => ({
        templateId: selectedTemplate,
        jobId: selectedJobId || undefined,
    });

    async function handlePreview() {
        if (!resumeId || !selectedTemplate) {
            setActionError('Please select a template to preview.');
            return;
        }

        setPreviewing(true);
        setActionError(null);
        try {
            const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/export`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(buildExportBody()),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                throw new Error(json.error || 'Failed to generate preview');
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            onPreviewReady(url);
        } catch (err: any) {
            setActionError(err.message || 'Unable to generate preview');
        } finally {
            setPreviewing(false);
        }
    }

    async function handleDownload() {
        if (!resumeId || !selectedTemplate) {
            setActionError('Please select a template to continue.');
            return;
        }

        setDownloading(true);
        setActionError(null);
        try {
            const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/export`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(buildExportBody()),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                throw new Error(json.error || 'Failed to export resume');
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `resume-${selectedTemplate}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            setActionError(err.message || 'Unable to download resume');
        } finally {
            setDownloading(false);
        }
    }

    return (
        <div className="sticky top-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-xl font-semibold text-gray-900">Resume Template</h3>
            <p className="mt-1 text-sm text-gray-500">
                Select a template, preview, and download your resume.
            </p>

            {hasUnsavedChanges && (
                <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    Save all sections before previewing or downloading.
                </div>
            )}

            <div className="mt-6 space-y-3">
                {loading ? (
                    <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500">
                        Loading templates…
                    </div>
                ) : error ? (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
                        {error}
                    </div>
                ) : templates.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500">
                        No templates available.
                    </div>
                ) : (
                    templates.map((template) => {
                        const selected = template.id === selectedTemplate;
                        return (
                            <button
                                key={template.id}
                                onClick={() => handleTemplateClick(template)}
                                className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${selected
                                    ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                                    : 'border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/30'
                                    }`}
                            >
                                <div className="text-sm font-semibold text-gray-900">{template.name}</div>
                                <p className="mt-1 text-xs text-gray-500">{template.description}</p>
                            </button>
                        );
                    })
                )}
            </div>

            {actionError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {actionError}
                </div>
            )}

            <div className="mt-6 flex flex-col gap-3">
                <button
                    onClick={handlePreview}
                    disabled={!selectedTemplate || previewing}
                    className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {previewing ? 'Generating Preview…' : 'Preview PDF'}
                </button>
                <button
                    onClick={handleDownload}
                    disabled={!selectedTemplate || downloading}
                    className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {downloading ? 'Preparing…' : 'Download PDF'}
                </button>
            </div>
        </div>
    );
}
