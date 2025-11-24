import { v4 as uuidv4 } from 'uuid';
import { StructuredSection, SectionEntry, BulletPoint } from '../types/structuredSection';

/**
 * Convert raw_body (from LLM parser) to StructuredSection format
 */
export function rawBodyToStructured(rawBody: any, heading: string): StructuredSection {
    if (!rawBody || typeof rawBody !== 'object') {
        // Fallback for plain text
        return {
            heading,
            type: 'other',
            bullets: [{
                id: uuidv4(),
                original: typeof rawBody === 'string' ? rawBody : '',
                suggested: null,
                final: null,
            }],
        };
    }

    const sectionType = determineSectionType(heading);

    // Handle simple sections (Summary, Skills, etc.)
    if (rawBody.summary && !rawBody.entries) {
        return {
            heading,
            type: sectionType,
            bullets: (rawBody.summary as string[]).map((text: string) => ({
                id: uuidv4(),
                original: text,
                suggested: null,
                final: null,
            })),
        };
    }

    // Handle complex sections (Experience, Education, etc.)
    if (rawBody.entries && Array.isArray(rawBody.entries)) {
        return {
            heading,
            type: sectionType,
            entries: rawBody.entries.map((entry: any) => convertEntry(entry)),
        };
    }

    // Fallback
    return {
        heading,
        type: sectionType,
        bullets: [{
            id: uuidv4(),
            original: JSON.stringify(rawBody),
            suggested: null,
            final: null,
        }],
    };
}

function convertEntry(entry: any): SectionEntry {
    const entryType = entry.company ? 'job' : entry.institution ? 'education' : entry.projectName ? 'project' : 'other';

    return {
        id: uuidv4(),
        type: entryType,
        company: entry.company,
        title: entry.title,
        dates: entry.dates,
        location: entry.location,
        institution: entry.institution,
        degree: entry.degree,
        projectName: entry.projectName,
        summary: entry.summary ? entry.summary.map((text: string) => ({
            id: uuidv4(),
            original: text,
            suggested: null,
            final: null,
        })) : undefined,
        bullets: (entry.bullets || []).map((text: string) => ({
            id: uuidv4(),
            original: text,
            suggested: null,
            final: null,
        })),
    };
}

/**
 * Convert StructuredSection back to raw_body format for PDF rendering
 */
export function structuredToRawBody(section: StructuredSection): any {
    // For simple sections
    if (section.bullets && !section.entries) {
        return {
            summary: section.bullets.map(b => b.final || b.suggested || b.original),
            entries: [],
        };
    }

    // For complex sections
    if (section.entries) {
        return {
            summary: [],
            entries: section.entries.map(entry => ({
                company: entry.company,
                title: entry.title,
                dates: entry.dates,
                location: entry.location,
                institution: entry.institution,
                degree: entry.degree,
                projectName: entry.projectName,
                summary: entry.summary?.map(b => b.final || b.suggested || b.original) || [],
                bullets: entry.bullets.map(b => b.final || b.suggested || b.original),
            })),
        };
    }

    return { summary: [], entries: [] };
}

/**
 * Determine section type from heading
 */
function determineSectionType(heading: string): StructuredSection['type'] {
    const lower = heading.toLowerCase();
    if (lower.includes('contact')) return 'contact';
    if (lower.includes('summary') || lower.includes('objective') || lower.includes('profile')) return 'summary';
    if (lower.includes('experience') || lower.includes('work') || lower.includes('employment')) return 'experience';
    if (lower.includes('education') || lower.includes('academic')) return 'education';
    if (lower.includes('skill')) return 'skills';
    if (lower.includes('project')) return 'projects';
    if (lower.includes('certif')) return 'certifications';
    return 'other';
}

/**
 * Merge AI suggestions into structured section
 */
export function mergeSuggestions(
    original: StructuredSection,
    suggestions: string[]
): StructuredSection {
    const result = JSON.parse(JSON.stringify(original)) as StructuredSection;
    let suggestionIndex = 0;

    // Helper to assign suggestions to bullets
    const assignSuggestions = (bullets: BulletPoint[]) => {
        bullets.forEach(bullet => {
            if (suggestionIndex < suggestions.length) {
                bullet.suggested = suggestions[suggestionIndex];
                suggestionIndex++;
            }
        });
    };

    // Assign to simple sections
    if (result.bullets) {
        assignSuggestions(result.bullets);
    }

    // Assign to complex sections
    if (result.entries) {
        result.entries.forEach(entry => {
            if (entry.summary) assignSuggestions(entry.summary);
            assignSuggestions(entry.bullets);
        });
    }

    return result;
}
