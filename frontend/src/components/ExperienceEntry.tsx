import React from 'react';
import EditableBullet from './EditableBullet';

interface Bullet {
    id: string;
    original: string;
    suggested: string | null;
    final: string | null;
}

// Helper to safely extract string from potentially nested objects
const extractString = (value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        // Try to extract from nested structure
        if (value.suggested) return extractString(value.suggested);
        if (value.original) return extractString(value.original);
        // Fallback to JSON stringify
        return JSON.stringify(value);
    }
    return String(value);
};

interface ExperienceEntryProps {
    entryId: string;
    company?: { original: string; suggested: string | null; final: string | null };
    title?: { original: string; suggested: string | null; final: string | null };
    dates?: { original: string; suggested: string | null; final: string | null };
    bullets: Bullet[];
    editingBulletId: string | null;
    onEditBullet: (bulletId: string) => void;
    onSaveBullet: (bulletId: string, newText: string) => void;
    onCancelEdit: () => void;
    onRegenerateBullet: (bulletId: string) => void;
    onAcceptBullet: (bulletId: string) => void;
    onRejectBullet: (bulletId: string) => void;
}

export default function ExperienceEntry({
    entryId,
    company,
    title,
    dates,
    bullets,
    editingBulletId,
    onEditBullet,
    onSaveBullet,
    onCancelEdit,
    onRegenerateBullet,
    onAcceptBullet,
    onRejectBullet,
}: ExperienceEntryProps) {
    // Safely extract strings from potentially nested objects
    const displayCompany = company?.final
        ? extractString(company.final)
        : company?.suggested
            ? extractString(company.suggested)
            : company?.original
                ? extractString(company.original)
                : '';

    const displayTitle = title?.final
        ? extractString(title.final)
        : title?.suggested
            ? extractString(title.suggested)
            : title?.original
                ? extractString(title.original)
                : '';

    const displayDates = dates?.final
        ? extractString(dates.final)
        : dates?.suggested
            ? extractString(dates.suggested)
            : dates?.original
                ? extractString(dates.original)
                : '';

    return (
        <div className="experience-entry mb-6">
            {/* Company name */}
            {displayCompany && (
                <div className="font-semibold text-gray-900 text-lg">
                    {displayCompany}
                </div>
            )}

            {/* Title */}
            {displayTitle && (
                <div className="text-gray-700 mt-1">
                    {displayTitle}
                </div>
            )}

            {/* Dates */}
            {displayDates && (
                <div className="text-gray-500 text-sm mt-1">
                    {displayDates}
                </div>
            )}

            {/* Bullets */}
            <div className="mt-3 space-y-2">
                {bullets.map((bullet) => (
                    <EditableBullet
                        key={bullet.id}
                        bulletId={bullet.id}
                        original={bullet.original}
                        suggested={bullet.suggested}
                        final={bullet.final}
                        isEditing={editingBulletId === bullet.id}
                        onEdit={onEditBullet}
                        onSave={onSaveBullet}
                        onCancel={onCancelEdit}
                        onRegenerate={onRegenerateBullet}
                        onAccept={onAcceptBullet}
                        onReject={onRejectBullet}
                    />
                ))}
            </div>
        </div>
    );
}
