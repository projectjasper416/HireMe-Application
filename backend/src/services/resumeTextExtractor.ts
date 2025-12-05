/**
 * Utility to extract all text content from structured resume data
 * Works with raw_body (original parsed structure) and final_updated (accepted suggestions)
 * This enables instant scoring without needing to call parser LLM
 */

import { rawBodyToText } from './rawBodyToText';
import type { ResumeRecord, ResumeSection } from '../types/resume';
import { Logger } from '../utils/Logger';
import { v4 as uuid } from 'uuid';

/**
 * Extract text from final_updated structure (array format with fieldOrder, fields, bullets)
 */
function extractFromFinalUpdated(finalUpdated: any): string {
  if (!finalUpdated) return '';

  // Handle array of entries (structured format from tailor/review)
  if (Array.isArray(finalUpdated)) {
    return finalUpdated
      .map((entry) => {
        const parts: string[] = [];

        // Extract fields in order
        if (entry.fields && Array.isArray(entry.fields)) {
          entry.fields.forEach((field: { key: string; value: any }) => {
            if (field.value !== undefined && field.value !== null && field.value !== '') {
              parts.push(String(field.value));
            }
          });
        }

        // Extract bullets
        if (entry.bullets && Array.isArray(entry.bullets)) {
          entry.bullets.forEach((bullet: string) => {
            if (bullet && bullet.trim()) {
              parts.push(bullet.trim());
            }
          });
        }

        return parts.join('\n');
      })
      .filter(Boolean)
      .join('\n\n');
  }

  // Handle object format (legacy or simple structure)
  if (typeof finalUpdated === 'object') {
    return rawBodyToText(finalUpdated);
  }

  // Handle string format
  if (typeof finalUpdated === 'string') {
    return finalUpdated;
  }

  // Log unexpected type (not null/undefined, not array, not object, not string)
  if (finalUpdated !== null && finalUpdated !== undefined) {
    const transactionId = `extract-final-updated-${uuid()}`;
    Logger.logBackendError('ResumeTextExtractor', new Error('Unexpected final_updated type in extractFromFinalUpdated'), {
      TransactionID: transactionId,
      Endpoint: 'extractFromFinalUpdated',
      Status: 'DATA_ERROR',
      Exception: `Unexpected type: ${typeof finalUpdated}`
    }).catch(() => {
      // Ignore logging errors
    });
  }

  return '';
}

/**
 * Extract all text content from a resume section
 * Prioritizes final_updated (accepted changes) over raw_body (original)
 */
function extractSectionText(section: ResumeSection, finalUpdatedBySection?: Record<string, any>): string {
  // If we have final_updated for this section, use it
  if (finalUpdatedBySection && finalUpdatedBySection[section.heading]) {
    return extractFromFinalUpdated(finalUpdatedBySection[section.heading]);
  }

  // Otherwise use raw_body if available, fallback to body
  if (section.raw_body) {
    return rawBodyToText(section.raw_body);
  }

  return section.body || '';
}

/**
 * Extract all text content from entire resume for scoring
 * Combines all sections with proper handling of final_updated
 */
export function extractResumeText(
  resume: ResumeRecord,
  finalUpdatedBySection?: Record<string, any>
): string {
  const sections: string[] = [];

  for (const section of resume.sections) {
    const sectionText = extractSectionText(section, finalUpdatedBySection);
    if (sectionText.trim()) {
      sections.push(`${section.heading}\n${sectionText}`);
    }
  }

  return sections.join('\n\n');
}

/**
 * Extract text from a specific section by heading
 */
export function extractSectionTextByHeading(
  resume: ResumeRecord,
  heading: string,
  finalUpdatedBySection?: Record<string, any>
): string {
  const section = resume.sections.find(s => s.heading === heading);
  if (!section) return '';

  return extractSectionText(section, finalUpdatedBySection);
}

/**
 * Get all bullets from a resume (for quantifying achievements, action verbs, etc.)
 * Handles both structured data (from final_updated) and plain text format
 */
export function extractAllBullets(
  resume: ResumeRecord,
  finalUpdatedBySection?: Record<string, any>
): string[] {
  const bullets: string[] = [];

  for (const section of resume.sections) {
    // First, try to extract from structured data (final_updated or raw_body)
    const finalUpdated = finalUpdatedBySection?.[section.heading];
    const structuredEntries = extractStructuredEntries(section, finalUpdated);
    
    // Extract bullets from structured entries (this is the primary source when using final_updated)
    structuredEntries.forEach(entry => {
      entry.bullets.forEach(bullet => {
        if (bullet && bullet.trim()) {
          const trimmedBullet = bullet.trim();
          // Avoid duplicates
          if (!bullets.includes(trimmedBullet)) {
            bullets.push(trimmedBullet);
          }
        }
      });
    });

    // Also extract from plain text format (for fallback or additional bullets)
    // Don't skip this even if structured entries exist, in case there are additional bullets
    const sectionText = extractSectionText(section, finalUpdatedBySection);
    
    // Extract bullet points (lines starting with •, -, *, or numbered)
    const lines = sectionText.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('•') ||
        trimmed.startsWith('-') ||
        trimmed.startsWith('*') ||
        /^\d+[\.\)]\s/.test(trimmed) // Numbered lists
      ) {
        // Remove bullet marker
        const bulletText = trimmed
          .replace(/^[•\-*]\s*/, '')
          .replace(/^\d+[\.\)]\s*/, '')
          .trim();
        if (bulletText && !bullets.includes(bulletText)) {
          bullets.push(bulletText);
        }
      }
    });
  }

  return bullets;
}

