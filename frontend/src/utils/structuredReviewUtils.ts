// Utility to parse and handle structured review data

/**
 * Strip markdown formatting from text (e.g., **bold**, *italic*, etc.)
 */
function stripMarkdown(text: string | null | undefined): string {
    if (!text || typeof text !== 'string') return text || '';
    // Remove markdown bold: **text** or __text__
    return text
        .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold**
        .replace(/\*([^*]+)\*/g, '$1')      // *italic* (but not **bold**)
        .replace(/__([^_]+)__/g, '$1')      // __bold__
        .replace(/_([^_]+)_/g, '$1')        // _italic_ (but not __bold__)
        .replace(/~~([^~]+)~~/g, '$1');     // ~~strikethrough~~
}

export interface BulletState {
    id: string;
    original: string;
    suggested: string | null;
    final: string | null;
}

export interface EntryState {
    id: string;
    metadata: Record<string, { original: string; suggested: string | null; final: string | null }>;
    bullets: BulletState[];
    fieldOrder?: string[]; // Preserve field order from backend
}

export interface StructuredSectionState {
    heading: string;
    type: 'summary' | 'experience' | 'education' | 'skills' | 'other';
    isStructured: boolean;
    entries: EntryState[];
}

/**
 * Parse AI suggestions from backend
 */
export function parseAISuggestions(ai_suggestions_html: string | null): StructuredSectionState | null {
    if (!ai_suggestions_html) return null;

    try {
        const parsed = JSON.parse(ai_suggestions_html);
        console.log('[parseAISuggestions] Parsed JSON:', parsed);

        if (parsed.type && parsed.entries) {
            const result: StructuredSectionState = {
                heading: parsed.sectionName,
                type: parsed.type,
                isStructured: true,
                entries: parsed.entries.map((e: any) => {
                    const entry: EntryState = {
                        id: e.id,
                        metadata: {},
                        bullets: [],
                    };

                    // Extract fieldOrder if available
                    let fieldOrder: string[] = e.fieldOrder || [];
                    const allMetadataKeys: string[] = [];

                    // Collect all metadata fields
                    for (const [key, value] of Object.entries(e)) {
                        if (key !== 'id' && key !== 'bullets' && key !== 'fieldOrder' && typeof value === 'object' && value !== null) {
                            allMetadataKeys.push(key);
                        }
                    }

                    // Use fieldOrder if provided, otherwise use object key order
                    if (fieldOrder.length === 0) {
                        fieldOrder = allMetadataKeys;
                    }

                    // Extract metadata fields in order
                    for (const key of fieldOrder) {
                        const value = e[key];
                        if (value && typeof value === 'object' && value !== null) {
                            const field = value as any;
                            entry.metadata[key] = {
                                original: stripMarkdown(field.original || ''),
                                suggested: field.suggested ? stripMarkdown(field.suggested) : null,
                                final: null,
                            };
                        }
                    }

                    // Add any remaining fields
                    for (const key of allMetadataKeys) {
                        if (!fieldOrder.includes(key)) {
                            const value = e[key];
                            if (value && typeof value === 'object' && value !== null) {
                                const field = value as any;
                                entry.metadata[key] = {
                                    original: stripMarkdown(field.original || ''),
                                    suggested: field.suggested ? stripMarkdown(field.suggested) : null,
                                    final: null,
                                };
                                fieldOrder.push(key);
                            }
                        }
                    }

                    entry.fieldOrder = fieldOrder;

                    // Extract bullets
                    if (e.bullets && Array.isArray(e.bullets)) {
                        entry.bullets = e.bullets.map((b: any) => ({
                            id: b.id,
                            original: stripMarkdown(b.original || ''),
                            suggested: b.suggested ? stripMarkdown(b.suggested) : null,
                            final: null,
                        }));
                    }

                    return entry;
                }),
            };

            console.log('[parseAISuggestions] Returning structured data:', result);
            return result;
        }
    } catch (e) {
        console.error('[parseAISuggestions] Failed to parse JSON:', e);
    }

    return null;
}

/**
 * Apply final_updated values to structured review state
 * IMPORTANT: Only apply final values where they exist, preserve suggestions for unchanged items
 */
export function applyFinalUpdated(section: StructuredSectionState, finalUpdated: any): StructuredSectionState {
    if (!finalUpdated || !Array.isArray(finalUpdated)) return section;

    return {
        ...section,
        entries: section.entries.map((entry, idx) => {
            const savedEntry = finalUpdated[idx];
            if (!savedEntry) return entry;

            // Check if using new array structure format
            const isArrayStructure = savedEntry.fields && Array.isArray(savedEntry.fields);
            const savedFieldMap = new Map<string, any>();
            
            if (isArrayStructure) {
                // New format: extract fields from array structure
                for (const field of savedEntry.fields) {
                    savedFieldMap.set(field.key, field.value);
                }
            } else {
                // Legacy format: extract from object keys
                for (const [key, value] of Object.entries(savedEntry)) {
                    if (key !== 'bullets' && key !== 'fields' && key !== 'fieldOrder') {
                        savedFieldMap.set(key, value);
                    }
                }
            }

            // Apply saved metadata finals ONLY where they differ from original
            const updatedMetadata = { ...entry.metadata };
            for (const [key, field] of Object.entries(entry.metadata)) {
                const savedValue = savedFieldMap.get(key);
                if (savedValue !== undefined && typeof savedValue === 'string') {
                    // Only set final if the saved value is different from original
                    if (savedValue !== field.original) {
                        updatedMetadata[key] = {
                            ...field,
                            final: savedValue,
                            suggested: null, // Clear suggestion only when final is applied
                        };
                    }
                    // If saved value equals original, keep the suggestion intact
                }
            }

            // Apply saved bullet finals ONLY where they differ from original
            const savedBullets = savedEntry.bullets;
            const updatedBullets = entry.bullets.map((bullet, bulletIdx) => {
                if (savedBullets && savedBullets[bulletIdx] !== undefined) {
                    const savedValue = savedBullets[bulletIdx];
                    // Only set final if the saved value is different from original
                    if (savedValue !== bullet.original) {
                        return {
                            ...bullet,
                            final: savedValue,
                            suggested: null, // Clear suggestion only when final is applied
                        };
                    }
                    // If saved value equals original, keep the suggestion intact
                }
                return bullet;
            });

            // Preserve fieldOrder from saved entry if available
            const fieldOrder = isArrayStructure && savedEntry.fieldOrder 
                ? savedEntry.fieldOrder 
                : entry.fieldOrder;

            return {
                ...entry,
                metadata: updatedMetadata,
                bullets: updatedBullets,
                fieldOrder,
            };
        }),
    };
}

