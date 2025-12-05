import fetch from 'node-fetch';
import type { ResumeSection } from '../types/resume';
import { detectLLMProvider, buildLLMHeaders, buildLLMRequestBody, parseLLMResponse } from './llmProvider';
import { Logger } from '../utils/Logger';
import { v4 as uuid } from 'uuid';

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

interface ParseArgs {
  fileBase64: string;
}

interface RawSection {
  heading?: string;
  body?: unknown;
}

interface FormattedSectionEntry {
  primary?: string;
  secondary?: string;
  meta?: string;
  bullets?: string[];
}

interface FormattedSection {
  heading: string;
  summary?: string[];
  entries?: FormattedSectionEntry[];
}

const parsingInstructions = `You are an expert ATS resume parser.
Extract sections from the resume and return JSON with a "sections" array.

CRITICAL: For structured sections (Experience, Education, Projects, etc.), the "body" field MUST be an array of objects, where each object represents one entry.

CRITICAL: Maintain the EXACT field order as they appear visually in the user's uploaded resume (top to bottom, left to right). 
DO NOT reorder fields - preserve whatever order the user has in their resume.

For Experience section, extract fields in the EXACT order they appear in the resume. Common fields include:
- company, title/role, dates, location, bullets
But preserve whatever order the user's resume uses.

For Education section, extract fields in the EXACT order they appear in the resume. Common fields include:
- institution/school/university, degree/major, dates, location, gpa
But preserve whatever order the user's resume uses.

For Projects section, extract fields in the EXACT order they appear. Common fields include:
- name, dates, description/bullets
But preserve whatever order the user's resume uses.

For Certifications section, extract fields in the EXACT order they appear. Common fields include:
- name, issuer, date
But preserve whatever order the user's resume uses.

For Summary, Skills, and other text-only sections, use a simple string or array of strings for "body".

ALWAYS include a first section named "Contact Information" with body as an object:
{
  "name": "...",
  "email": "...",
  "phone": "...",
  "linkedin": "...",
  "address": "...",
  "website": "..."
}

Preserve the original ordering of sections from the resume.`;
const formattingReminder = `
- When returning section content, omit leading labels such as "Company:", "Title:", "Dates:".
- Instead, express details in sentences or list items (e.g., "Cogoport — Data Engineering Associate").
- Respect the original punctuation and hyphenation (do NOT insert or remove hyphens unless the resume already uses them).`;

const contactExtractionInstructions = `You are an expert resume parser.
Extract ONLY the contact information for the candidate and return it as:
{
  "sections": [
    {
      "heading": "Contact Information",
      "body": {
        "name": "...",
        "email": "...",
        "phone": "...",
        "linkedin": "...",
        "address": "...",
        "website": "..."
      }
    }
  ]
}
Include only the fields present in the resume. Preserve original punctuation and hyphenation (do not insert hyphens into words).`;

function toTitleCase(input: string): string {
  return input
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1));
}

function indent(level: number): string {
  return '  '.repeat(Math.max(0, level));
}