/**
 * Extract structured data entries (Experience, Education, etc.) from final_updated or raw_body
 */
export function extractStructuredEntries(
  section: ResumeSection,
  finalUpdated?: any
): Array<{ fields: Record<string, string>; bullets: string[] }> {
  const entries: Array<{ fields: Record<string, string>; bullets: string[] }> = [];

  // Use final_updated if available
  const data = finalUpdated || section.raw_body;
  
  if (!data) return entries;

  // Handle array format (final_updated structure)
  if (Array.isArray(data)) {
    data.forEach((entry: any) => {
      const fields: Record<string, string> = {};
      const bullets: string[] = [];

      // Extract fields
      if (entry.fields && Array.isArray(entry.fields)) {
        entry.fields.forEach((field: { key: string; value: any }) => {
          if (field.value !== undefined && field.value !== null) {
            fields[field.key] = String(field.value);
          }
        });
      }

      // Extract bullets
      if (entry.bullets && Array.isArray(entry.bullets)) {
        entry.bullets.forEach((bullet: string) => {
          if (bullet && bullet.trim()) {
            bullets.push(bullet.trim());
          }
        });
      }

      entries.push({ fields, bullets });
    });
  }
  // Handle object format (raw_body structure)
  else if (typeof data === 'object' && data.entries && Array.isArray(data.entries)) {
    data.entries.forEach((entry: any) => {
      const fields: Record<string, string> = {};
      const bullets: string[] = [];

      // Extract all non-bullet fields
      Object.keys(entry).forEach(key => {
        if (key !== 'bullets' && key !== 'summary' && entry[key] !== undefined && entry[key] !== null) {
          fields[key] = String(entry[key]);
        }
      });

      // Extract bullets
      if (entry.bullets && Array.isArray(entry.bullets)) {
        entry.bullets.forEach((bullet: string) => {
          if (bullet && bullet.trim()) {
            bullets.push(bullet.trim());
          }
        });
      }

      entries.push({ fields, bullets });
    });
  }
  // Log unexpected structure (not array, not object with entries, but has data)
  else if (data !== null && data !== undefined) {
    const transactionId = `extract-structured-entries-${uuid()}`;
    Logger.logBackendError('ResumeTextExtractor', new Error('Unexpected data structure in extractStructuredEntries'), {
      TransactionID: transactionId,
      Endpoint: 'extractStructuredEntries',
      Status: 'DATA_ERROR',
      Exception: `Unexpected structure type: ${typeof data}, isArray: ${Array.isArray(data)}, hasEntries: ${typeof data === 'object' && 'entries' in data}`
    }).catch(() => {
      // Ignore logging errors
    });
  }

  return entries;
}

/**
 * Get contact information from resume
 */
export function extractContactInfo(
  resume: ResumeRecord,
  finalUpdatedBySection?: Record<string, any>
): {
  name?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  address?: string;
  website?: string;
} {
  const contactSection = resume.sections.find(s =>
    s.heading.toLowerCase().includes('contact') ||
    s.heading.toLowerCase().includes('header') ||
    s.heading.toLowerCase().includes('personal')
  );

  if (!contactSection) return {};

  const contactText = extractSectionText(contactSection, finalUpdatedBySection).toLowerCase();
  const contactData: any = {};

  // Extract email
  const emailMatch = contactText.match(/[\w\.-]+@[\w\.-]+\.\w+/);
  if (emailMatch) {
    // Get original case from section
    const originalText = extractSectionText(contactSection, finalUpdatedBySection);
    const originalEmailMatch = originalText.match(/[\w\.-]+@[\w\.-]+\.\w+/i);
    contactData.email = originalEmailMatch ? originalEmailMatch[0] : emailMatch[0];
  }

  // Extract phone
  const phoneMatch = contactText.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (phoneMatch) {
    contactData.phone = phoneMatch[0];
  }

  // Extract LinkedIn
  const linkedinMatch = contactText.match(/linkedin\.com\/in\/[\w-]+/);
  if (linkedinMatch) {
    contactData.linkedin = linkedinMatch[0];
  }

  // Try to extract from structured data
  if (contactSection.raw_body && typeof contactSection.raw_body === 'object') {
    const rawBody = contactSection.raw_body as any;
    if (rawBody.name) contactData.name = String(rawBody.name);
    if (rawBody.email) contactData.email = String(rawBody.email);
    if (rawBody.phone) contactData.phone = String(rawBody.phone);
    if (rawBody.linkedin) contactData.linkedin = String(rawBody.linkedin);
    if (rawBody.address) contactData.address = String(rawBody.address);
    if (rawBody.website) contactData.website = String(rawBody.website);
  }

  return contactData;
}

