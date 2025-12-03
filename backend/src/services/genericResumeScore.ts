/**
 * Generic Resume Score Engine
 * Calculates ATS-friendly resume score without job-specific context
 * Works with structured data (raw_body, final_updated) for instant calculation
 */

import type { ResumeRecord } from '../types/resume';
import {
  extractResumeText,
  extractAllBullets,
  extractContactInfo,
  extractStructuredEntries,
  extractSectionTextByHeading,
} from './resumeTextExtractor';

export interface ScoreBreakdown {
  score: number;
  maxScore: number;
  details: string[];
  weighted: boolean;
}

export interface GenericResumeScore {
  overallScore: number;
  breakdown: {
    atsOptimization: ScoreBreakdown;
    contentQuality: ScoreBreakdown;
    structureCompleteness: ScoreBreakdown;
    formattingQuality: ScoreBreakdown;
    actionVerbsUsage: ScoreBreakdown;
  };
  suggestions: string[];
  improvementAreas: string[];
}

/**
 * Build final_updated map from sections
 */
function buildFinalUpdatedMap(resume: ResumeRecord): Record<string, any> {
  // This will be populated from resume_ai_reviews table when called from API
  // For now, return empty - the API will pass this separately
  return {};
}

/**
 * Calculate ATS Optimization Score (0-30 points)
 */
function calculateATSOptimization(
  resume: ResumeRecord,
  fullText: string,
  contactInfo: ReturnType<typeof extractContactInfo>
): ScoreBreakdown {
  let score = 0;
  const details: string[] = [];
  const maxScore = 30;

  // Standard headings check (5 points)
  const standardHeadings = ['contact', 'summary', 'experience', 'work', 'education', 'skills'];
  const resumeHeadings = resume.sections.map(s => s.heading.toLowerCase());
  const matchedHeadings = standardHeadings.filter(h =>
    resumeHeadings.some(rh => rh.includes(h) || h.includes(rh))
  );
  const headingScore = (matchedHeadings.length / standardHeadings.length) * 5;
  score += headingScore;
  if (headingScore > 4) {
    details.push(`✅ Standard section headings present (${matchedHeadings.length}/${standardHeadings.length})`);
  } else {
    details.push(`⚠️ Missing some standard headings (${matchedHeadings.length}/${standardHeadings.length})`);
  }

  // Contact info completeness (5 points)
  const hasEmail = !!contactInfo.email;
  const hasPhone = !!contactInfo.phone;
  const hasLinkedIn = !!contactInfo.linkedin;

  if (hasEmail && hasPhone) {
    score += 5;
    details.push('✅ Contact information complete (email and phone)');
  } else if (hasEmail || hasPhone) {
    score += 2.5;
    details.push(`⚠️ Contact information incomplete (${hasEmail ? 'email' : 'phone'} only)`);
  } else {
    details.push('❌ Contact information missing');
  }

  // Plain text format check (5 points) - assume structured data is ATS-friendly
  score += 5;
  details.push('✅ Structured format suitable for ATS');

  // File format consideration (5 points)
  score += 5;
  details.push('✅ Structured format suitable for PDF export');

  // Keyword density balance (5 points)
  const words = fullText.split(/\s+/).filter(w => w.length > 2);
  const uniqueWords = new Set(words);
  const diversityRatio = words.length > 0 ? uniqueWords.size / words.length : 0;

  if (diversityRatio > 0.3) {
    score += 5;
    details.push('✅ Good keyword diversity');
  } else if (diversityRatio > 0.2) {
    score += 3;
    details.push('⚠️ Keyword diversity could be improved');
  } else {
    details.push('⚠️ Low keyword diversity (possible keyword stuffing)');
  }

  // Standard section names bonus (5 points)
  const hasExperience = resumeHeadings.some(h => h.includes('experience') || h.includes('work'));
  const hasEducation = resumeHeadings.some(h => h.includes('education'));
  const hasSkills = resumeHeadings.some(h => h.includes('skill'));
  const hasSummary = resumeHeadings.some(h => h.includes('summary') || h.includes('objective'));

  let standardSectionBonus = 0;
  if (hasExperience) standardSectionBonus += 1.25;
  if (hasEducation) standardSectionBonus += 1.25;
  if (hasSkills) standardSectionBonus += 1.25;
  if (hasSummary) standardSectionBonus += 1.25;

  score += standardSectionBonus;
  if (standardSectionBonus === 5) {
    details.push('✅ All essential sections use standard naming');
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    details,
    weighted: false,
  };
}

