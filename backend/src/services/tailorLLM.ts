import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import { detectLLMProvider, buildLLMHeaders, buildLLMRequestBody, parseLLMResponse } from './llmProvider';

interface TailorArgs {
    sectionName: string;
    content: string;
    jobDescription: string;
    keywords: string[];
}

interface StructuredTailorArgs {
    sectionName: string;
    rawBody: any;
    jobDescription: string;
    keywords: string[];
}

interface TailorResponse {
    section_name?: string;
    tailored_html: string;
}

interface BulletSuggestion {
    id: string;
    original: string;
    suggested: string;
}

interface EntrySuggestion {
    id: string;
    fieldOrder?: string[]; // Explicit field order for frontend rendering
    [key: string]: any;
    bullets: BulletSuggestion[];
}

interface StructuredTailorResponse {
    sectionName: string;
    type: 'summary' | 'experience' | 'education' | 'skills' | 'other';
    entries: EntrySuggestion[];
}

const systemInstructions = `You are a professional resume editor and ATS optimization expert specializing in resume tailoring.

CRITICAL RULES:
- TAILOR the resume section to match the Job Description and Keywords
- Preserve tone and personality while optimizing for ATS
- Remove irrelevant content or rewrite to match JD
- Incorporate provided keywords naturally
- Focus on impact, metrics, and action verbs
- Keep original structure and order
- NEVER reorder sections or entries

UNIVERSAL OUTPUT FORMAT:

{
  "sectionName": "Section Name",
  "type": "experience|education|skills|summary|other",
  "entries": [
    {
      "id": "entry-0",
      "metadata": {
        "fieldName": { "original": "value", "suggested": "tailored value" }
      },
      "bullets": [
        { "id": "bullet-0-0", "original": "text", "suggested": "tailored text" }
      ]
    }
  ]
}

SECTION-SPECIFIC RULES:
- Summary/Objective: ONE entry with metadata={}, ONE bullet containing the ENTIRE paragraph (do NOT split into sentences)
- Experience/Work: Multiple entries (preserve order), metadata={company, title, dates} (preserve order), bullets=achievements
- Education: Multiple entries (preserve order), metadata={institution, degree, dates, gpa, location} (preserve order), bullets=details  
- Skills: Multiple entries (preserve order), metadata={category, name} (preserve order), NO bullets. For input like "Category: skill1, skill2", split at the colon - everything before colon is "category", everything after is "name".
- Certifications: Multiple entries (preserve order), metadata={name, issuer, date} (preserve order), NO bullets
- Projects: Multiple entries (preserve order), metadata={name, dates} (preserve order), bullets=details
- Contact: ONE entry, metadata={name, email, phone, linkedin, location} (preserve order), NO bullets

TAILORING GUIDELINES:
- For bullets: Rewrite to emphasize skills/experience matching the JD
- Incorporate target keywords naturally where relevant
- Rewrite the bullets which are completely irrelevant to the JD
- Quantify achievements when possible
- Use action verbs from the JD when appropriate
- For metadata: Usually keep original unless tailoring improves ATS match
- AGGRESSIVELY tailor the content to the job description. Do not be afraid to rewrite significantly if it helps the match.
- Ensure at least 50% of bullets have meaningful improvements.

CRITICAL FORMAT REQUIREMENTS:
- NEVER nest "original" and "suggested" inside each other
- Each metadata field MUST be an object with "original" and "suggested" keys
- Each bullet MUST be an object with "id", "original", and "suggested" keys
- If no improvement needed, set suggested = original
- For Summary, keep as ONE continuous paragraph in ONE bullet
- PRESERVE EXACT ORDER: Output entries in the SAME ORDER as input
- PRESERVE EXACT FIELD ORDER: Output metadata fields in the SAME ORDER they appear in the input data
- DO NOT reorder metadata fields (e.g., if input has "company, title, dates", output must have "company, title, dates" in that exact order)
- Return ONLY valid JSON, no markdown code blocks`;

