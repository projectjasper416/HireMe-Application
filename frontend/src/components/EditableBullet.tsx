import React, { useState, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { wordDiff, renderWordDiff } from '../utils/wordDiff';

interface EditableBulletProps {
    bulletId: string;
    original: string;
    suggested: string | null;
    final: string | null;
    isEditing: boolean;
    onEdit: (bulletId: string) => void;
    onSave: (bulletId: string, newText: string) => void;
    onCancel: () => void;
    onRegenerate: (bulletId: string) => void;
    onAccept: (bulletId: string) => void;
    onReject: (bulletId: string) => void;
}

// Helper to strip markdown formatting from text
const stripMarkdown = (text: string): string => {
    if (!text) return text;
    // Remove markdown bold: **text** or __text__
    return text
        .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold**
        .replace(/\*([^*]+)\*/g, '$1')      // *italic* (but not **bold**)
        .replace(/__([^_]+)__/g, '$1')      // __bold__
        .replace(/_([^_]+)_/g, '$1')         // _italic_ (but not __bold__)
        .replace(/~~([^~]+)~~/g, '$1');     // ~~strikethrough~~
};

// Helper to convert any value to string, filtering out null objects
const toString = (value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') {
        // Filter out string representations of null objects
        if (value === 'null' || value === '{}' || value.includes('"original":null,"suggested":null')) {
            return '';
        }
        // Strip markdown formatting
        return stripMarkdown(value);
    }
    if (typeof value === 'object' && value !== null) {
        // Check if it's a null object
        if (value.original === null && value.suggested === null) {
            return '';
        }
        if (value.original === undefined && value.suggested === undefined) {
            return '';
        }
        // If it's an object, stringify it
        const str = JSON.stringify(value, null, 2);
        if (str === '{}' || str.includes('"original":null,"suggested":null')) {
            return '';
        }
        return stripMarkdown(str);
    }
    return stripMarkdown(String(value));
};

export default function EditableBullet({
    bulletId,
    original,
    suggested,
    final,
    isEditing,
    onEdit,
    onSave,
    onCancel,
    onRegenerate,
    onAccept,
    onReject,
}: EditableBulletProps) {
    // Convert to strings
    const originalStr = toString(original);
    const suggestedStr = suggested ? toString(suggested) : null;
    const finalStr = final ? toString(final) : null;

    // Don't render if everything is empty
    if (!originalStr && !suggestedStr && !finalStr) {
        return null;
    }

    const [editText, setEditText] = useState(finalStr || suggestedStr || originalStr);
    const [isHovered, setIsHovered] = useState(false);

    const handleSave = () => {
        onSave(bulletId, editText);
    };

    const handleAccept = () => {
        if (suggestedStr) {
            onAccept(bulletId);
        }
    };

    const handleReject = () => {
        onReject(bulletId);
    };

    // Determine what to display
    // Show suggestion if it exists and is different from both original AND final
    const hasSuggestion = suggestedStr &&
        suggestedStr.trim() !== '' &&
        suggestedStr.trim() !== originalStr.trim() &&
        (!finalStr || suggestedStr.trim() !== finalStr.trim());

    const hasEdit = finalStr !== null && finalStr.trim() !== '';

    // Compute word-level diff for display
    const diffTokens = useMemo(() => {
        if (hasSuggestion && !hasEdit) {
            return wordDiff(originalStr, suggestedStr);
        }
        return null;
    }, [hasSuggestion, hasEdit, originalStr, suggestedStr]);

    // For display when NOT showing diff:
    const displayText = hasEdit ? finalStr : originalStr;

    if (isEditing) {
        return (
            <div className="bullet-editor">
                <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    rows={3}
                    autoFocus
                />
                <div className="flex gap-2 mt-2">
                    <button
                        onClick={handleSave}
                        className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                    >
                        Apply
                    </button>
                    <button
                        onClick={onCancel}
                        className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            className="bullet-item relative group"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="flex items-start gap-2">
                <span className="text-gray-600 mt-1">•</span>
                <div className="flex-1">
                    {hasSuggestion && diffTokens ? (
                        // Show word-level diff: inline changes with red strikethrough and green underline
                        <div className="space-y-2">
                            <div className="leading-relaxed">
                                {renderWordDiff(diffTokens)}
                            </div>
                            <div className="flex gap-2 mt-2">
                                <button
                                    onClick={handleAccept}
                                    className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200"
                                >
                                    Accept
                                </button>
                                <button
                                    onClick={handleReject}
                                    className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                                >
                                    Reject
                                </button>
                                <button
                                    onClick={() => onEdit(bulletId)}
                                    className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
                                >
                                    Edit
                                </button>
                            </div>
                        </div>
                    ) : (
                        // Show plain text (original or edited) - ALWAYS CLICKABLE
                        <div
                            onClick={() => onEdit(bulletId)}
                            className="cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors"
                            style={{ minHeight: '24px' }}
                        >
                            {displayText}
                        </div>
                    )}
                </div>

                {/* Regenerate button (visible on hover) */}
                {isHovered && !isEditing && (
                    <button
                        onClick={() => onRegenerate(bulletId)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        title="Regenerate this bullet"
                    >
                        <Sparkles size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
