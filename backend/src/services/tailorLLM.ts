import fetch from 'node-fetch';
import { detectLLMProvider, buildLLMHeaders, buildLLMRequestBody, parseLLMResponse } from './llmProvider';

interface TailorArgs {
    sectionName: string;
    content: string;
    jobDescription: string;
    keywords: string[];
}

interface TailorResponse {
    section_name?: string;
    tailored_html: string;
}

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

const systemInstructions = `You are a professional resume editor and ATS optimization expert.
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

    const prompt = `${systemInstructions}

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

        // Check for direct tailored_html in response
        if (json?.tailored_html) {
            return normalizeTailoring(sectionName, json as TailorResponse);
        }

        // Extract text content using provider-specific parsing
        const textContent = parseLLMResponse(provider, json);

        if (textContent) {
            const blocks = extractJsonBlocks(textContent);
            for (const block of blocks) {
                try {
                    const parsed = JSON.parse(block) as TailorResponse;
                    if (parsed?.tailored_html) {
                        return normalizeTailoring(sectionName, parsed);
                    }
                } catch {
                    continue;
                }
            }
        }

        // Fallback: try parsing Google Gemini format directly if not caught by parseLLMResponse
        // (This part might be redundant if parseLLMResponse is robust, but keeping for safety similar to reviewLLM)
        const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
        for (const candidate of candidates) {
            const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
            for (const part of parts) {
                if (typeof part?.text === 'string') {
                    const blocks = extractJsonBlocks(part.text);
                    for (const block of blocks) {
                        try {
                            const parsed = JSON.parse(block) as TailorResponse;
                            if (parsed?.tailored_html) {
                                return normalizeTailoring(sectionName, parsed);
                            }
                        } catch {
                            continue;
                        }
                    }
                }
            }
        }
    } catch (err) {
        throw new Error(`Tailor LLM returned invalid JSON: ${raw}`);
    }

    throw new Error(`Tailor LLM did not return suggestions: ${raw}`);
}
