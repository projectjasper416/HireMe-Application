import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import Handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import type { ResumeSection } from '../types/resume';

interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  file: string;
  preview?: string;
}

interface ContactInfo {
  name?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  website?: string;
  address?: string;
  other: string[];
}

interface SectionEntryRenderable {
  primary?: string;
  secondary?: string;
  meta?: string;
  bullets: string[];
}

interface SectionRenderable {
  heading: string;
  summary: string[];
  entries: SectionEntryRenderable[];
  bullets: string[];
}

interface ExportPayload {
  contact: ContactInfo;
  sections: SectionRenderable[];
  generatedAt: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_ROOT = path.resolve(__dirname, '../../templates');
const TEMPLATE_META_FILE = path.join(TEMPLATE_ROOT, 'templates.json');

let cachedTemplates: TemplateMeta[] | null = null;

export async function listResumeTemplates(): Promise<TemplateMeta[]> {
  if (cachedTemplates) return cachedTemplates;
  const raw = await readFile(TEMPLATE_META_FILE, 'utf8');
  cachedTemplates = JSON.parse(raw) as TemplateMeta[];
  return cachedTemplates!;
}

function normaliseLine(line: string): string {
  return line.replace(/^[\s\u2022•*-]+/, '').replace(/\s+/g, ' ').trim();
}

function buildContactInfo(section: ResumeSection | undefined): ContactInfo {
  if (!section) {
    return { other: [] };
  }

  const info: ContactInfo = { other: [] };
  const lines = section.body.split(/\r?\n/).map((line) => normaliseLine(line)).filter(Boolean);
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phoneRegex = /\+?[0-9][0-9\s\-().]{7,}/;
  const linkedinRegex = /linkedin\.com\/[A-Za-z0-9\-_/]+/i;
  const urlRegex = /https?:\/\/[^\s)]+/i;

  for (const line of lines) {
    if (!info.email) {
      const match = line.match(emailRegex);
      if (match) {
        info.email = match[0];
        continue;
      }
    }

    if (!info.phone) {
      const match = line.match(phoneRegex);
      if (match) {
        info.phone = match[0].replace(/\s{2,}/g, ' ').trim();
        continue;
      }
    }

    if (!info.linkedin) {
      const linkedinMatch = line.match(linkedinRegex);
      if (linkedinMatch) {
        info.linkedin = linkedinMatch[0];
        continue;
      }
      const urlMatch = line.match(urlRegex);
      if (urlMatch && urlMatch[0].toLowerCase().includes('linkedin')) {
        info.linkedin = urlMatch[0];
        continue;
      }
    }

    const [rawKey, ...rest] = line.split(':');
    if (rest.length) {
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (!info.name && ['name', 'full name'].includes(key)) {
        info.name = value;
        continue;
      }
      if (!info.email && key === 'email') {
        info.email = value;
        continue;
      }
      if (!info.phone && key === 'phone') {
        info.phone = value;
        continue;
      }
      if (!info.linkedin && key.includes('linkedin')) {
        info.linkedin = value;
        continue;
      }
      if (!info.address && key.includes('address')) {
        info.address = value;
        continue;
      }
      if (!info.website && key.includes('website')) {
        info.website = value;
        continue;
      }
    }

    info.other.push(line);
  }

  if (!info.name && lines.length > 0) {
    info.name = lines[0];
  }

  return info;
}

