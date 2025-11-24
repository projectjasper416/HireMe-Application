import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export const STATUS_COLUMNS = ['Interested', 'Applied', 'Interview', 'Offer'];

interface AddJobModalProps {
    apiBaseUrl: string;
    token: string;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function AddJobModal({ apiBaseUrl, token, isOpen, onClose, onSuccess }: AddJobModalProps) {
    const [company, setCompany] = useState('');
    const [role, setRole] = useState('');
    const [jobDescription, setJobDescription] = useState('');
    const [status, setStatus] = useState('Interested');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const authHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!company.trim() || !role.trim()) {
            alert('Company and role are required');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`${apiBaseUrl}/jobs`, {
                method: 'POST',
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
                const json = await res.json();
                throw new Error(json.error || 'Failed to create job');
            }

            // Reset form
            setCompany('');
            setRole('');
            setJobDescription('');
            setStatus('Interested');
            setNotes('');
            onSuccess();
        } catch (err: any) {
            console.error('Error creating job:', err);
            alert(err.message || 'Failed to create job. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl"
                >
                    <div className="mb-6 flex items-center justify-between">
                        <h2 className="text-2xl font-bold">Add New Job</h2>
                        <button
                            onClick={onClose}
                            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                            ✕
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">Company *</label>
                            <input
                                type="text"
                                value={company}
                                onChange={(e) => setCompany(e.target.value)}
                                required
                                className="w-full rounded-xl border border-gray-200 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                placeholder="e.g., Google"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">Role *</label>
                            <input
                                type="text"
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                                required
                                className="w-full rounded-xl border border-gray-200 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                placeholder="e.g., Software Engineer"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">Job Description</label>
                            <textarea
                                value={jobDescription}
                                onChange={(e) => setJobDescription(e.target.value)}
                                rows={4}
                                className="w-full rounded-xl border border-gray-200 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                placeholder="Paste the job description here..."
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                                className="w-full rounded-xl border border-gray-200 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            >
                                {STATUS_COLUMNS.map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">Notes (Optional)</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={3}
                                className="w-full rounded-xl border border-gray-200 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                placeholder="Add any additional notes..."
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {submitting ? 'Adding...' : 'Add Job'}
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