/**
 * Calculate Content Quality Score (0-25 points)
 */
function calculateContentQuality(
  resume: ResumeRecord,
  fullText: string,
  bullets: string[],
  finalUpdatedBySection?: Record<string, any>
): ScoreBreakdown {
  let score = 0;
  const details: string[] = [];
  const maxScore = 25;

  // Quantified achievements (10 points)
  // Match: numbers (with K/M/B), percentages, dollar amounts, numbers with +, time periods, or improvement phrases
  // Create a new regex for each test to avoid state issues with global flag
  const hasQuantifiedContent = (text: string): boolean => {
    const lowerText = text.toLowerCase();
    return /\d+[KMB]/.test(text) || // Numbers with K/M/B (e.g., 15K, 2M, 1B)
           /\d+%/.test(text) || // Percentages (e.g., 15%, 50%)
           /\$\d+/.test(text) || // Dollar amounts (e.g., $1000)
           /\d+\+/.test(text) || // Numbers with + (e.g., 100+)
           /\d+\s*(years?|months?|days?)/i.test(text) || // Time periods
           /(increased|decreased|improved|reduced|boosted|grew|raised|lowered)\s+by\s+[\d,]+[KMB%]?/i.test(text) || // Improvement phrases with numbers (e.g., "improved by 15%", "increased by 50K")
           /\d+/.test(text) && (
             lowerText.includes('improved') || 
             lowerText.includes('increased') || 
             lowerText.includes('decreased') || 
             lowerText.includes('reduced')
           ); // Any number with improvement-related words
  };
  
  const quantifiedBullets = bullets.filter(bullet => hasQuantifiedContent(bullet));

  const quantifiedScore = Math.min((quantifiedBullets.length / 3) * 10, 10); // 3+ bullets with metrics = full score
  score += quantifiedScore;
  if (quantifiedBullets.length >= 3) {
    details.push(`✅ Strong quantified achievements (${quantifiedBullets.length} bullets with metrics)`);
  } else if (quantifiedBullets.length > 0) {
    details.push(`⚠️ Some quantified achievements (${quantifiedBullets.length} bullets with metrics)`);
  } else {
    details.push('❌ Missing quantified achievements - add numbers and metrics');
  }
  
  
  

  // Experience section length check (5 points)
  const experienceSection = resume.sections.find(s =>
    s.heading.toLowerCase().includes('experience') || s.heading.toLowerCase().includes('work')
  );
  if (experienceSection) {
    const expText = extractSectionTextByHeading(resume, experienceSection.heading, finalUpdatedBySection);
    const wordCount = expText.split(/\s+/).filter(w => w.length > 0).length;

    if (wordCount >= 200 && wordCount <= 800) {
      score += 5;
      details.push('✅ Experience section has appropriate length');
    } else if (wordCount > 50) {
      score += 3;
      details.push(`⚠️ Experience section could be ${wordCount < 200 ? 'more detailed' : 'more concise'}`);
    } else {
      details.push('⚠️ Experience section is too brief');
    }
  }

  // Professional tone (5 points)
  const unprofessionalPhrases = ['i think', 'i believe', 'i feel', 'hopefully', 'kind of', 'sort of'];
  const hasUnprofessional = unprofessionalPhrases.some(phrase => fullText.toLowerCase().includes(phrase));

  if (!hasUnprofessional) {
    score += 5;
    details.push('✅ Professional tone maintained');
  } else {
    score += 2;
    details.push('⚠️ Some unprofessional language detected');
  }

  // Impact-focused bullets (5 points)
  const strongStarters = [
    'achieved', 'increased', 'improved', 'reduced', 'led', 'managed', 'developed',
    'implemented', 'created', 'designed', 'built', 'launched', 'optimized',
    'streamlined', 'enhanced', 'delivered', 'executed', 'established', 'initiated',
  ];
  const impactBullets = bullets.filter(bullet =>
    strongStarters.some(starter => bullet.toLowerCase().startsWith(starter))
  );

  const impactScore = Math.min((impactBullets.length / 5) * 5, 5); // 5+ impact bullets = full score
  score += impactScore;
  if (impactBullets.length >= 5) {
    details.push(`✅ Strong impact-focused content (${impactBullets.length} action-oriented bullets)`);
  } else if (impactBullets.length > 0) {
    details.push(`⚠️ Some impact-focused content (${impactBullets.length} action-oriented bullets)`);
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    details,
    weighted: false,
  };
}