function parseRawBody(rawBody: unknown): { summary: string[]; entries: SectionEntryRenderable[] } | null {
  if (!rawBody || typeof rawBody !== 'object') {
    return null;
  }

  const summary: string[] = [];
  const entries: SectionEntryRenderable[] = [];

  // If rawBody is an array, treat each item as an entry
  if (Array.isArray(rawBody)) {
    //console.log('[parseRawBody] Processing array with', rawBody.length, 'items');
    for (const item of rawBody) {
      if (typeof item === 'object' && item !== null) {
        //console.log('[parseRawBody] Raw item:', JSON.stringify(item, null, 2));
        const entry: SectionEntryRenderable = { bullets: [] };
        const obj = item as Record<string, unknown>;

        // Extract fields in CORRECT VISUAL ORDER
        // For Experience: company, title, dates, location
        // For Education: institution, degree, dates, location, gpa

        // Primary field (company, institution, project name, etc.)
        if (obj.company) {
          entry.primary = String(obj.company);
        } else if (obj.institution || obj.school || obj.university) {
          entry.primary = String(obj.institution || obj.school || obj.university);
        } else if (obj.name || obj.projectName) {
          entry.primary = String(obj.name || obj.projectName);
        } else if (obj.primary) {
          entry.primary = String(obj.primary);
        }

        // Secondary field (title, degree, role)
        if (obj.title || obj.role) {
          entry.secondary = String(obj.title || obj.role);
        } else if (obj.degree || obj.major) {
          entry.secondary = String(obj.degree || obj.major);
        } else if (obj.secondary) {
          entry.secondary = String(obj.secondary);
        }

        // Meta field (dates, location, gpa combined)
        const metaParts: string[] = [];
        if (obj.dates || obj.date || obj.graduationDate) {
          metaParts.push(String(obj.dates || obj.date || obj.graduationDate));
        }
        if (obj.location) {
          metaParts.push(String(obj.location));
        }
        if (obj.gpa || obj.cgpa) {
          metaParts.push(`GPA: ${obj.gpa || obj.cgpa}`);
        }
        if (metaParts.length > 0) {
          entry.meta = metaParts.join(' | ');
        }

        // Handle bullets/achievements/description
        if (Array.isArray(obj.bullets)) {
          entry.bullets = obj.bullets.map((b) => normaliseLine(String(b)));
        } else if (Array.isArray(obj.achievements)) {
          entry.bullets = obj.achievements.map((a) => normaliseLine(String(a)));
        } else if (Array.isArray(obj.details)) {
          entry.bullets = obj.details.map((d) => normaliseLine(String(d)));
        } else if (obj.description) {
          const desc = String(obj.description);
          // Split description into bullets if it contains newlines or bullet-like patterns
          if (desc.includes('\n') || desc.includes('•') || desc.includes('-')) {
            entry.bullets = desc.split(/\r?\n/).map((line) => normaliseLine(line)).filter(Boolean);
          } else {
            entry.bullets = [normaliseLine(desc)];
          }
        }

        // If we have at least primary or bullets, add as entry
        if (entry.primary || entry.bullets.length > 0) {
          //console.log('[parseRawBody] Entry:', JSON.stringify(entry, null, 2));
          entries.push(entry);
        }
      } else if (typeof item === 'string') {
        summary.push(normaliseLine(item));
      }
    }
    return { summary, entries };
  }

  // If rawBody is an object, check for common structures
  const obj = rawBody as Record<string, unknown>;

  // Check for entries array
  if (Array.isArray(obj.entries)) {
    for (const item of obj.entries) {
      if (typeof item === 'object' && item !== null) {
        const entry: SectionEntryRenderable = { bullets: [] };
        const entryObj = item as Record<string, unknown>;
        if (entryObj.primary) entry.primary = String(entryObj.primary);
        if (entryObj.secondary) entry.secondary = String(entryObj.secondary);
        if (entryObj.meta) entry.meta = String(entryObj.meta);
        if (Array.isArray(entryObj.bullets)) {
          entry.bullets = entryObj.bullets.map((b) => normaliseLine(String(b)));
        }
        entries.push(entry);
      }
    }
  }

  // Check for summary/text (for text-only sections)
  if (obj.summary && typeof obj.summary === 'string') {
    summary.push(normaliseLine(obj.summary));
  } else if (obj.text && typeof obj.text === 'string') {
    summary.push(normaliseLine(obj.text));
  } else if (typeof obj === 'string') {
    // If the whole object is a string, treat as summary
    summary.push(normaliseLine(String(obj)));
  }

  return entries.length > 0 || summary.length > 0 ? { summary, entries } : null;
}

function parseSectionBody(body: string, rawBody?: unknown): { summary: string[]; entries: SectionEntryRenderable[] } {
  // Try to use raw_body first if available
  if (rawBody) {
    const parsed = parseRawBody(rawBody);
    if (parsed && (parsed.entries.length > 0 || parsed.summary.length > 0)) {
      return parsed;
    }
  }

  // Fallback to text parsing
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const summary: string[] = [];
  const entries: SectionEntryRenderable[] = [];
  let currentEntry: SectionEntryRenderable | null = null;
  let currentBullets: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const normalized = normaliseLine(line);
    const nextLine = i < lines.length - 1 ? lines[i + 1] : null;

    // Check if this looks like a job/education entry header (company/title pattern)
    // Pattern: "Company Name — Title" or "Title at Company" or "Company | Title"
    const entryPattern = /^(.+?)\s*(?:—|–|-|at|\/|\|)\s*(.+)$/;
    const datePattern = /(\d{4}|\w+\s*'?\d{2})\s*(?:-|–|—|to)\s*(\w+\s*'?\d{2}|Present|Current)/i;
    const dateOnlyPattern = /^(\w+\s*'?\d{2}|\d{4})\s*(?:-|–|—|to)\s*(\w+\s*'?\d{2}|Present|Current|Now)$/i;

    // Pattern to detect company/school names (all caps or title case, often standalone)
    const companyNamePattern = /^[A-Z][A-Za-z\s&.,-]+$/;
    const isLikelyCompanyName = companyNamePattern.test(line) && line.length > 3 && line.length < 50;

    // Check if line contains dates (likely meta info)
    const dateMatch = line.match(datePattern) || line.match(dateOnlyPattern);

    // Check if this is a bullet point
    const isBullet = /^[\u2022•*\-]\s+/.test(line) || /^\d+\.\s+/.test(line);

    // Check if next line is a date (indicates this might be a new entry header)
    const nextIsDate = nextLine ? (datePattern.test(nextLine) || dateOnlyPattern.test(nextLine)) : false;

    if (isBullet) {
      // Add to current entry's bullets, or create a new entry if none exists
      if (!currentEntry) {
        currentEntry = { bullets: [] };
        entries.push(currentEntry);
      }
      currentBullets.push(normalized);
    } else if (dateMatch && !currentEntry) {
      // Date line with no current entry - might be start of new entry
      currentEntry = { meta: line.trim(), bullets: [] };
      entries.push(currentEntry);
    } else if (entryPattern.test(line)) {
      // This looks like a job/education entry header
      // Save previous entry if exists
      if (currentEntry) {
        currentEntry.bullets = [...currentBullets];
        currentBullets = [];
      }

      const match = line.match(entryPattern);
      if (match) {
        const [, part1, part2] = match;
        // Try to determine which is company/org and which is title
        // Usually company comes first, then title
        currentEntry = {
          primary: part1.trim(),
          secondary: part2.trim(),
          bullets: [],
        };
        entries.push(currentEntry);
      }
    } else if (isLikelyCompanyName && !currentEntry?.primary && nextIsDate) {
      // This looks like a company/school name followed by a date - new entry
      if (currentEntry) {
        currentEntry.bullets = [...currentBullets];
        currentBullets = [];
      }
      currentEntry = {
        primary: normalized,
        bullets: [],
      };
      entries.push(currentEntry);
    } else if (line.length > 0) {
      // Regular text line
      if (currentEntry) {
        // If we have an entry, this might be additional context or a bullet
        if (line.length < 100 && !line.includes('.') && !isBullet) {
          // Short line without period - might be secondary info or meta
          if (!currentEntry.secondary && !dateMatch) {
            currentEntry.secondary = normalized;
          } else if (!currentEntry.meta && !dateMatch) {
            currentEntry.meta = normalized;
          } else {
            // Add as bullet if it's not already set
            currentBullets.push(normalized);
          }
        } else {
          // Longer line - treat as bullet/description
          currentBullets.push(normalized);
        }
      } else {
        // No current entry - this is summary text
        summary.push(normalized);
      }
    }
  }

  // Finalize last entry
  if (currentEntry) {
    currentEntry.bullets = [...currentBullets];
  }

  return { summary, entries };
}

