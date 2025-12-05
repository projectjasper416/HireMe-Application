/**
 * Update raw_body structure with new text content while preserving EXACT structure
 * This allows maintaining PDF formatting while showing user edits
 */

import { Logger } from '../utils/Logger';
import { v4 as uuid } from 'uuid';

export function updateRawBodyWithText(rawBody: any, newText: string): any {
    if (!rawBody || typeof rawBody !== 'object') {
        // If no structure, return the text as-is
        return {
            summary: [newText],
            entries: [],
        };
    }

    // Log if we encounter an unexpected structure that we can't process
    const hasUnexpectedStructure = 
        !Array.isArray(rawBody) && 
        !rawBody.summary && 
        !rawBody.entries && 
        typeof rawBody === 'object' &&
        Object.keys(rawBody).length > 0;

    if (hasUnexpectedStructure) {
        const transactionId = `rawbody-update-${uuid()}`;
        Logger.logBackendError('RawBodyTransform', new Error('Unexpected raw_body structure in updateRawBodyWithText'), {
            TransactionID: transactionId,
            Endpoint: 'updateRawBodyWithText',
            Status: 'DATA_ERROR',
            Exception: `Unexpected structure: ${JSON.stringify(Object.keys(rawBody)).substring(0, 200)}`
        }).catch(() => {
            // Ignore logging errors
        });
    }

    // Parse the new text into lines
    const lines = newText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // Handle array-based structures (like certifications: [{name, issuer}, ...])
    if (Array.isArray(rawBody)) {
        return updateArrayStructure(rawBody, lines);
    }

    // Handle object-based structures with entries (like Experience)
    if (rawBody.entries && Array.isArray(rawBody.entries) && rawBody.entries.length > 0) {
        return updateEntriesStructure(rawBody, lines);
    }

    // Handle object-based structures with summary only (like Summary, Skills)
    if (rawBody.summary && Array.isArray(rawBody.summary)) {
        return {
            ...rawBody,
            summary: lines,
        };
    }

    // Fallback: preserve structure, update summary
    return {
        ...rawBody,
        summary: lines,
        entries: rawBody.entries || [],
    };
}

/**
 * Update array-based structures (e.g., certifications)
 * Handles both new array structure format and legacy format
 */
function updateArrayStructure(rawBody: any[], lines: string[]): any[] {
    if (rawBody.length === 0) return rawBody;

    const firstItem = rawBody[0];
    const itemCount = rawBody.length;

    // Check if using new array structure format
    const usesArrayStructure = firstItem.fields && Array.isArray(firstItem.fields) && firstItem.fieldOrder;

    if (usesArrayStructure) {
        // New format: preserve structure, update values
        const updated = [];
        let lineIndex = 0;

        for (let i = 0; i < itemCount && lineIndex < lines.length; i++) {
            const originalItem = rawBody[i];
            const fieldOrder = originalItem.fieldOrder || [];
            const fields = originalItem.fields || [];
            const bullets = originalItem.bullets || [];

            // Update fields in order
            const updatedFields = fields.map((field: any) => {
                if (lineIndex < lines.length && field.key !== 'bullets') {
                    const newValue = lines[lineIndex].replace(/^[•\-*]\s*/, '').trim();
                    lineIndex++;
                    return { ...field, value: newValue };
                }
                return field;
            });

            // Update bullets
            let updatedBullets = [...bullets];
            const remainingLines = lines.slice(lineIndex);
            if (remainingLines.length > 0) {
                updatedBullets = remainingLines.map(l => l.replace(/^[•\-*]\s*/, '').trim());
                lineIndex += remainingLines.length;
            }

            updated.push({
                fieldOrder,
                fields: updatedFields,
                bullets: updatedBullets,
            });
        }

        return updated;
    }

    // Legacy format handling
    const keys = Object.keys(firstItem);
    const linesPerItem = Math.floor(lines.length / itemCount);

    const updated = [];
    let lineIndex = 0;

    for (let i = 0; i < itemCount && lineIndex < lines.length; i++) {
        const originalItem = rawBody[i];
        const newItem = { ...originalItem };

        // For certifications/simple structures: just update name and issuer
        if (keys.includes('name') && keys.includes('issuer')) {
            if (lines[lineIndex]) {
                newItem.name = lines[lineIndex].replace(/^[•\-*]\s*/, '').trim();
                lineIndex++;
            }
            if (lines[lineIndex]) {
                newItem.issuer = lines[lineIndex].replace(/^[•\-*]\s*/, '').trim();
                lineIndex++;
            }
        } else {
            // For other array structures, map lines to keys in order
            let keyIndex = 0;
            const itemLines = lines.slice(lineIndex, lineIndex + linesPerItem);

            for (const line of itemLines) {
                if (keyIndex < keys.length) {
                    const key = keys[keyIndex];
                    newItem[key] = line.replace(/^[•\-*]\s*/, '').trim();
                    keyIndex++;
                }
                lineIndex++;
            }
        }

        updated.push(newItem);
    }

    return updated;
}

/**
 * Update object structures with entries (e.g., Experience, Education)
 */
function updateEntriesStructure(rawBody: any, lines: string[]): any {
    const entries = [...rawBody.entries];
    let lineIndex = 0;

    // Update each entry's bullets with new text
    for (let i = 0; i < entries.length && lineIndex < lines.length; i++) {
        const entry = entries[i];
        const bulletCount = entry.bullets?.length || 0;

        if (bulletCount > 0) {
            // Take next N lines for this entry's bullets
            const newBullets = lines.slice(lineIndex, lineIndex + bulletCount);
            entry.bullets = newBullets.map(text => text.replace(/^[•\-*]\s*/, '').trim());
            lineIndex += bulletCount;
        }
    }

    // If there are remaining lines, add them to the last entry or create new entry
    if (lineIndex < lines.length) {
        const remainingLines = lines.slice(lineIndex);
        if (entries.length > 0) {
            const lastEntry = entries[entries.length - 1];
            lastEntry.bullets = [...(lastEntry.bullets || []), ...remainingLines.map(l => l.replace(/^[•\-*]\s*/, '').trim())];
        } else {
            entries.push({
                bullets: remainingLines.map(l => l.replace(/^[•\-*]\s*/, '').trim()),
            });
        }
    }

    return {
        ...rawBody,
        entries,
    };
}

