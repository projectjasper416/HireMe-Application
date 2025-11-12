import fetch from 'node-fetch';
import type { ResumeSection } from '../types/resume';

interface ParseArgs {
  fileBase64: string;
}

interface RawSection {
  heading?: string;
  body?: unknown;
}

const parsingInstructions = `You are an expert ATS resume parser.
- Extract sections from the resume and return JSON with a "sections" array.
- ALWAYS include a first section named "Contact Information" containing key/value pairs for name, email, phone, LinkedIn/Profile URL when available.
- Keep other sections such as Summary, Experience, Education, Skills, Projects, Certifications, etc.
- Do not merge multiple resume parts into a single section; preserve ordering from the resume.
- For structured data (addresses, job bullets, etc.), use arrays or nested objects where appropriate.`;

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
      const rawBody = section?.body ?? null;
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
  const apiUrl = process.env.LLM_PARSE_API_URL;
  const apiKey = process.env.LLM_PARSE_API_KEY;
  const model = process.env.LLM_PARSE_MODEL;

  if (!apiUrl || !apiKey) {
    throw new Error('LLM parsing configuration missing (LLM_PARSE_API_URL / LLM_PARSE_API_KEY).');
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      ...(model ? { model } : {}),
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: parsingInstructions,
            },
            {
              text: 'Parse the attached resume into structured sections. Return JSON with `sections`, each having `heading` and `body`.',
            },
            {
              inline_data: {
                mime_type: 'application/pdf',
                data: fileBase64,
              },
            },
          ],
        },
      ],
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Parsing LLM failed with status ${response.status}: ${raw}`);
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Parsing LLM returned invalid JSON: ${raw}`);
  }

  const sections = extractSectionsFromResponse(json);
  if (!sections) {
    throw new Error(`Parsing LLM returned no sections. Raw response: ${raw}`);
  }

  return sections;
}

export async function extractContactSectionWithLLM({ fileBase64 }: ParseArgs): Promise<ResumeSection | null> {
  const apiUrl = process.env.LLM_PARSE_API_URL;
  const apiKey = process.env.LLM_PARSE_API_KEY;
  const model = process.env.LLM_PARSE_MODEL;

  if (!apiUrl || !apiKey) {
    throw new Error('LLM parsing configuration missing (LLM_PARSE_API_URL / LLM_PARSE_API_KEY).');
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      ...(model ? { model } : {}),
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: contactExtractionInstructions,
            },
            {
              inline_data: {
                mime_type: 'application/pdf',
                data: fileBase64,
              },
            },
          ],
        },
      ],
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Parsing LLM failed with status ${response.status}: ${raw}`);
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Parsing LLM returned invalid JSON: ${raw}`);
  }

  const sections = extractSectionsFromResponse(json);
  if (!sections || sections.length === 0) {
    return null;
  }

  const contact =
    sections.find((section) => section.heading.toLowerCase().includes('contact')) ?? sections[0];
  return contact ?? null;
}