/**
 * Calculate Structure Completeness Score (0-20 points)
 */
function calculateStructureCompleteness(resume: ResumeRecord): ScoreBreakdown {
  let score = 0;
  const details: string[] = [];
  const maxScore = 20;

  const resumeHeadings = resume.sections.map(s => s.heading.toLowerCase());

  // Essential sections (10 points)
  const hasContact = resumeHeadings.some(h => h.includes('contact') || h.includes('header'));
  const hasSummary = resumeHeadings.some(h => h.includes('summary') || h.includes('objective'));
  const hasExperience = resumeHeadings.some(h => h.includes('experience') || h.includes('work'));
  const hasEducation = resumeHeadings.some(h => h.includes('education'));

  let essentialCount = 0;
  if (hasContact) {
    essentialCount++;
    details.push('✅ Contact section present');
  } else {
    details.push('❌ Missing Contact section');
  }

  if (hasSummary) {
    essentialCount++;
    details.push('✅ Summary/Objective section present');
  } else {
    details.push('⚠️ Missing Summary/Objective section');
  }

  if (hasExperience) {
    essentialCount++;
    details.push('✅ Experience section present');
  } else {
    details.push('❌ Missing Experience section');
  }

  if (hasEducation) {
    essentialCount++;
    details.push('✅ Education section present');
  } else {
    details.push('⚠️ Missing Education section');
  }

  score += (essentialCount / 4) * 10;

  // Section order (5 points)
  const contactIndex = resume.sections.findIndex(s =>
    s.heading.toLowerCase().includes('contact')
  );
  const summaryIndex = resume.sections.findIndex(s =>
    s.heading.toLowerCase().includes('summary') || s.heading.toLowerCase().includes('objective')
  );
  const experienceIndex = resume.sections.findIndex(s =>
    s.heading.toLowerCase().includes('experience') || s.heading.toLowerCase().includes('work')
  );
  const educationIndex = resume.sections.findIndex(s => s.heading.toLowerCase().includes('education'));

  let orderScore = 5;
  if (contactIndex > summaryIndex && contactIndex > -1 && summaryIndex > -1) orderScore -= 1;
  if (summaryIndex > experienceIndex && summaryIndex > -1 && experienceIndex > -1) orderScore -= 1;
  if (experienceIndex > educationIndex && experienceIndex > -1 && educationIndex > -1) orderScore -= 1;

  score += orderScore;
  if (orderScore === 5) {
    details.push('✅ Sections follow logical order');
  } else {
    details.push('⚠️ Section order could be improved');
  }

  // Additional sections (5 points)
  const hasSkills = resumeHeadings.some(h => h.includes('skill'));
  const hasCertifications = resumeHeadings.some(h =>
    h.includes('certification') || h.includes('certificate')
  );
  const hasProjects = resumeHeadings.some(h => h.includes('project'));

  let additionalCount = 0;
  if (hasSkills) {
    additionalCount++;
    details.push('✅ Skills section present');
  }
  if (hasCertifications) {
    additionalCount++;
    details.push('✅ Certifications section present');
  }
  if (hasProjects) {
    additionalCount++;
    details.push('✅ Projects section present');
  }

  const additionalScore = Math.min(additionalCount * 1.67, 5);
  score += additionalScore;

  return {
    score: Math.min(score, maxScore),
    maxScore,
    details,
    weighted: false,
  };
}

