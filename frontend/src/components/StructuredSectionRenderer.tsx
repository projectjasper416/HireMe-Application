import React, { useState } from 'react';
import EditableBullet from './EditableBullet';
import EditableField from './EditableField';
import { StructuredTailoringState, EntryState } from '../utils/structuredTailoringUtils';

interface StructuredSectionRendererProps {
    section: StructuredTailoringState;
    onUpdateBullet: (bulletId: string, newText: string) => void;
    onUpdateField: (entryId: string, fieldName: string, newText: string) => void;
    onRegenerateBullet: (bulletId: string, context: any) => void;
    onAcceptBullet: (bulletId: string) => void;
    onRejectBullet: (bulletId: string) => void;
    onAcceptField: (entryId: string, fieldName: string) => void;
    onRejectField: (entryId: string, fieldName: string) => void;
}

const extractString = (value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        if (value.suggested) return extractString(value.suggested);
        if (value.original) return extractString(value.original);
        return JSON.stringify(value);
    }
    return String(value);
};

const isNullOrEmpty = (value: any): boolean => {
    if (!value) return true;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return true;
        if (trimmed === 'null') return true;
        if (trimmed === '{}') return true;
        if (trimmed === 'undefined') return true;
        if (trimmed.includes('"original":null')) return true;
        if (trimmed.includes('"suggested":null')) return true;
    }
    return false;
};

export default function StructuredSectionRenderer({
    section,
    onUpdateBullet,
    onUpdateField,
    onRegenerateBullet,
    onAcceptBullet,
    onRejectBullet,
    onAcceptField,
    onRejectField,
}: StructuredSectionRendererProps) {
    const [editingBulletId, setEditingBulletId] = useState<string | null>(null);
    const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

    const handleEditBullet = (bulletId: string) => {
        setEditingBulletId(bulletId);
        setEditingFieldId(null);
    };

    const handleEditField = (fieldId: string) => {
        setEditingFieldId(fieldId);
        setEditingBulletId(null);
    };

    const handleSaveBullet = (bulletId: string, newText: string) => {
        onUpdateBullet(bulletId, newText);
        setEditingBulletId(null);
    };

    const handleSaveField = (fieldId: string, newText: string) => {
        // fieldId format: "entryId:fieldName"
        const [entryId, fieldName] = fieldId.split(':');
        onUpdateField(entryId, fieldName, newText);
        setEditingFieldId(null);
    };

    const handleCancelEdit = () => {
        setEditingBulletId(null);
        setEditingFieldId(null);
    };

    const handleRegenerateBullet = (bulletId: string) => {
        for (const entry of section.entries) {
            const bullet = entry.bullets.find(b => b.id === bulletId);
            if (bullet) {
                const context = {
                    sectionName: section.heading,
                    bulletText: bullet.original,
                    metadata: entry.metadata,
                    otherBullets: entry.bullets
                        .filter(b => b.id !== bulletId)
                        .map(b => b.final || b.suggested || b.original),
                };
                onRegenerateBullet(bulletId, context);
                return;
            }
        }
    };

    const handleAcceptFieldWrapper = (fieldId: string) => {
        const [entryId, fieldName] = fieldId.split(':');
        onAcceptField(entryId, fieldName);
    };

    const handleRejectFieldWrapper = (fieldId: string) => {
        const [entryId, fieldName] = fieldId.split(':');
        onRejectField(entryId, fieldName);
    };

    return (
        <div className="space-y-6">
            {section.entries.map((entry) => (
                <div key={entry.id} className="entry-container">
                    {/* Render metadata fields as EDITABLE */}
                    {Object.keys(entry.metadata).length > 0 && (
                        <div className="entry-metadata mb-3 space-y-1">
                            {(() => {
                                // CRITICAL: Use fieldOrder to preserve exact order from user's uploaded resume
                                // fieldOrder is set by backend based on rawBody structure
                                let fieldOrder: string[];
                                
                                if (entry.fieldOrder && Array.isArray(entry.fieldOrder) && entry.fieldOrder.length > 0) {
                                    // Backend provided fieldOrder - use it EXACTLY as the source of truth
                                    // This order matches what the user uploaded in their resume
                                    const fieldOrderSet = new Set(entry.fieldOrder);
                                    
                                    // Start with fields from fieldOrder (in correct order) that exist in metadata
                                    fieldOrder = entry.fieldOrder.filter((key: string) => entry.metadata[key] !== undefined);
                                    
                                    // Append any fields in metadata that weren't in fieldOrder (shouldn't happen, but handle gracefully)
                                    const additionalFields = Object.keys(entry.metadata).filter(key => !fieldOrderSet.has(key));
                                    if (additionalFields.length > 0) {
                                        fieldOrder = [...fieldOrder, ...additionalFields];
                                    }
                                } else {
                                    // No fieldOrder from backend - fallback to Object.keys (preserves insertion order in modern JS)
                                    fieldOrder = Object.keys(entry.metadata);
                                }
                                
                                return fieldOrder
                                    .filter((key: string) => {
                                        const field = entry.metadata[key];
                                        if (!field) return false;
                                        const displayValue = extractString(field.final || field.suggested || field.original);
                                        return !isNullOrEmpty(displayValue);
                                    })
                                    .map((key: string) => {
                                        const field = entry.metadata[key];
                                        const fieldId = `${entry.id}:${key}`;
                                        const isTitle = key === 'company' || key === 'institution' || key === 'name';
                                        const isSubtitle = key === 'title' || key === 'degree' || key === 'category';
                                        const isDate = key === 'dates' || key === 'date';

                                        const className = isTitle
                                            ? 'font-semibold text-gray-900 text-lg'
                                            : isSubtitle
                                                ? 'text-gray-700 mt-1'
                                                : isDate
                                                    ? 'text-gray-500 text-sm mt-1'
                                                    : 'text-gray-600 text-sm';

                                        return (
                                            <EditableField
                                                key={key}
                                                fieldId={fieldId}
                                                fieldName={key}
                                                original={field.original}
                                                suggested={field.suggested}
                                                final={field.final}
                                                isEditing={editingFieldId === fieldId}
                                                onEdit={handleEditField}
                                                onSave={handleSaveField}
                                                onCancel={handleCancelEdit}
                                                onAccept={handleAcceptFieldWrapper}
                                                onReject={handleRejectFieldWrapper}
                                                className={className}
                                            />
                                        );
                                    });
                            })()}
                        </div>
                    )}

                    {/* Render bullets as EDITABLE */}
                    {entry.bullets.length > 0 && (
                        <div className="entry-bullets space-y-2">
                            {entry.bullets
                                .filter(bullet => {
                                    if (!bullet) return false;
                                    const text = bullet.final || bullet.suggested || bullet.original;
                                    return !isNullOrEmpty(text);
                                })
                                .map((bullet) => (
                                    <EditableBullet
                                        key={bullet.id}
                                        bulletId={bullet.id}
                                        original={bullet.original}
                                        suggested={bullet.suggested}
                                        final={bullet.final}
                                        isEditing={editingBulletId === bullet.id}
                                        onEdit={handleEditBullet}
                                        onSave={handleSaveBullet}
                                        onCancel={handleCancelEdit}
                                        onRegenerate={handleRegenerateBullet}
                                        onAccept={onAcceptBullet}
                                        onReject={onRejectBullet}
                                    />
                                ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
