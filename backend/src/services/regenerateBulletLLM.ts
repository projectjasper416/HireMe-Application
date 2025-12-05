import fetch from 'node-fetch';
import { detectLLMProvider, buildLLMHeaders, buildLLMRequestBody, parseLLMResponse } from './llmProvider';
import { Logger } from '../utils/Logger';
import { v4 as uuid } from 'uuid';

interface RegenerateBulletArgs {
    bulletText: string;
    context: {
        sectionName: string;
        company?: string;
        title?: string;
        dates?: string;
        otherBullets?: string[];  // Other bullets in the same entry for context
    };
}

interface RegenerateBulletResponse {
    suggested: string;
}

const systemInstructions = `You are a professional resume editor and ATS optimization expert.

Your task is to improve a single bullet point from a resume.

CRITICAL RULES:
- Preserve the core meaning and facts
- Make it more ATS-friendly and impactful
- Use strong action verbs
- Include metrics and quantifiable results when possible
- Keep it concise (1-2 lines max)
- Maintain professional tone

Return ONLY the improved bullet point text, nothing else.`;

export async function regenerateBulletWithLLM({ bulletText, context }: RegenerateBulletArgs): Promise<RegenerateBulletResponse> {
    const transactionId = `regenerate-bullet-${uuid()}`;
    try {
        const apiUrl = process.env.LLM_REVIEW_API_URL;
        const apiKey = process.env.LLM_REVIEW_API_KEY;
        const model = process.env.LLM_REVIEW_MODEL;

        
        if (!apiUrl || !apiKey) {
            const error = new Error('LLM review configuration missing');
            await Logger.logBackendError('RegenerateBulletLLM', error, {
                TransactionID: transactionId,
                Endpoint: 'regenerateBulletWithLLM',
                Status: 'CONFIG_ERROR'
            });
            throw error;
        }

    // Build context-aware prompt
    let prompt = `${systemInstructions}\n\n`;
    prompt += `Section: ${context.sectionName}\n`;
    if (context.company) prompt += `Company: ${context.company}\n`;
    if (context.title) prompt += `Role: ${context.title}\n`;
    if (context.dates) prompt += `Dates: ${context.dates}\n`;

    if (context.otherBullets && context.otherBullets.length > 0) {
        prompt += `\nOther achievements in this role:\n`;
        context.otherBullets.forEach((bullet, i) => {
            prompt += `${i + 1}. ${bullet}\n`;
        });
    }

    prompt += `\nCurrent bullet point to improve:\n"${bulletText}"\n\n`;
    prompt += `Provide an improved version of this bullet point:`;

    const provider = detectLLMProvider(apiUrl, apiKey);
    const headers = buildLLMHeaders(provider, apiKey);
    const body = buildLLMRequestBody(provider, { apiUrl, apiKey, model }, {
        prompt,
        maxTokens: 256,
    });

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

        if (!response.ok) {
            const text = await response.text();
            const error = new Error(`LLM regeneration failed: ${response.status}`);
            await Logger.logBackendError('RegenerateBulletLLM', error, {
                TransactionID: transactionId,
                Endpoint: 'regenerateBulletWithLLM',
                Status: 'LLM_ERROR',
                Exception: text.substring(0, 500)
            });
            throw error;
        }

        const json = await response.json();
        const textContent = parseLLMResponse(provider, json);

        if (!textContent) {
            const error = new Error('No response from LLM');
            await Logger.logBackendError('RegenerateBulletLLM', error, {
                TransactionID: transactionId,
                Endpoint: 'regenerateBulletWithLLM',
                Status: 'LLM_ERROR'
            });
            throw error;
        }

        // Clean up the response (remove quotes, extra whitespace, etc.)
        let suggested = textContent.trim();

        // Remove surrounding quotes if present
        if ((suggested.startsWith('"') && suggested.endsWith('"')) ||
            (suggested.startsWith("'") && suggested.endsWith("'"))) {
            suggested = suggested.slice(1, -1);
        }

        // Remove bullet point markers if LLM added them
        suggested = suggested.replace(/^[•\-*]\s*/, '');

        await Logger.logInfo('RegenerateBulletLLM', 'Bullet regenerated successfully', {
            TransactionID: transactionId,
            Endpoint: 'regenerateBulletWithLLM',
            Status: 'SUCCESS'
        });

        return { suggested };
    } catch (error) {
        await Logger.logBackendError('RegenerateBulletLLM', error, {
            TransactionID: transactionId,
            Endpoint: 'regenerateBulletWithLLM',
            Status: 'INTERNAL_ERROR'
        });
        throw error;
    }
}