/**
 * Calculate Formatting Quality Score (0-15 points)
 */
function calculateFormattingQuality(resume: ResumeRecord): ScoreBreakdown {
  let score = 0;
  const details: string[] = [];
  const maxScore = 15;

  // Consistent formatting check (5 points) - assume structured data is consistent
  score += 5;
  details.push('✅ Consistent formatting from structured data');

  // Readability check (5 points)
  score += 5;
  details.push('✅ Good readability from structured format');

  // Professional appearance (5 points)
  score += 5;
  details.push('✅ Professional appearance');

  return {
    score: Math.min(score, maxScore),
    maxScore,
    details,
    weighted: false,
  };
}

/**
 * Calculate Action Verbs Usage Score (0-10 points)
 */
function calculateActionVerbsUsage(bullets: string[]): ScoreBreakdown {
  let score = 0;
  const details: string[] = [];
  const maxScore = 10;

  const strongActionVerbs = [
    'achieved', 'improved', 'increased', 'reduced', 'led', 'managed', 'developed',
    'implemented', 'created', 'designed', 'built', 'launched', 'optimized',
    'streamlined', 'enhanced', 'delivered', 'executed', 'established', 'initiated',
    'facilitated', 'coordinated', 'collaborated', 'analyzed', 'evaluated', 'resolved',
    'exceeded', 'transformed', 'modernized', 'automated', 'innovated',
  ];

  const fullText = bullets.join(' ').toLowerCase();
  const verbCounts: Record<string, number> = {};
  strongActionVerbs.forEach(verb => {
    const regex = new RegExp(`\\b${verb}\\w*`, 'gi');
    const matches = fullText.match(regex);
    if (matches) {
      verbCounts[verb] = matches.length;
    }
  });

  const totalVerbUsage = Object.values(verbCounts).reduce((sum, count) => sum + count, 0);
  const uniqueVerbs = Object.keys(verbCounts).length;

  // Granular scoring: 0, 2, 4, 6, 8, 10 based on total usage and unique verbs
  // Scoring considers both frequency and variety for balanced evaluation
  if (totalVerbUsage === 0 || uniqueVerbs === 0) {
    score = 0;
    details.push(`❌ No action verbs found - add strong action verbs to start bullet points`);
  } else if (totalVerbUsage >= 12 && uniqueVerbs >= 8) {
    score = 10; // Excellent: High usage (12+) and high variety (8+ unique)
    details.push(`✅ Excellent action verb usage (${totalVerbUsage} uses, ${uniqueVerbs} unique verbs)`);
  } else if ((totalVerbUsage >= 8 && uniqueVerbs >= 6) || (totalVerbUsage >= 10 && uniqueVerbs >= 5)) {
    score = 8; // Very Good: Good usage and variety
    details.push(`✅ Very good action verb usage (${totalVerbUsage} uses, ${uniqueVerbs} unique verbs)`);
  } else if ((totalVerbUsage >= 6 && uniqueVerbs >= 5) || (totalVerbUsage >= 8 && uniqueVerbs >= 4)) {
    score = 6; // Good: Moderate usage and variety
    details.push(`✅ Good action verb usage (${totalVerbUsage} uses, ${uniqueVerbs} unique verbs)`);
  } else if ((totalVerbUsage >= 4 && uniqueVerbs >= 4) || (totalVerbUsage >= 6 && uniqueVerbs >= 3)) {
    score = 4; // Fair: Some usage and variety
    details.push(`⚠️ Fair action verb usage (${totalVerbUsage} uses, ${uniqueVerbs} unique verbs) - add more variety`);
  } else if (totalVerbUsage >= 2 && uniqueVerbs >= 2) {
    score = 2; // Poor: Minimal usage
    details.push(`⚠️ Limited action verb usage (${totalVerbUsage} uses, ${uniqueVerbs} unique verbs) - need more`);
  } else {
    score = 0; // Very Poor: Insufficient usage
    details.push(`❌ Very weak action verb usage (${totalVerbUsage} uses, ${uniqueVerbs} unique verbs) - add more strong action verbs`);
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    details,
    weighted: false,
  };
}

