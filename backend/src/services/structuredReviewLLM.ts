import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import { detectLLMProvider, buildLLMHeaders, buildLLMRequestBody, parseLLMResponse } from './llmProvider';

interface StructuredReviewArgs {
    sectionName: string;
    rawBody: any;
}

interface BulletSuggestion {
    id: string;
    original: string;
    suggested: string;
}

interface EntrySuggestion {
    id: string;
    [key: string]: any;
    bullets: BulletSuggestion[];
}

interface StructuredReviewResponse {
    sectionName: string;
    type: 'summary' | 'experience' | 'education' | 'skills' | 'other';
    entries: EntrySuggestion[];
}

const systemInstructions = `You are a professional resume editor and ATS optimization expert.

CRITICAL RULES:
- Preserve tone and personality
- Make content more ATS-friendly  
- Suggest improvements for individual bullets
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
        "fieldName": { "original": "value", "suggested": "improved value" }
      },
      "bullets": [
        { "id": "bullet-0-0", "original": "text", "suggested": "improved text" }
      ]
    }
  ]
}

SECTION-SPECIFIC RULES:
- Summary/Objective: ONE entry with ONE bullet containing the ENTIRE paragraph (do NOT split into sentences)
- Experience/Work: Multiple entries (preserve order), metadata={company, title, dates} (preserve order), bullets=achievements
- Education: Multiple entries (preserve order), metadata={institution, degree, dates, gpa} (preserve order), bullets=details  
- Skills: Multiple entries (preserve order), metadata={category, name}, NO bullets
- Certifications: Multiple entries (preserve order), metadata={name, issuer, date} (preserve order), NO bullets
- Contact: ONE entry, metadata={name, email, phone, linkedin}, NO bullets

IMPORTANT:
- NEVER nest "original" and "suggested"
- If no improvement needed, set suggested = original
- For Summary, keep as ONE continuous paragraph in ONE bullet
- Preserve exact order of entries from input
- Return ONLY valid JSON`;

export async function reviewSectionStructured({ sectionName, rawBody }: StructuredReviewArgs): Promise<StructuredReviewResponse> {
    const apiUrl = process.env.LLM_REVIEW_API_URL;
    const apiKey = process.env.LLM_REVIEW_API_KEY;
    const model = process.env.LLM_REVIEW_MODEL;

    if (!apiUrl || !apiKey) {
        throw new Error('LLM review configuration missing');
    }

    const sectionLower = sectionName.toLowerCase();
    let sectionType: 'summary' | 'experience' | 'education' | 'skills' | 'other' = 'other';
    if (sectionLower.includes('summary') || sectionLower.includes('objective')) sectionType = 'summary';
    else if (sectionLower.includes('experience') || sectionLower.includes('work')) sectionType = 'experience';
    else if (sectionLower.includes('education')) sectionType = 'education';
    else if (sectionLower.includes('skill')) sectionType = 'skills';

    const fullPrompt = `${systemInstructions}

Review this ${sectionName} section.

Input data:
${JSON.stringify(rawBody, null, 2)}

Section type: ${sectionType}

Return ONLY valid JSON in the universal format.`;

    const provider = detectLLMProvider(apiUrl, apiKey);
    const headers = buildLLMHeaders(provider, apiKey);
    const body = buildLLMRequestBody(provider, { apiUrl, apiKey, model }, {
        prompt: fullPrompt,
        maxTokens: 4096,
    });

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM review failed: ${response.status} - ${text}`);
    }

    const json = await response.json();
    const textContent = parseLLMResponse(provider, json);

    if (!textContent) {
        throw new Error('No response from LLM');
    }

    return parseStructuredResponse(textContent, sectionName, sectionType, rawBody);
}

function parseStructuredResponse(
    textContent: string,
    sectionName: string,
    sectionType: string,
    rawBody: any
): StructuredReviewResponse {
    let parsed: any;

    const jsonMatch = textContent.match(/```json\s*([\s\S]*?)```/i);
    if (jsonMatch) {
        try {
            parsed = JSON.parse(jsonMatch[1]);
        } catch (e) { }
    }

    if (!parsed) {
        try {
            parsed = JSON.parse(textContent);
        } catch (e) {
            console.warn('[reviewSectionStructured] Failed to parse, using fallback');
            return buildFallbackResponse(sectionName, sectionType, rawBody);
        }
    }

    const extractString = (value: any): string => {
        if (typeof value === 'string') return value;
        if (typeof value === 'object' && value !== null) {
            if (value.suggested) return extractString(value.suggested);
            if (value.original) return extractString(value.original);
            return JSON.stringify(value);
        }
        return String(value);
    };

    const entries: EntrySuggestion[] = [];
    const llmEntries = parsed.entries || [];

    for (let i = 0; i < llmEntries.length; i++) {
        const llmEntry = llmEntries[i];

        const entry: EntrySuggestion = {
            id: llmEntry.id || `entry-${i}`,
            bullets: [],
        };

        if (llmEntry.metadata) {
            for (const [key, value] of Object.entries(llmEntry.metadata)) {
                const fieldValue = value as any;
                const original = extractString(fieldValue.original || fieldValue);
                const suggested = extractString(fieldValue.suggested || fieldValue.original || fieldValue);

                // Only add if not null/empty
                if (original && original !== 'null') {
                    entry[key] = { original, suggested };
                }
            }
        }

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

        entries.push(entry);
    }

    return { sectionName, type: sectionType as any, entries };
}

function buildFallbackResponse(
    sectionName: string,
    sectionType: string,
    rawBody: any
): StructuredReviewResponse {
    const entries: EntrySuggestion[] = [];

    if (Array.isArray(rawBody)) {
        for (let i = 0; i < rawBody.length; i++) {
            const item = rawBody[i];
            const entry: EntrySuggestion = {
                id: `entry-${i}`,
                bullets: [],
            };

            for (const [key, value] of Object.entries(item)) {
                if (key === 'bullets' && Array.isArray(value)) {
                    entry.bullets = value
                        .filter(b => b && String(b) !== 'null')
                        .map((b, j) => ({
                            id: `bullet-${i}-${j}`,
                            original: String(b),
                            suggested: String(b),
                        }));
                } else if (value && String(value) !== 'null') {
                    entry[key] = {
                        original: String(value),
                        suggested: String(value),
                    };
                }
            }

            entries.push(entry);
        }
    } else if (typeof rawBody === 'object' && rawBody !== null) {
        const entry: EntrySuggestion = {
            id: 'entry-0',
            bullets: [],
        };

        if (rawBody.summary && Array.isArray(rawBody.summary)) {
            // Join Summary into single paragraph
            const summaryText = rawBody.summary.join(' ');
            if (summaryText && summaryText !== 'null') {
                entry.bullets = [{
                    id: 'bullet-0-0',
                    original: summaryText,
                    suggested: summaryText,
                }];
            }
        } else {
            for (const [key, value] of Object.entries(rawBody)) {
                if (typeof value === 'string' && value && value !== 'null') {
                    entry[key] = {
                        original: value,
                        suggested: value,
                    };
                }
            }
        }

        entries.push(entry);
    } else if (typeof rawBody === 'string' && rawBody && rawBody !== 'null') {
        entries.push({
            id: 'entry-0',
            bullets: [{
                id: 'bullet-0-0',
                original: rawBody,
                suggested: rawBody,
            }],
        });
    }

    return { sectionName, type: sectionType as any, entries };
}

export type { StructuredReviewResponse, EntrySuggestion, BulletSuggestion };
