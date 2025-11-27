import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';

interface EditableFieldProps {
    fieldId: string;
    fieldName: string;
    original: string;
    suggested: string | null;
    final: string | null;
    isEditing: boolean;
    onEdit: (fieldId: string) => void;
    onSave: (fieldId: string, newText: string) => void;
    onCancel: () => void;
    onAccept: (fieldId: string) => void;
    onReject: (fieldId: string) => void;
    className?: string;
}

// Helper to filter null values
const toString = (value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') {
        if (value === 'null' || value === '{}' || value.includes('"original":null')) {
            return '';
        }
        return value;
    }
    if (typeof value === 'object' && value !== null) {
        if (value.original === null && value.suggested === null) return '';
        const str = JSON.stringify(value, null, 2);
        if (str === '{}' || str.includes('"original":null')) return '';
        return str;
    }
    return String(value);
};

export default function EditableField({
    fieldId,
    fieldName,
    original,
    suggested,
    final,
    isEditing,
    onEdit,
    onSave,
    onCancel,
    onAccept,
    onReject,
    className = '',
}: EditableFieldProps) {
    const originalStr = toString(original);
    const suggestedStr = suggested ? toString(suggested) : null;
    const finalStr = final ? toString(final) : null;

    if (!originalStr && !suggestedStr && !finalStr) {
        return null;
    }

    const [editText, setEditText] = useState(finalStr || suggestedStr || originalStr);
    const [isHovered, setIsHovered] = useState(false);

    const handleSave = () => {
        onSave(fieldId, editText);
    };

    const handleAccept = () => {
        if (suggestedStr) {
            onAccept(fieldId);
        }
    };

    const handleReject = () => {
        onReject(fieldId);
    };

    const hasSuggestion = suggestedStr &&
        suggestedStr.trim() !== '' &&
        suggestedStr.trim() !== originalStr.trim();

    const hasEdit = finalStr !== null && finalStr.trim() !== '';
    const displayText = hasEdit ? finalStr : originalStr;

    if (isEditing) {
        return (
            <div className="field-editor">
                <input
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave();
                        if (e.key === 'Escape') onCancel();
                    }}
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
            className="field-item relative group"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {hasSuggestion && !hasEdit ? (
                // Show diff
                <div className="space-y-1">
                    <div
                        style={{
                            textDecoration: 'line-through',
                            color: '#dc2626',
                            backgroundColor: '#fee2e2',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            display: 'inline-block',
                        }}
                    >
                        {originalStr}
                    </div>
                    <div
                        style={{
                            textDecoration: 'underline',
                            textDecorationColor: '#16a34a',
                            color: '#16a34a',
                            backgroundColor: '#dcfce7',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            display: 'inline-block',
                        }}
                    >
                        {suggestedStr}
                    </div>
                    <div className="flex gap-2 mt-1">
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
                            onClick={() => onEdit(fieldId)}
                            className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
                        >
                            Edit
                        </button>
                    </div>
                </div>
            ) : (
                // Show plain text - clickable
                <div
                    onClick={() => onEdit(fieldId)}
                    className={`cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors ${className}`}
                    style={{ minHeight: '20px', display: 'inline-block' }}
                >
                    {displayText}
                    {isHovered && (
                        <span className="ml-2 text-gray-400 text-xs">✎ click to edit</span>
                    )}
                </div>
            )}
        </div>
    );
}
