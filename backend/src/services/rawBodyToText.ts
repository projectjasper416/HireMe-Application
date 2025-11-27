/**
 * Convert raw_body structure back to plain text
 * Used when sending data to frontend which expects text format
 */

export function rawBodyToText(rawBody: any): string {
    if (!rawBody || typeof rawBody !== 'object') {
        return typeof rawBody === 'string' ? rawBody : '';
    }

    const lines: string[] = [];

    // Handle array-based structures (like certifications)
    if (Array.isArray(rawBody)) {
        for (const item of rawBody) {
            // Add all values from the object
            Object.values(item).forEach(value => {
                if (value) lines.push(String(value));
            });
        }
        return lines.join('\n');
    }

    // Handle simple sections (summary only)
    if (rawBody.summary && Array.isArray(rawBody.summary)) {
        lines.push(...rawBody.summary);
    }

    // Handle complex sections (entries with bullets)
    if (rawBody.entries && Array.isArray(rawBody.entries)) {
        for (const entry of rawBody.entries) {
            // For Experience/Job entries: output in visual order (company, title, dates, location)
            if (entry.company) lines.push(entry.company);
            if (entry.title) lines.push(entry.title);
            if (entry.dates) lines.push(entry.dates);
            if (entry.location) lines.push(entry.location);

            // For Education entries: output in visual order (institution, degree, dates, location, gpa)
            if (entry.institution) lines.push(entry.institution);
            if (entry.degree) lines.push(entry.degree);
            if (!entry.company && entry.dates) lines.push(entry.dates); // Only if not already added above
            if (!entry.company && entry.location) lines.push(entry.location);
            if (entry.gpa) lines.push(entry.gpa);

            // Fallback for other entry types
            if (entry.primary) lines.push(entry.primary);
            if (entry.secondary) lines.push(entry.secondary);
            if (entry.meta) lines.push(entry.meta);

            // Add summary if available
            if (entry.summary && Array.isArray(entry.summary)) {
                lines.push(...entry.summary);
            }

            // Add bullets
            if (entry.bullets && Array.isArray(entry.bullets)) {
                lines.push(...entry.bullets);
            }

            // Add empty line between entries
            lines.push('');
        }
    }

    return lines.filter(Boolean).join('\n');
}