function formatSectionsForExport(sections: ResumeSection[]): SectionRenderable[] {
  // Sections that should only have summary text, not entries
  const summaryOnlySections = ['summary', 'objective', 'profile', 'about', 'overview', 'introduction'];

  return sections
    .filter((section) => !section.heading.toLowerCase().includes('contact'))
    .map((section) => {
      const headingLower = section.heading.toLowerCase();
      const isSummaryOnly = summaryOnlySections.some((key) => headingLower.includes(key));

      // For summary-only sections, force summary text only
      if (isSummaryOnly) {
        const lines = section.body.split(/\r?\n/).map((line) => normaliseLine(line)).filter(Boolean);
        return {
          heading: section.heading,
          summary: lines.length > 0 ? lines : [section.body.trim()],
          entries: [],
          bullets: [],
        };
      }

      const { summary, entries } = parseSectionBody(section.body, section.raw_body);

      // For sections with no parsed content, use body as summary
      if (entries.length === 0 && summary.length === 0) {
        const lines = section.body.split(/\r?\n/).map((line) => normaliseLine(line)).filter(Boolean);
        return {
          heading: section.heading,
          summary: lines.length > 0 ? lines : [section.body.trim()],
          entries: [],
          bullets: [],
        };
      }

      return {
        heading: section.heading,
        summary,
        entries: entries.map((entry) => ({
          primary: entry.primary,
          secondary: entry.secondary,
          meta: entry.meta,
          bullets: entry.bullets.map((bullet) => normaliseLine(bullet)),
        })),
        bullets: [],
      };
    })
    .filter((section) => {
      // Only filter out completely empty sections (no summary, no entries, no bullets)
      return section.summary.length > 0 || section.entries.length > 0 || section.bullets.length > 0;
    });
}

function buildExportPayload(sections: ResumeSection[]): ExportPayload {
  const contactIdx = sections.findIndex((section) =>
    section.heading.toLowerCase().includes('contact')
  );
  const contactSection = contactIdx !== -1 ? sections[contactIdx] : undefined;

  const contact = buildContactInfo(contactSection);
  const contentSections = formatSectionsForExport(sections);

  return {
    contact,
    sections: contentSections,
    generatedAt: new Date().toLocaleString(),
  };
}

async function compileTemplate(templateId: string, data: ExportPayload): Promise<string> {
  const templates = await listResumeTemplates();
  const templateMeta = templates.find((meta) => meta.id === templateId);
  if (!templateMeta) {
    throw new Error(`Template "${templateId}" not found`);
  }

  const templatePath = path.join(TEMPLATE_ROOT, templateMeta.file);
  const rawTemplate = await readFile(templatePath, 'utf8');
  const template = Handlebars.compile(rawTemplate);
  return template(data);
}

export async function renderResumePdf(
  sections: ResumeSection[],
  templateId: string
): Promise<Buffer> {
  const payload = buildExportPayload(sections);
  const html = await compileTemplate(templateId, payload);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1cm', bottom: '1cm', left: '1.2cm', right: '1.2cm' },
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

export type { TemplateMeta };