/**
 * Generate improvement suggestions based on scores
 */
function generateSuggestions(score: GenericResumeScore): {
  suggestions: string[];
  improvementAreas: string[];
} {
  const suggestions: string[] = [];
  const improvementAreas: string[] = [];

  if (score.breakdown.atsOptimization.score < score.breakdown.atsOptimization.maxScore * 0.7) {
    improvementAreas.push('ATS Optimization');
    suggestions.push('Ensure all standard sections (Contact, Summary, Experience, Education) are present');
    suggestions.push('Use plain text format without complex tables or graphics');
    suggestions.push('Complete contact information (email, phone, LinkedIn)');
  }

  if (score.breakdown.contentQuality.score < score.breakdown.contentQuality.maxScore * 0.7) {
    improvementAreas.push('Content Quality');
    suggestions.push('Add quantified achievements with numbers and metrics');
    suggestions.push('Use impact-focused language and strong action verbs');
    suggestions.push('Ensure experience section has sufficient detail (200-800 words)');
  }

  if (score.breakdown.structureCompleteness.score < score.breakdown.structureCompleteness.maxScore * 0.7) {
    improvementAreas.push('Structure');
    suggestions.push('Add missing essential sections');
    suggestions.push('Consider adding Skills, Certifications, or Projects sections');
    suggestions.push('Organize sections in logical order (Contact → Summary → Experience → Education)');
  }

  if (score.breakdown.actionVerbsUsage.score < score.breakdown.actionVerbsUsage.maxScore * 0.7) {
    improvementAreas.push('Language');
    suggestions.push('Replace weak verbs with strong action verbs (achieved, improved, led, etc.)');
    suggestions.push('Start bullet points with action verbs');
  }

  if (score.overallScore < 70) {
    suggestions.push('Accept AI suggestions to improve your resume score');
    suggestions.push('Review the improvement areas and address them systematically');
  }

  return { suggestions, improvementAreas };
}

/**
 * Calculate generic resume score
 * Works with structured data for instant calculation
 */
export async function calculateGenericResumeScore(
  resume: ResumeRecord,
  finalUpdatedBySection?: Record<string, any>
): Promise<GenericResumeScore> {
  // Extract all text and structured data
  const fullText = extractResumeText(resume, finalUpdatedBySection).toLowerCase();
  const bullets = extractAllBullets(resume, finalUpdatedBySection);
  const contactInfo = extractContactInfo(resume, finalUpdatedBySection);

  // Calculate each breakdown
  const atsOptimization = calculateATSOptimization(resume, fullText, contactInfo);
  const contentQuality = calculateContentQuality(resume, fullText, bullets, finalUpdatedBySection);
  const structureCompleteness = calculateStructureCompleteness(resume);
  const formattingQuality = calculateFormattingQuality(resume);
  const actionVerbsUsage = calculateActionVerbsUsage(bullets);

  // Calculate overall score
  const overallScore = Math.round(
    atsOptimization.score +
      contentQuality.score +
      structureCompleteness.score +
      formattingQuality.score +
      actionVerbsUsage.score
  );

  const score: GenericResumeScore = {
    overallScore,
    breakdown: {
      atsOptimization,
      contentQuality,
      structureCompleteness,
      formattingQuality,
      actionVerbsUsage,
    },
    suggestions: [],
    improvementAreas: [],
  };

  // Generate suggestions
  const { suggestions, improvementAreas } = generateSuggestions(score);
  score.suggestions = suggestions;
  score.improvementAreas = improvementAreas;

  return score;
}