function formatValue(value: unknown, level = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const formatted = formatValue(item, level + 1);
        if (!formatted) return '';
        const ind = indent(level);
        const formattedLines = formatted.replace(/\n/g, `\n${indent(level + 1)}`);
        return `${ind}• ${formattedLines}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => {
        const formatted = formatValue(val, level + 1);
        if (!formatted) return '';
        const ind = indent(level);
        const formattedLines = formatted.replace(/\n/g, `\n${indent(level + 1)}`);
        return `${ind}${toTitleCase(key)}: ${formattedLines}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function extractJsonBlocks(raw: string): string[] {
  const matches: string[] = [];
  const jsonRegex = /{[\s\S]*?}/g;
  let match;
  while ((match = jsonRegex.exec(raw)) !== null) {
    matches.push(match[0] ?? '');
  }
  return matches;
}

function normalizeSections(sections: RawSection[] | undefined | null): ResumeSection[] | null {
  if (!Array.isArray(sections)) return null;

  const normalized = sections
    .map((section) => {
      const heading = String(section?.heading ?? '').trim();
      let rawBody = section?.body ?? null;

      // Normalize field order for structured sections
      rawBody = normalizeFieldOrder(rawBody, heading);

      const bodyText = formatValue(rawBody ?? '');
      return {
        heading,
        body: bodyText.trim(),
        raw_body: rawBody,
      };
    })
    .filter((section) => section.heading.length > 0 || section.body.length > 0);

  return normalized.length > 0 ? normalized : null;
}

/**
 * Normalize field order in raw_body to match visual resume layout
 * Uses array structure to preserve field order in JSONB
 */
function normalizeFieldOrder(rawBody: any, heading: string): any {
  if (!rawBody || typeof rawBody !== 'object') return rawBody;

  const headingLower = heading.toLowerCase();

  // Handle array-based structures (e.g., Experience, Education)
  if (Array.isArray(rawBody)) {
    return rawBody.map(entry => {
      if (typeof entry !== 'object' || entry === null) return entry;

      // Convert to array structure to preserve EXACT order from LLM (which matches user's resume)
      // Use Object.keys() which preserves insertion order in modern JavaScript
      const fieldOrder: string[] = [];
      const fields: Array<{key: string, value: any}> = [];
      let bullets: any[] = [];

      // Preserve the exact order of fields as they appear in the entry object
      // This order comes from the LLM parsing, which should match the user's resume layout
      for (const key of Object.keys(entry)) {
        // Skip bullets/description - handle separately
        if (key === 'bullets' || key === 'description') continue;
        
        const value = entry[key];
        // Only include non-null, non-undefined values
        if (value !== undefined && value !== null) {
          fieldOrder.push(key);
          fields.push({ key, value });
        }
      }

      // Handle bullets/description (always at the end)
      if (entry.bullets && Array.isArray(entry.bullets)) {
        bullets = entry.bullets;
      } else if (entry.description) {
        bullets = Array.isArray(entry.description) ? entry.description : [entry.description];
      }

      // Return array structure that preserves order from user's resume
      return {
        fieldOrder,
        fields,
        bullets,
      };
    });
  }

  // Handle object-based structures with entries
  if (rawBody.entries && Array.isArray(rawBody.entries)) {
    return {
      ...rawBody,
      entries: normalizeFieldOrder(rawBody.entries, heading),
    };
  }

  return rawBody;
}

function extractSectionsFromCandidateText(text: string): ResumeSection[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const codeBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      const normalized = normalizeSections((parsed as { sections?: RawSection[] }).sections);
      if (normalized) return normalized;
    } catch {
      // ignore and continue
    }
  }

  const genericCodeBlock = trimmed.match(/```\s*([\s\S]*?)```/);
  if (genericCodeBlock && genericCodeBlock[1]) {
    try {
      const parsed = JSON.parse(genericCodeBlock[1]);
      const normalized = normalizeSections((parsed as { sections?: RawSection[] }).sections);
      if (normalized) return normalized;
    } catch {
      // ignore
    }
  }

  // Try parsing as JSON payload with sections
  try {
    const parsed = JSON.parse(trimmed) as { sections?: RawSection[] };
    const normalized = normalizeSections(parsed.sections);
    if (normalized) return normalized;
  } catch {
    // ignore, not JSON
  }

  // Try to find any JSON blocks that may contain sections
  const blocks = extractJsonBlocks(trimmed);
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block) as { sections?: RawSection[] };
      const normalized = normalizeSections(parsed.sections);
      if (normalized) return normalized;
    } catch {
      // ignore this block
    }
  }

  return null;
}

function extractSectionsFromResponse(json: any): ResumeSection[] | null {
  const direct = normalizeSections(json?.sections);
  if (direct) return direct;

  const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
  for (const candidate of candidates) {
    const contentParts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const outputParts = Array.isArray(candidate?.output?.parts) ? candidate.output.parts : [];
    const parts = [...contentParts, ...outputParts];

    for (const part of parts) {
      if (typeof part?.text === 'string') {
        const sections = extractSectionsFromCandidateText(part.text);
        if (sections) return sections;
      }

      if (typeof part?.functionCall?.arguments === 'string') {
        const sections = extractSectionsFromCandidateText(part.functionCall.arguments);
        if (sections) return sections;
      }
    }
  }

  return null;
}

