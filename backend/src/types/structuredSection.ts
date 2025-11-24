// JSON Schema for Structured Resume Sections with Granular Editing

export interface BulletPoint {
    id: string;  // Unique ID for this bullet (e.g., "bullet-1", "bullet-2")
    original: string;  // Original text from parsed resume
    suggested?: string | null;  // AI suggestion (null if no suggestion)
    final?: string | null;  // User's final edited text (null if not edited)
}

export interface SectionEntry {
    id: string;  // Unique ID for this entry (e.g., "entry-1")
    type: 'job' | 'education' | 'project' | 'certification' | 'other';

    // Metadata fields (optional, depends on entry type)
    company?: string;
    title?: string;
    dates?: string;
    location?: string;
    institution?: string;
    degree?: string;
    projectName?: string;

    // Summary text (optional, for entries with description but no bullets)
    summary?: BulletPoint[];

    // Bullet points for this entry
    bullets: BulletPoint[];
}

export interface StructuredSection {
    heading: string;  // Section heading (e.g., "Professional Experience")
    type: 'contact' | 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'certifications' | 'other';

    // For simple sections (like Summary, Skills) - just text bullets
    bullets?: BulletPoint[];

    // For complex sections (like Experience, Education) - entries with bullets
    entries?: SectionEntry[];
}

// Helper type for API responses
export interface SectionWithEdits extends StructuredSection {
    // Computed field: true if any bullet has 'final' value
    hasEdits?: boolean;
    // Computed field: true if any bullet has 'suggested' value
    hasSuggestions?: boolean;
}

// Example usage:
const exampleSection: StructuredSection = {
    heading: "Professional Experience",
    type: "experience",
    entries: [
        {
            id: "entry-1",
            type: "job",
            company: "COGOPORT",
            title: "Data Engineering Associate",
            dates: "Aug '24",
            location: "Bangalore",
            bullets: [
                {
                    id: "bullet-1",
                    original: "Led requirements-gathering workshops with Product and Operations teams.",
                    suggested: "Led requirements-gathering workshops with Product and Operations teams to define data and reporting needs; documented functional specifications and created UML diagrams for new rate-management features.",
                    final: null
                },
                {
                    id: "bullet-2",
                    original: "Leveraged SQL playground of 600K+ rows.",
                    suggested: null,  // No AI suggestion for this bullet
                    final: "Analyzed 600K+ booking records using SQL and Excel to optimize capacity planning."  // User edited
                }
            ]
        }
    ]
};