export async function tailorSectionStructured({
    sectionName,
    rawBody,
    jobDescription,
    keywords
}: StructuredTailorArgs): Promise<StructuredTailorResponse> {
    const apiUrl = process.env.LLM_TAILOR_API_URL || process.env.LLM_REVIEW_API_URL;
    const apiKey = process.env.LLM_TAILOR_API_KEY || process.env.LLM_REVIEW_API_KEY;
    const model = process.env.LLM_TAILOR_MODEL || process.env.LLM_REVIEW_MODEL;

    if (!apiUrl || !apiKey) {
        throw new Error('LLM tailor configuration missing');
    }

    const sectionLower = sectionName.toLowerCase();
    let sectionType: 'summary' | 'experience' | 'education' | 'skills' | 'other' = 'other';
    if (sectionLower.includes('summary') || sectionLower.includes('objective')) sectionType = 'summary';
    else if (sectionLower.includes('experience') || sectionLower.includes('work')) sectionType = 'experience';
    else if (sectionLower.includes('education')) sectionType = 'education';
    else if (sectionLower.includes('skill')) sectionType = 'skills';

    const fullPrompt = `${systemInstructions}

Tailor this ${sectionName} section for the job.

Job Description:
"""
${jobDescription}
"""

Target Keywords: ${keywords.join(', ')}

Input data:
${JSON.stringify(rawBody, null, 2)}

Section type: ${sectionType}

CRITICAL: When you output the metadata fields, they MUST appear in the EXACT SAME ORDER as they appear in the input data above. Look at the input JSON and preserve the field order exactly. For example, if the input has fields in order [company, title, dates], your output MUST have them in that same order [company, title, dates], NOT [dates, title, company] or any other order.

Return ONLY valid JSON in the universal format.`;

    const provider = detectLLMProvider(apiUrl, apiKey);
    const headers = buildLLMHeaders(provider, apiKey);
    const body = buildLLMRequestBody(provider, { apiUrl, apiKey, model }, {
        prompt: fullPrompt,
        maxTokens: 3000,
    });
    //console.log('[tailorSectionStructured] Body:', JSON.stringify(body));
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
//console.log('[tailorSectionStructured] Response:', response);
    const raw = await response.text();

    if (!response.ok) {
        throw new Error(`Tailor LLM failed with status ${response.status}: ${raw}`);
    }

    try {
        let jsonResponse;
        try {
            jsonResponse = JSON.parse(raw);
        } catch (e) {
            throw new Error(`Failed to parse LLM response body as JSON: ${raw}`);
        }

        const content = parseLLMResponse(provider, jsonResponse);
        //console.log('[tailorSectionStructured] Raw content from LLM:', content); // Debug log

        if (!content) {
            throw new Error('Empty content from LLM');
        }

        // Try to extract JSON from markdown code blocks first
        let parsed: any;
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/i);
        if (jsonMatch) {
            try {
                parsed = JSON.parse(jsonMatch[1]);
            } catch (e) {
                // Continue to try parsing without code blocks
            }
        }

        // If no code block match or parsing failed, try parsing directly
        if (!parsed) {
            try {
                parsed = JSON.parse(content);
            } catch (e) {
                throw new Error(`Failed to parse JSON content: ${content}`);
            }
        }

        // Handle full object format with type and entries
        if (parsed.type && parsed.entries) {
            return normalizeStructuredTailoring(sectionName, sectionType, parsed, rawBody);
        }

        // Handle array format (LLM returned entries array directly)
        if (Array.isArray(parsed)) {
            console.log('[tailorSectionStructured] LLM returned array directly, wrapping in object format');
            return normalizeStructuredTailoring(sectionName, sectionType, {
                sectionName,
                type: sectionType,
                entries: parsed,
            }, rawBody);
        }

        throw new Error('Invalid structured response format');
    } catch (parseError) {
        console.error('[tailorSectionStructured] Parse error:', parseError);
        console.error('[tailorSectionStructured] Raw response was:', raw); // Log original raw response
        throw parseError; // Re-throw error instead of using fallback
        // return generateFallbackStructuredTailoring(sectionName, sectionType, rawBody);
    }
}

