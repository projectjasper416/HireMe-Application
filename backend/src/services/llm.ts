import fetch from 'node-fetch';
import type { ResumeSection } from '../types/resume';

interface TailorOptions {
  jobTitle: string;
  sections: ResumeSection[];
}

interface TailorResponse {
  tailoredSections: ResumeSection[];
  rationale: string;
}

// TDD 5 AI/LLM Service Layer: unify outbound requests to AI provider
export async function tailorResumeSections({ jobTitle, sections }: TailorOptions): Promise<TailorResponse> {
  const apiUrl = process.env.LLM_API_URL;
  const apiKey = process.env.LLM_API_KEY;

  if (apiUrl && apiKey) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ jobTitle, sections }),
    });

    if (!response.ok) {
      throw new Error('Failed to tailor resume via LLM');
    }

    const json = (await response.json()) as TailorResponse;
    return json;
  }

  // PRD 6.2 Resume Workspace: Provide deterministic fallback for demos
  const rationale = `Auto-tailored for ${jobTitle} using on-device heuristic.`;
  const tailoredSections = sections.map((section) => ({
    heading: section.heading,
    body: `${section.body}\n\n[Tailored emphasis for ${jobTitle}]`,
  }));
  return { tailoredSections, rationale };
}


