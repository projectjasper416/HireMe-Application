import fetch from 'node-fetch';
import { detectLLMProvider, buildLLMHeaders, buildLLMRequestBody, parseLLMResponse } from './llmProvider';
import { Logger } from '../utils/Logger';
import { v4 as uuid } from 'uuid';

interface ReviewArgs {
  sectionName: string;
  content: string;
}

interface ReviewResponse {
  section_name?: string;
  review_html: string;
  critique?: string;
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

function normalizeReview(sectionName: string, payload: ReviewResponse): ReviewResponse {
  return {
    section_name: payload.section_name ?? sectionName,
    review_html: String(payload.review_html),
  };
}

const systemInstructions = `You are a professional resume editor and ATS optimization expert.
- Preserve tone and personality.
- Make the resume more ATS-friendly by adding or replacing only individual words or very short phrases.
- Do NOT rewrite whole sentences or paragraphs; keep the original structure and punctuation intact.
- Wrap removed words in <del> and inserted words in <ins>.
- Donot consider "-" as a word to be removed or inserted for example "Detail Oriented" should not be considered to be corrected as "Detail-Oriented".
- For contact information, only normalize formatting (e.g., add missing separators) and do not remove fields.
- Keep whitespace and sentence order exactly as provided.`;

export async function reviewSectionWithLLM({ sectionName, content }: ReviewArgs): Promise<ReviewResponse> {
  const transactionId = `review-section-${uuid()}`;
  try {
    const apiUrl = process.env.LLM_REVIEW_API_URL;
    const apiKey = process.env.LLM_REVIEW_API_KEY;
    const model = process.env.LLM_REVIEW_MODEL;


    if (!apiUrl || !apiKey) {
      const error = new Error('LLM review configuration missing (LLM_REVIEW_API_URL / LLM_REVIEW_API_KEY).');
      await Logger.logBackendError('ReviewLLM', error, {
        TransactionID: transactionId,
        Endpoint: 'reviewSectionWithLLM',
        Status: 'CONFIG_ERROR'
      });
      throw error;
    }

  // Auto-detect provider based on URL or API key format
  const provider = detectLLMProvider(apiUrl, apiKey);
  const headers = buildLLMHeaders(provider, apiKey);
  
  const prompt = `${systemInstructions}\n\nSection Name: ${sectionName}\nContent:\n"""\n${content}\n"""\n\nReturn a JSON object with keys section_name and review_html only.`;
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
      const error = new Error(`Review LLM failed with status ${response.status}`);
      await Logger.logBackendError('ReviewLLM', error, {
        TransactionID: transactionId,
        Endpoint: 'reviewSectionWithLLM',
        Status: 'LLM_ERROR',
        Exception: raw.substring(0, 500)
      });
      throw error;
    }

    try {
      const json = JSON.parse(raw) as any;

      // Check for direct review_html in response (unlikely but possible)
      if (json?.review_html) {
        await Logger.logInfo('ReviewLLM', 'Section reviewed successfully', {
          TransactionID: transactionId,
          Endpoint: 'reviewSectionWithLLM',
          Status: 'SUCCESS',
          RelatedTo: sectionName
        });
        return normalizeReview(sectionName, json as ReviewResponse);
      }

      // Extract text content using provider-specific parsing
      const textContent = parseLLMResponse(provider, json);
      
      if (textContent) {
        const blocks = extractJsonBlocks(textContent);
        for (const block of blocks) {
          try {
            const parsed = JSON.parse(block) as ReviewResponse;
            if (parsed?.review_html) {
              await Logger.logInfo('ReviewLLM', 'Section reviewed successfully', {
                TransactionID: transactionId,
                Endpoint: 'reviewSectionWithLLM',
                Status: 'SUCCESS',
                RelatedTo: sectionName
              });
              return normalizeReview(sectionName, parsed);
            }
          } catch {
            continue;
          }
        }
      }

      // Fallback: try parsing Google Gemini format directly
      const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
      for (const candidate of candidates) {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        for (const part of parts) {
          if (typeof part?.text === 'string') {
            const blocks = extractJsonBlocks(part.text);
            for (const block of blocks) {
              try {
                const parsed = JSON.parse(block) as ReviewResponse;
                if (parsed?.review_html) {
                  await Logger.logInfo('ReviewLLM', 'Section reviewed successfully', {
                    TransactionID: transactionId,
                    Endpoint: 'reviewSectionWithLLM',
                    Status: 'SUCCESS',
                    RelatedTo: sectionName
                  });
                  return normalizeReview(sectionName, parsed);
                }
              } catch {
                continue;
              }
            }
          }
        }
      }
    } catch (err) {
      await Logger.logBackendError('ReviewLLM', err as Error, {
        TransactionID: transactionId,
        Endpoint: 'reviewSectionWithLLM',
        Status: 'PARSE_ERROR',
        Exception: raw.substring(0, 500)
      });
      throw new Error(`Review LLM returned invalid JSON: ${raw}`);
    }

    const error = new Error(`Review LLM did not return suggestions`);
    await Logger.logBackendError('ReviewLLM', error, {
      TransactionID: transactionId,
      Endpoint: 'reviewSectionWithLLM',
      Status: 'PARSE_ERROR',
      Exception: raw.substring(0, 500)
    });
    throw error;
  } catch (error) {
    await Logger.logBackendError('ReviewLLM', error, {
      TransactionID: transactionId,
      Endpoint: 'reviewSectionWithLLM',
      Status: 'INTERNAL_ERROR'
    });
    throw error;
  }
}