function normalizeStructuredTailoring(
    sectionName: string,
    sectionType: string,
    payload: any,
    rawBody?: any
): StructuredTailorResponse {
    const extractString = (value: any): string => {
        if (typeof value === 'string') return value;
        if (typeof value === 'object' && value !== null) {
            if (value.suggested) return extractString(value.suggested);
            if (value.original) return extractString(value.original);
            return JSON.stringify(value);
        }
        return String(value);
    };

    // Extract field order from rawBody for enforcement
    // Handles both new array structure format and legacy format
    const getFieldOrderFromRawBody = (rawBodyEntry: any): string[] => {
        if (!rawBodyEntry || typeof rawBodyEntry !== 'object') return [];
        
        // Check if using new array structure format
        if (rawBodyEntry.fieldOrder && Array.isArray(rawBodyEntry.fieldOrder)) {
            return rawBodyEntry.fieldOrder.filter((k: string) => k !== 'bullets' && k !== 'summary');
        }
        
        // Legacy format: extract from object keys
        return Object.keys(rawBodyEntry).filter(k => k !== 'bullets' && k !== 'summary' && k !== 'fields' && k !== 'fieldOrder');
    };

    const entries: EntrySuggestion[] = [];
    const llmEntries = payload.entries || [];

    for (let i = 0; i < llmEntries.length; i++) {
        const llmEntry = llmEntries[i];

        // Handle string entries (e.g. from Summary or simple lists)
        if (typeof llmEntry === 'string') {
            entries.push({
                id: `entry-${i}`,
                bullets: [{
                    id: `bullet-${i}-0`,
                    original: llmEntry,
                    suggested: llmEntry
                }]
            });
            continue;
        }

        const entry: EntrySuggestion = {
            id: llmEntry.id || `entry-${i}`,
            bullets: [],
        };

        // Get expected field order from rawBody if available
        const rawBodyArray = Array.isArray(rawBody) ? rawBody : (rawBody?.summary ? null : rawBody);
        const expectedFieldOrder = rawBodyArray && rawBodyArray[i]
            ? getFieldOrderFromRawBody(rawBodyArray[i])
            : [];

        // Helper to process metadata fields
        const processField = (key: string, value: any) => {
            // Ignore numeric keys (array indices) to prevent character-by-character parsing
            if (!isNaN(Number(key))) return;

            const fieldValue = value as any;
            // Check if it has original/suggested structure or is a direct value
            const original = extractString(fieldValue.original || fieldValue);
            const suggested = extractString(fieldValue.suggested || fieldValue.original || fieldValue);

            // Only add if not null/empty
            if (original && original !== 'null') {
                entry[key] = { original, suggested };
            }
        };

        // Collect all metadata fields first
        const metadataFields: Record<string, any> = {};

        if (llmEntry.metadata) {
            Object.assign(metadataFields, llmEntry.metadata);
        } else {
            // Fallback: extract metadata from top-level entry properties
            for (const key of Object.keys(llmEntry)) {
                if (key !== 'id' && key !== 'bullets') {
                    const value = llmEntry[key];
                    if (typeof value === 'object' && value !== null) {
                        metadataFields[key] = value;
                    }
                }
            }
        }

        // Process fields in the expected order (from rawBody) if available
        const processedFieldOrder: string[] = [];

        if (expectedFieldOrder.length > 0) {
            // First, process fields in the expected order
            for (const key of expectedFieldOrder) {
                if (metadataFields[key]) {
                    processField(key, metadataFields[key]);
                    processedFieldOrder.push(key);
                }
            }
            // Then, process any remaining fields that weren't in the expected order
            for (const key of Object.keys(metadataFields)) {
                if (!expectedFieldOrder.includes(key)) {
                    processField(key, metadataFields[key]);
                    processedFieldOrder.push(key);
                }
            }
        } else {
            // No expected order, just process in the order they appear
            for (const key of Object.keys(metadataFields)) {
                processField(key, metadataFields[key]);
                processedFieldOrder.push(key);
            }
        }

        // Store the field order explicitly for frontend rendering
        if (processedFieldOrder.length > 0) {
            entry.fieldOrder = processedFieldOrder;
        }

        // Extract bullets
        if (llmEntry.bullets && Array.isArray(llmEntry.bullets)) {
            for (let j = 0; j < llmEntry.bullets.length; j++) {
                const bullet = llmEntry.bullets[j];
                const original = extractString(bullet.original || bullet);
                const suggested = extractString(bullet.suggested || bullet.original || bullet);

                // Only add if not null/empty
                if (original && original !== 'null') {
                    entry.bullets.push({
                        id: bullet.id || `bullet-${i}-${j}`,
                        original,
                        suggested,
                    });
                }
            }
        }

        // Only add entry if it has metadata or bullets
        const hasMetadata = Object.keys(entry).some(k => k !== 'id' && k !== 'bullets');
        const hasBullets = entry.bullets && entry.bullets.length > 0;
        if (hasMetadata || hasBullets) {
            entries.push(entry);
        }
    }

    return {
        sectionName: payload.sectionName || sectionName,
        type: payload.type || sectionType,
        entries,
    };
}

