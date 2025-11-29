// Utility to parse and handle structured tailoring data

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
    fieldOrder?: string[]; // Preserve field order from backend for dynamic rendering
}

export interface StructuredTailoringState {
    heading: string;
    type: 'summary' | 'experience' | 'education' | 'skills' | 'other';
    isStructured: boolean;
    entries: EntryState[];
}

/**
 * Parse AI tailoring from backend
 * Accepts either a JSON string or an already-parsed object
 */
export function parseAITailoring(tailored_suggestions: string | object | null): StructuredTailoringState | null {
    if (!tailored_suggestions) return null;

    try {
        // Handle both string and object inputs
        const parsed = typeof tailored_suggestions === 'string' 
            ? JSON.parse(tailored_suggestions)
            : tailored_suggestions;

        if (parsed.type && parsed.entries) {
            const result: StructuredTailoringState = {
                heading: parsed.sectionName,
                type: parsed.type,
                isStructured: true,
                entries: parsed.entries.map((e: any) => {
                    const entry: EntryState = {
                        id: e.id,
                        metadata: {},
                        bullets: [],
                    };

                    // CRITICAL: Preserve fieldOrder from backend - it should contain the correct order from user's resume
                    let fieldOrder: string[] = [];
                    
                    // First, collect ALL metadata fields from the entry (they should be at top level)
                    const allMetadataKeys: string[] = [];
                    for (const key of Object.keys(e)) {
                        if (key !== 'id' && key !== 'bullets' && key !== 'fieldOrder') {
                            const value = e[key];
                            // Check if it's a metadata field (has original/suggested structure)
                            if (typeof value === 'object' && value !== null) {
                                // Check if it has the expected structure (original/suggested)
                                if ('original' in value || 'suggested' in value || (typeof value === 'object' && Object.keys(value).length > 0)) {
                                    allMetadataKeys.push(key);
                                }
                            }
                        }
                    }
                    
                    // CRITICAL: For Experience and Education sections, the backend's fieldOrder might be wrong
                    // The JSON object key order (preserved by JavaScript) might better reflect the user's resume
                    // For these sections, prioritize JSON object key order over backend fieldOrder
                    const sectionType = parsed.type;
                    const isExperienceOrEducation = sectionType === 'experience' || sectionType === 'education';
                    
                    if (e.fieldOrder && Array.isArray(e.fieldOrder) && e.fieldOrder.length > 0 && !isExperienceOrEducation) {
                        // For non-Experience/Education sections, use backend's fieldOrder if provided
                        const fieldOrderSet = new Set(e.fieldOrder);
                        const missingInFieldOrder = allMetadataKeys.filter(k => !fieldOrderSet.has(k));
                        
                        if (missingInFieldOrder.length === 0 && e.fieldOrder.length === allMetadataKeys.length) {
                            // fieldOrder is complete - use it
                            fieldOrder = [...e.fieldOrder];
                        } else {
                            // fieldOrder is incomplete - use JSON object key order
                            fieldOrder = allMetadataKeys;
                        }
                    } else {
                        // For Experience/Education OR when no fieldOrder: use JSON object key order
                        // JavaScript preserves insertion order, which should match the user's resume structure
                        // This is more reliable than backend's fieldOrder which might be extracted incorrectly
                        fieldOrder = allMetadataKeys;
                    }
                    
                    // Extract metadata fields in the CORRECT ORDER (from fieldOrder)
                    const processedKeys = new Set<string>();
                    
                    // First, process fields in fieldOrder (the correct order)
                    for (const key of fieldOrder) {
                        if (key !== 'id' && key !== 'bullets' && key !== 'fieldOrder') {
                            const value = e[key];
                            if (typeof value === 'object' && value !== null) {
                                // Handle both {original, suggested} structure and nested structures
                                const field = value as any;
                                if ('original' in field || 'suggested' in field) {
                                    entry.metadata[key] = {
                                        original: stripMarkdown(field.original || ''),
                                        suggested: field.suggested ? stripMarkdown(field.suggested) : null,
                                        final: null,
                                    };
                                    processedKeys.add(key);
                                }
                            }
                        }
                    }
                    
                    // Then, process any remaining fields that weren't in fieldOrder (append to end)
                    for (const key of allMetadataKeys) {
                        if (!processedKeys.has(key)) {
                            const value = e[key];
                            if (typeof value === 'object' && value !== null) {
                                const field = value as any;
                                if ('original' in field || 'suggested' in field) {
                                    entry.metadata[key] = {
                                        original: field.original || '',
                                        suggested: field.suggested || null,
                                        final: null,
                                    };
                                    // Add to fieldOrder at the end to maintain completeness
                                    if (!fieldOrder.includes(key)) {
                                        fieldOrder.push(key);
                                    }
                                    processedKeys.add(key);
                                }
                            }
                        }
                    }
                    
                    // ALWAYS store fieldOrder for rendering (even if empty, for consistency)
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

            return result;
        }
    } catch (e) {
        console.error('[parseAITailoring] Failed to parse JSON:', e);
    }

    return null;
}

/**
 * Apply final_updated values to structured tailoring state
 * IMPORTANT: Only apply final values where they exist, preserve suggestions for unchanged items
 */
export function applyFinalUpdated(section: StructuredTailoringState, finalUpdated: any): StructuredTailoringState {
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
 * Serialize structured tailoring to JSONB format for database
 * Uses array structure to preserve field order
 */
export function serializeToFinalUpdated(section: StructuredTailoringState): any[] {
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
export function hasSuggestions(section: StructuredTailoringState | null): boolean {
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

export function acceptBullet(section: StructuredTailoringState, bulletId: string): StructuredTailoringState {
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

export function rejectBullet(section: StructuredTailoringState, bulletId: string): StructuredTailoringState {
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

export function updateBullet(section: StructuredTailoringState, bulletId: string, newText: string): StructuredTailoringState {
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

export function updateBulletSuggestion(section: StructuredTailoringState, bulletId: string, suggested: string): StructuredTailoringState {
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

export function acceptField(section: StructuredTailoringState, entryId: string, fieldName: string): StructuredTailoringState {
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

export function rejectField(section: StructuredTailoringState, entryId: string, fieldName: string): StructuredTailoringState {
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

export function updateField(section: StructuredTailoringState, entryId: string, fieldName: string, newText: string): StructuredTailoringState {
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