// TDD 5 AI/LLM Service Layer: dedicated resume parsing LLM (cheaper tier)
export async function parseResumeWithLLM({ fileBase64 }: ParseArgs): Promise<ResumeSection[]> {
  const transactionId = `parse-resume-${uuid()}`;
  try {
    const apiUrl = process.env.LLM_PARSE_API_URL;
    const apiKey = process.env.LLM_PARSE_API_KEY;
    const model = process.env.LLM_PARSE_MODEL;

    
    if (!apiUrl || !apiKey) {
      const error = new Error('LLM parsing configuration missing (LLM_PARSE_API_URL / LLM_PARSE_API_KEY).');
      await Logger.logBackendError('LLMParser', error, {
        TransactionID: transactionId,
        Endpoint: 'parseResumeWithLLM',
        Status: 'CONFIG_ERROR'
      });
      throw error;
    }

  // Auto-detect provider based on URL or API key format
  const provider = detectLLMProvider(apiUrl, apiKey);
  const headers = buildLLMHeaders(provider, apiKey);

  const prompt = `${parsingInstructions}\n\nParse the attached resume into structured sections. Return JSON with "sections", each having "heading" and "body".${formattingReminder}`;
  const body = buildLLMRequestBody(provider, { apiUrl, apiKey, model }, {
    prompt,
    fileBase64,
    fileMimeType: 'application/pdf',
    maxTokens: 4096,
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  
  if (!response) {
    const error = new Error('Parsing LLM request failed without receiving a response.');
    await Logger.logBackendError('LLMParser', error, {
      TransactionID: transactionId,
      Endpoint: 'parseResumeWithLLM',
      Status: 'LLM_ERROR',
      Exception: 'No response received from LLM API'
    });
    throw error;
  }

    const raw = await response.text();

    if (!response.ok) {
      const error = new Error(`Parsing LLM failed with status ${response.status}`);
      await Logger.logBackendError('LLMParser', error, {
        TransactionID: transactionId,
        Endpoint: 'parseResumeWithLLM',
        Status: 'LLM_ERROR',
        Exception: raw.substring(0, 500)
      });
      throw error;
    }

    let json: any;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      const error = new Error(`Parsing LLM returned invalid JSON`);
      await Logger.logBackendError('LLMParser', err as Error, {
        TransactionID: transactionId,
        Endpoint: 'parseResumeWithLLM',
        Status: 'PARSE_ERROR',
        Exception: raw.substring(0, 500)
      });
      throw error;
    }

    // Extract text content using provider-specific parsing
    const textContent = parseLLMResponse(provider, json);

    if (textContent) {
      const sections = extractSectionsFromCandidateText(textContent);
      if (sections && sections.length > 0) {
        await Logger.logInfo('LLMParser', 'Resume parsed successfully', {
          TransactionID: transactionId,
          Endpoint: 'parseResumeWithLLM',
          Status: 'SUCCESS',
          ResponsePayload: { sectionsCount: sections.length }
        });
        return sections;
      }
    }

    // Fallback: try parsing the whole response (for Google format)
    const sections = extractSectionsFromResponse(json);
    if (sections && sections.length > 0) {
      await Logger.logInfo('LLMParser', 'Resume parsed successfully (fallback)', {
        TransactionID: transactionId,
        Endpoint: 'parseResumeWithLLM',
        Status: 'SUCCESS',
        ResponsePayload: { sectionsCount: sections.length }
      });
      return sections;
    }

    const error = new Error(`Parsing LLM returned no sections`);
    await Logger.logBackendError('LLMParser', error, {
      TransactionID: transactionId,
      Endpoint: 'parseResumeWithLLM',
      Status: 'PARSE_ERROR',
      Exception: raw.substring(0, 500)
    });
    throw error;
  } catch (error) {
    await Logger.logBackendError('LLMParser', error, {
      TransactionID: transactionId,
      Endpoint: 'parseResumeWithLLM',
      Status: 'INTERNAL_ERROR'
    });
    throw error;
  }
}

export async function extractContactSectionWithLLM({ fileBase64 }: ParseArgs): Promise<ResumeSection | null> {
  const transactionId = `extract-contact-${uuid()}`;
  try {
    const apiUrl = process.env.LLM_PARSE_API_URL;
    const apiKey = process.env.LLM_PARSE_API_KEY;
    const model = process.env.LLM_PARSE_MODEL;

    if (!apiUrl || !apiKey) {
      
      return null;
    }

  // Auto-detect provider based on URL or API key format
  const provider = detectLLMProvider(apiUrl, apiKey);
  const headers = buildLLMHeaders(provider, apiKey);
  const body = buildLLMRequestBody(provider, { apiUrl, apiKey, model }, {
    prompt: contactExtractionInstructions,
    fileBase64,
    fileMimeType: 'application/pdf',
    maxTokens: 2048,
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

    const raw = await response.text();

    if (!response.ok) {
      await Logger.logBackendError('LLMParser', new Error(`Contact extraction LLM failed with status ${response.status}`), {
        TransactionID: transactionId,
        Endpoint: 'extractContactSectionWithLLM',
        Status: 'LLM_ERROR',
        Exception: raw.substring(0, 500)
      });
      return null;
    }

    let json: any;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      await Logger.logBackendError('LLMParser', err as Error, {
        TransactionID: transactionId,
        Endpoint: 'extractContactSectionWithLLM',
        Status: 'PARSE_ERROR',
        Exception: raw.substring(0, 500)
      });
      return null;
    }

    // Extract text content using provider-specific parsing
    const textContent = parseLLMResponse(provider, json);

    if (textContent) {
      const sections = extractSectionsFromCandidateText(textContent);
      if (sections && sections.length > 0) {
        const contact = sections.find((section) => section.heading.toLowerCase().includes('contact')) ?? sections[0];
        await Logger.logInfo('LLMParser', 'Contact section extracted successfully', {
          TransactionID: transactionId,
          Endpoint: 'extractContactSectionWithLLM',
          Status: 'SUCCESS'
        });
        return contact ?? null;
      }
    }

    // Fallback: try parsing the whole response (for Google format)
    const sections = extractSectionsFromResponse(json);
    if (!sections || sections.length === 0) {
      await Logger.logInfo('LLMParser', 'No contact section found', {
        TransactionID: transactionId,
        Endpoint: 'extractContactSectionWithLLM',
        Status: 'NOT_FOUND'
      });
      return null;
    }

    const contact =
      sections.find((section) => section.heading.toLowerCase().includes('contact')) ?? sections[0];

    return contact ?? null;
  } catch (error) {
    await Logger.logBackendError('LLMParser', error, {
      TransactionID: transactionId,
      Endpoint: 'extractContactSectionWithLLM',
      Status: 'INTERNAL_ERROR'
    });
    return null;
  }
}

interface ExportFormatResponse {
  sections?: Array<{
    heading?: string;
    summary?: string[];
    entries?: Array<{
      primary?: string;
      secondary?: string;
      meta?: string;
      bullets?: string[];
    }>;
  }>;
}

function extractFormattedSectionsFromCandidateText(text: string): ExportFormatResponse | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const codeBlockJson = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (codeBlockJson?.[1]) {
    try {
      return JSON.parse(codeBlockJson[1]) as ExportFormatResponse;
    } catch {
      // ignore parse error and continue
    }
  }

  const genericCodeBlock = trimmed.match(/```\s*([\s\S]*?)```/);
  if (genericCodeBlock?.[1]) {
    try {
      return JSON.parse(genericCodeBlock[1]) as ExportFormatResponse;
    } catch {
      // ignore parse error and continue
    }
  }

  try {
    return JSON.parse(trimmed) as ExportFormatResponse;
  } catch {
    // ignore parse error and continue
  }

  const blocks = extractJsonBlocks(trimmed);
  for (const block of blocks) {
    try {
      return JSON.parse(block) as ExportFormatResponse;
    } catch {
      // ignore parse error and continue
    }
  }

  return null;
}

/*export async function formatSectionsForExport(sections: ResumeSection[]): Promise<FormattedSection[]> {
  const apiUrl = process.env.LLM_PARSE_API_URL;
  const apiKey = process.env.LLM_PARSE_API_KEY;
  const model = process.env.LLM_PARSE_MODEL;

  if (!apiUrl || !apiKey) {
    throw new Error('LLM parsing configuration missing (LLM_PARSE_API_URL / LLM_PARSE_API_KEY).');
  }

  const prompt = `You will receive resume sections (heading + body). Produce a structured JSON response with:
{
  "sections": [
    {
      "heading": "Experience",
      "summary": ["Optional paragraph strings for section introductions"],
      "entries": [
        {
          "primary": "Role / Company",
          "secondary": "Additional line (e.g., company or team) if useful",
          "meta": "Dates | Location",
          "bullets": ["Achievement 1", "Achievement 2"]
        }
      ]
    }
  ]
}

Rules:
- Preserve ordering of sections and entries.
- Keep wording exactly as provided (no rewriting), only reorganise.
- Avoid labels like "Company:" or "Dates:" in the values.
- Use concise bullets (copied verbatim) under each entry.
- If a section has no structured entries, leave "entries" empty and put the text in "summary".

Sections JSON:\n${JSON.stringify(sections, null, 2)}`;

  // Auto-detect provider based on URL or API key format
  const provider = detectLLMProvider(apiUrl, apiKey);
  const headers = buildLLMHeaders(provider, apiKey);
  const body = buildLLMRequestBody(provider, { apiUrl, apiKey, model }, {
    prompt,
    maxTokens: 4096,
  });

  let attempt = 0;
  const maxAttempts = 3;
  const baseDelay = 500;
  let response: FetchResponse | null = null;

  while (attempt < maxAttempts) {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (response.status !== 503) {
      break;
    }

    attempt += 1;
    if (attempt >= maxAttempts) {
      break;
    }

    const delayMs = baseDelay * Math.pow(2, attempt - 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!response) {
    throw new Error('Formatting LLM request failed without receiving a response.');
  }

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Formatting LLM failed with status ${response.status}: ${raw}`);
  }

  let json: ExportFormatResponse | null = null;
  try {
    json = JSON.parse(raw) as ExportFormatResponse;
  } catch {
    json = null;
  }

  if (!json?.sections || !Array.isArray(json.sections)) {
    // Extract text content using provider-specific parsing
    const parsedResponse = json || JSON.parse(raw);
    const textContent = parseLLMResponse(provider, parsedResponse);

    if (textContent) {
      const extracted = extractFormattedSectionsFromCandidateText(textContent);
      if (extracted?.sections && Array.isArray(extracted.sections)) {
        json = extracted;
      }
    }

    // Fallback: try parsing Google Gemini format directly
    if (!json?.sections) {
      try {
        const parsed = parsedResponse;
        const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
        for (const candidate of candidates) {
          const parts = [
            ...(Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []),
            ...(Array.isArray(candidate?.output?.parts) ? candidate.output.parts : []),
          ];
          for (const part of parts) {
            const payloads: string[] = [];
            if (typeof part?.text === 'string') payloads.push(part.text);
            if (typeof part?.functionCall?.arguments === 'string') {
              payloads.push(part.functionCall.arguments);
            }
            for (const payload of payloads) {
              const extracted = extractFormattedSectionsFromCandidateText(payload);
              if (extracted?.sections && Array.isArray(extracted.sections)) {
                json = extracted;
                break;
              }
            }
            if (json?.sections) break;
          }
          if (json?.sections) break;
        }
      } catch {
        // ignore parse failures; will throw below if still missing
      }
    }
  }

  if (!json?.sections || !Array.isArray(json.sections)) {
    throw new Error(`Formatting LLM returned no sections. Raw response: ${raw}`);
  }

  return json.sections
    .map((section) => ({
      heading: section.heading ?? 'Section',
      summary: Array.isArray(section.summary)
        ? section.summary.map((paragraph) => (paragraph ?? '').trim()).filter(Boolean)
        : [],
      entries: Array.isArray(section.entries)
        ? section.entries.map((entry) => ({
          primary: entry.primary ?? undefined,
          secondary: entry.secondary ?? undefined,
          meta: entry.meta ?? undefined,
          bullets: Array.isArray(entry.bullets)
            ? entry.bullets.map((bullet) => (bullet ?? '').trim()).filter(Boolean)
            : [],
        }))
        : [],
    }))
    .filter(
      (section) =>
        (section.summary && section.summary.length > 0) ||
        (section.entries && section.entries.length > 0)
    );
}*/

export type { FormattedSection, FormattedSectionEntry };