function generateFallbackStructuredTailoring(
    sectionName: string,
    sectionType: string,
    rawBody: any
): StructuredTailorResponse {
    console.log('[generateFallbackStructuredTailoring] Generating fallback for:', sectionName);

    const entries: EntrySuggestion[] = [];

    if (Array.isArray(rawBody)) {
        rawBody.forEach((item, idx) => {
            const entry: EntrySuggestion = {
                id: `entry-${idx}`,
                bullets: [],
            };

            if (typeof item === 'string') {
                // Handle string item (e.g. simple list item or unstructured text)
                // We'll treat it as a generic 'text' field
                entry['text'] = {
                    original: item,
                    suggested: item,
                };
            } else if (typeof item === 'object' && item !== null) {
                // Handle object item
                for (const [key, value] of Object.entries(item)) {
                    if (key === 'bullets' && Array.isArray(value)) {
                        entry.bullets = value.map((b: any, bIdx: number) => ({
                            id: `bullet-${idx}-${bIdx}`,
                            original: typeof b === 'string' ? b : (b.text || ''),
                            suggested: typeof b === 'string' ? b : (b.text || ''),
                        }));
                    } else if (typeof value === 'string') {
                        entry[key] = {
                            original: value,
                            suggested: value,
                        };
                    }
                }
            }

            entries.push(entry);
        });
    }

    return {
        sectionName,
        type: sectionType as any,
        entries,
    };
}

// Legacy HTML-based tailoring (kept for reference, not used)
function extractJsonBlocks(raw: string): string[] {
    const matches: string[] = [];
    const jsonCode = raw.match(/```json\s*([\s\S]*?)```/i);
    if (jsonCode?.[1]) matches.push(jsonCode[1]);

    const generic = raw.match(/```\s*([\s\S]*?)```/);
    if (generic?.[1]) matches.push(generic[1]);

    const loose = raw.match(/{[\s\S]*}/);
    if (loose?.[0]) matches.push(loose[0]);

    return matches;
}

function normalizeTailoring(sectionName: string, payload: TailorResponse): TailorResponse {
    return {
        section_name: payload.section_name ?? sectionName,
        tailored_html: String(payload.tailored_html),
    };
}

const legacySystemInstructions = `You are a professional resume editor and ATS optimization expert.
- Your goal is to TAILOR the resume section to the provided Job Description and Keywords.
- Preserve the original tone and personality, but prioritize ATS matching.
- You can remove irrelevant lines or rewrite them to better match the Job Description.
- You MUST use the provided keywords where appropriate.
- Wrap removed words/phrases in <del> and inserted words/phrases in <ins>.
- Do NOT rewrite whole sentences or paragraphs if possible; keep the original structure and punctuation intact unless a rewrite is necessary for better alignment.
- If a sentence is completely irrelevant to the JD, you can remove it (wrap in <del>).
- If a sentence needs to be stronger or more specific to the JD, rewrite it (wrap old in <del>, new in <ins>).
- Keep whitespace and sentence order exactly as provided unless changing it improves flow significantly.`;

export async function tailorSectionWithLLM({ sectionName, content, jobDescription, keywords }: TailorArgs): Promise<TailorResponse> {
    const apiUrl = process.env.LLM_TAILOR_API_URL || process.env.LLM_REVIEW_API_URL;
    const apiKey = process.env.LLM_TAILOR_API_KEY || process.env.LLM_REVIEW_API_KEY;
    const model = process.env.LLM_TAILOR_MODEL || process.env.LLM_REVIEW_MODEL;

    if (!apiUrl || !apiKey) {
        throw new Error('LLM tailor configuration missing (LLM_TAILOR_API_URL / LLM_TAILOR_API_KEY).');
    }

    const provider = detectLLMProvider(apiUrl, apiKey);
    const headers = buildLLMHeaders(provider, apiKey);

    const prompt = `${legacySystemInstructions}

Section Name: ${sectionName}
Job Description:
"""
${jobDescription}
"""

Target Keywords: ${keywords.join(', ')}

Content to Tailor:
"""
${content}
"""

Return a JSON object with keys section_name and tailored_html only.`;

    const body = buildLLMRequestBody(provider, { apiUrl, apiKey, model }, {
        prompt,
        maxTokens: 2048,
    });

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    const raw = await response.text();

    if (!response.ok) {
        throw new Error(`Tailor LLM failed with status ${response.status}: ${raw}`);
    }

    try {
        const json = JSON.parse(raw) as any;

        if (json?.tailored_html) {
            return normalizeTailoring(sectionName, json as TailorResponse);
        }

        const content = parseLLMResponse(provider, raw);
        const parsed = JSON.parse(content);

        if (parsed?.tailored_html) {
            return normalizeTailoring(sectionName, parsed as TailorResponse);
        }

        const blocks = extractJsonBlocks(content);
        for (const block of blocks) {
            try {
                const candidate = JSON.parse(block);
                if (candidate?.tailored_html) {
                    return normalizeTailoring(sectionName, candidate as TailorResponse);
                }
            } catch {
                continue;
            }
        }

        throw new Error('No valid tailored_html found in response');
    } catch (parseError) {
        console.error('[tailorSectionWithLLM] Parse error:', parseError);
        throw new Error('Failed to parse LLM response');
    }
}