/**
 * Serialize structured review to JSONB format for database
 * Uses array structure to preserve field order
 */
export function serializeToFinalUpdated(section: StructuredSectionState): any[] {
    return section.entries.map(entry => {
        // Use array structure to preserve field order
        const fieldOrder: string[] = entry.fieldOrder || [];
        const fields: Array<{key: string, value: any}> = [];

        // Serialize metadata fields in order
        for (const key of fieldOrder) {
            const field = entry.metadata[key];
            if (field) {
                const value = field.final || field.suggested || field.original;
                if (value !== undefined && value !== null) {
                    fields.push({ key, value });
                }
            }
        }

        // Add any remaining fields not in fieldOrder
        for (const [key, field] of Object.entries(entry.metadata)) {
            if (!fieldOrder.includes(key)) {
                const value = field.final || field.suggested || field.original;
                if (value !== undefined && value !== null) {
                    fields.push({ key, value });
                    fieldOrder.push(key);
                }
            }
        }

        // Serialize bullets
        const bullets = entry.bullets.map(bullet =>
            bullet.final || bullet.original
        );

        return {
            fieldOrder,
            fields,
            bullets,
        };
    });
}

/**
 * Check if a section has any suggestions
 */
export function hasSuggestions(section: StructuredSectionState | null): boolean {
    if (!section) return false;

    return section.entries.some(entry => {
        const metadataHasSuggestion = Object.values(entry.metadata).some(
            field => field.suggested && field.suggested !== field.original
        );
        const bulletHasSuggestion = entry.bullets.some(
            b => b.suggested && b.suggested !== b.original
        );
        return metadataHasSuggestion || bulletHasSuggestion;
    });
}

// ===== BULLET OPERATIONS =====

export function acceptBullet(section: StructuredSectionState, bulletId: string): StructuredSectionState {
    return {
        ...section,
        entries: section.entries.map(entry => ({
            ...entry,
            bullets: entry.bullets.map(b =>
                b.id === bulletId && b.suggested
                    ? { ...b, final: stripMarkdown(b.suggested), suggested: null }
                    : b
            ),
        })),
    };
}

export function rejectBullet(section: StructuredSectionState, bulletId: string): StructuredSectionState {
    return {
        ...section,
        entries: section.entries.map(entry => ({
            ...entry,
            bullets: entry.bullets.map(b =>
                b.id === bulletId ? { ...b, suggested: null } : b
            ),
        })),
    };
}

export function updateBullet(section: StructuredSectionState, bulletId: string, newText: string): StructuredSectionState {
    return {
        ...section,
        entries: section.entries.map(entry => ({
            ...entry,
            bullets: entry.bullets.map(b =>
                b.id === bulletId ? { ...b, final: stripMarkdown(newText), suggested: null } : b
            ),
        })),
    };
}

export function updateBulletSuggestion(section: StructuredSectionState, bulletId: string, suggested: string): StructuredSectionState {
    return {
        ...section,
        entries: section.entries.map(entry => ({
            ...entry,
            bullets: entry.bullets.map(b =>
                b.id === bulletId ? { ...b, suggested: stripMarkdown(suggested) } : b
            ),
        })),
    };
}

// ===== FIELD OPERATIONS =====

export function acceptField(section: StructuredSectionState, entryId: string, fieldName: string): StructuredSectionState {
    return {
        ...section,
        entries: section.entries.map(entry => {
            if (entry.id !== entryId) return entry;
            const field = entry.metadata[fieldName];
            if (!field || !field.suggested) return entry;

            return {
                ...entry,
                metadata: {
                    ...entry.metadata,
                    [fieldName]: {
                        ...field,
                        final: stripMarkdown(field.suggested),
                        suggested: null,
                    },
                },
            };
        }),
    };
}

export function rejectField(section: StructuredSectionState, entryId: string, fieldName: string): StructuredSectionState {
    return {
        ...section,
        entries: section.entries.map(entry => {
            if (entry.id !== entryId) return entry;
            const field = entry.metadata[fieldName];
            if (!field) return entry;

            return {
                ...entry,
                metadata: {
                    ...entry.metadata,
                    [fieldName]: {
                        ...field,
                        suggested: null,
                    },
                },
            };
        }),
    };
}

export function updateField(section: StructuredSectionState, entryId: string, fieldName: string, newText: string): StructuredSectionState {
    return {
        ...section,
        entries: section.entries.map(entry => {
            if (entry.id !== entryId) return entry;
            const field = entry.metadata[fieldName];
            if (!field) return entry;

            return {
                ...entry,
                metadata: {
                    ...entry.metadata,
                    [fieldName]: {
                        ...field,
                        final: stripMarkdown(newText),
                        suggested: null,
                    },
                },
            };
        }),
    };
}
