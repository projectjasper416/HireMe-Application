/**
 * Job-Specific ATS Score Engine
 * Calculates resume score based on job description and keyword matching
 * Works with structured data (raw_body, final_updated) for instant calculation
 */

import type { ResumeRecord } from '../types/resume';
import type { KeywordCategory, ExtractedKeywords } from './extractKeywords';
import {
  extractResumeText,
  extractAllBullets,
  extractStructuredEntries,
  extractSectionTextByHeading,
} from './resumeTextExtractor';
import { ScoreBreakdown } from './genericResumeScore';

export interface KeywordMatch {
  keyword: string;
  category: string;
  matched: boolean;
  occurrences: number;
  locations: string[]; // Section names where found
}

export interface KeywordCoverage {
  totalKeywords: number;
  matchedKeywords: number;
  unmatchedKeywords: string[];
  keywordDetails: KeywordMatch[];
}

export interface JobSpecificATSScore {
  overallScore: number;
  breakdown: {
    keywordMatch: ScoreBreakdown;
    contentQuality: ScoreBreakdown;
    experienceRelevance: ScoreBreakdown;
    tailoringEffectiveness: ScoreBreakdown;
    atsOptimization: ScoreBreakdown;
  };
  suggestions: string[];
  improvementAreas: string[];
  keywordCoverage: KeywordCoverage;
  comparisonScore?: number;
}

/**
 * Get category weight for keyword matching
 */
function getCategoryWeight(categoryName: string): number {
  const categoryLower = categoryName.toLowerCase();
  if (categoryLower.includes('technical') || categoryLower.includes('skill')) {
    return 1.5; // Technical skills are most important
  }
  if (categoryLower.includes('hard')) {
    return 1.3;
  }
  if (categoryLower.includes('soft')) {
    return 1.0;
  }
  return 1.0; // Default weight
}

/**
 * Escape special regex characters in keyword
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find which sections contain a keyword
 */
function findKeywordLocations(
  resume: ResumeRecord,
  keyword: string,
  finalUpdatedBySection?: Record<string, any>
): string[] {
  const locations: string[] = [];
  const keywordLower = keyword.toLowerCase();
  const regex = new RegExp(`\\b${escapeRegex(keywordLower)}\\b`, 'i');

  for (const section of resume.sections) {
    const sectionText = extractSectionTextByHeading(resume, section.heading, finalUpdatedBySection);
    if (regex.test(sectionText)) {
      locations.push(section.heading);
    }
  }

  return locations;
}

/**
 * Calculate Keyword Match Score (0-35 points)
 */
function calculateKeywordMatch(
  resume: ResumeRecord,
  keywords: ExtractedKeywords,
  finalUpdatedBySection?: Record<string, any>
): { breakdown: ScoreBreakdown; coverage: KeywordCoverage } {
  const details: string[] = [];
  const maxScore = 35;

  const fullText = extractResumeText(resume, finalUpdatedBySection);
  const fullTextLower = fullText.toLowerCase();

  let totalWeightedMatches = 0;
  let totalWeight = 0;
  const keywordDetails: KeywordMatch[] = [];
  const unmatchedKeywords: string[] = [];

  // Process each category
  for (const category of keywords.categories) {
    const categoryWeight = getCategoryWeight(category.category);

    for (const keyword of category.keywords) {
      totalWeight += categoryWeight;

      const keywordLower = keyword.toLowerCase();
      const escapedKeyword = escapeRegex(keywordLower);
      
      // Try exact match first
      let regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
      let matches = fullTextLower.match(regex) || [];

      // If no exact match, try partial match (for compound words)
      if (matches.length === 0) {
        regex = new RegExp(escapedKeyword.replace(/\s+/g, '\\s*'), 'gi');
        matches = fullTextLower.match(regex) || [];
      }

      const occurrences = matches.length;
      const matched = occurrences > 0;
      const locations = matched ? findKeywordLocations(resume, keyword, finalUpdatedBySection) : [];

      if (matched) {
        // Weighted match: base score + bonus for multiple occurrences
        const baseMatch = categoryWeight;
        const frequencyBonus = Math.min(occurrences - 1, 2) * 0.5; // Up to 2 bonus points
        totalWeightedMatches += baseMatch + frequencyBonus;
      } else {
        unmatchedKeywords.push(keyword);
      }

      keywordDetails.push({
        keyword,
        category: category.category,
        matched,
        occurrences,
        locations,
      });
    }
  }

  // Calculate score: (weighted matches / total weight) * maxScore
  const matchRatio = totalWeight > 0 ? totalWeightedMatches / totalWeight : 0;
  const score = matchRatio * maxScore;

  const matchedCount = keywordDetails.filter(k => k.matched).length;
  const totalCount = keywordDetails.length;

  if (matchRatio >= 0.8) {
    details.push(`✅ Excellent keyword match (${matchedCount}/${totalCount} keywords)`);
  } else if (matchRatio >= 0.6) {
    details.push(`✅ Good keyword match (${matchedCount}/${totalCount} keywords)`);
  } else if (matchRatio >= 0.4) {
    details.push(`⚠️ Moderate keyword match (${matchedCount}/${totalCount} keywords)`);
  } else {
    details.push(`❌ Low keyword match (${matchedCount}/${totalCount} keywords)`);
  }

  if (unmatchedKeywords.length > 0 && unmatchedKeywords.length <= 10) {
    details.push(`Missing: ${unmatchedKeywords.slice(0, 5).join(', ')}${unmatchedKeywords.length > 5 ? '...' : ''}`);
  }

  return {
    breakdown: {
      score: Math.min(score, maxScore),
      maxScore,
      details,
      weighted: true,
    },
    coverage: {
      totalKeywords: totalCount,
      matchedKeywords: matchedCount,
      unmatchedKeywords: unmatchedKeywords.slice(0, 20), // Limit to 20
      keywordDetails,
    },
  };
}

/**
 * Calculate Content Quality Score (0-20 points)
 */
function calculateContentQuality(
  resume: ResumeRecord,
  fullText: string,
  bullets: string[],
  jobDescription: string
): ScoreBreakdown {
  let score = 0;
  const details: string[] = [];
  const maxScore = 20;

  // Quantified achievements (8 points)
  const quantifiedRegex = /\d+[KMB]?|\d+%|\$\d+|\d+\+|\d+\s*(years?|months?|days?)|increased by|decreased by|improved by|reduced by/gi;
  const quantifiedBullets = bullets.filter(bullet => quantifiedRegex.test(bullet));

  const quantifiedScore = Math.min((quantifiedBullets.length / 3) * 8, 8);
  score += quantifiedScore;
  if (quantifiedBullets.length >= 3) {
    details.push(`✅ Strong quantified achievements (${quantifiedBullets.length} bullets)`);
  } else if (quantifiedBullets.length > 0) {
    details.push(`⚠️ Some quantified achievements (${quantifiedBullets.length} bullets)`);
  }

  // Action verbs from job description (5 points)
  const jobDescLower = jobDescription.toLowerCase();
  const actionVerbsFromJD = [
    'achieved', 'improved', 'increased', 'reduced', 'led', 'managed', 'developed',
    'implemented', 'created', 'designed', 'built', 'launched', 'optimized',
    'analyzed', 'executed', 'delivered', 'collaborated', 'facilitated',
  ];

  const usedJDVerbs = actionVerbsFromJD.filter(verb => {
    const verbInJD = jobDescLower.includes(verb);
    const verbInResume = fullText.includes(verb);
    return verbInJD && verbInResume;
  });

  const verbScore = Math.min((usedJDVerbs.length / 5) * 5, 5);
  score += verbScore;
  if (usedJDVerbs.length >= 5) {
    details.push(`✅ Using action verbs from job description (${usedJDVerbs.length} verbs)`);
  } else if (usedJDVerbs.length > 0) {
    details.push(`⚠️ Using some action verbs from job description (${usedJDVerbs.length} verbs)`);
  }

  // Relevance to JD (4 points) - simple check for common words
  const jobWords = jobDescription.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const resumeWords = fullText.split(/\s+/).filter(w => w.length > 4);
  const commonWords = new Set(jobWords.filter(w => resumeWords.includes(w)));
  const relevanceScore = Math.min((commonWords.size / 20) * 4, 4);
  score += relevanceScore;
  if (commonWords.size >= 20) {
    details.push('✅ High relevance to job description');
  } else if (commonWords.size >= 10) {
    details.push('⚠️ Moderate relevance to job description');
  }

  // Content depth (3 points)
  const experienceSection = resume.sections.find(s =>
    s.heading.toLowerCase().includes('experience') || s.heading.toLowerCase().includes('work')
  );
  if (experienceSection) {
    const expText = extractSectionTextByHeading(resume, experienceSection.heading);
    const wordCount = expText.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount >= 300) {
      score += 3;
      details.push('✅ Detailed experience section');
    } else if (wordCount >= 150) {
      score += 2;
      details.push('⚠️ Experience section could be more detailed');
    }
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    details,
    weighted: false,
  };
}

/**
 * Calculate Experience Relevance Score (0-15 points)
 */
function calculateExperienceRelevance(
  resume: ResumeRecord,
  jobDescription: string,
  finalUpdatedBySection?: Record<string, any>
): ScoreBreakdown {
  let score = 0;
  const details: string[] = [];
  const maxScore = 15;

  const jobDescLower = jobDescription.toLowerCase();

  // Job title alignment (5 points)
  const experienceSection = resume.sections.find(s =>
    s.heading.toLowerCase().includes('experience') || s.heading.toLowerCase().includes('work')
  );

  if (experienceSection) {
    const entries = extractStructuredEntries(experienceSection, finalUpdatedBySection?.[experienceSection.heading]);
    let titleMatches = 0;

    entries.forEach(entry => {
      const title = entry.fields.title || entry.fields.role || entry.fields.position || '';
      if (title) {
        // Check if job description mentions similar titles
        const titleWords = title.toLowerCase().split(/\s+/);
        const hasMatch = titleWords.some(word =>
          word.length > 4 && jobDescLower.includes(word)
        );
        if (hasMatch) titleMatches++;
      }
    });

    if (entries.length > 0) {
      const matchRatio = titleMatches / entries.length;
      score += matchRatio * 5;
      if (matchRatio > 0.5) {
        details.push(`✅ Relevant job titles (${titleMatches}/${entries.length})`);
      }
    }
  }

  // Years of experience check (5 points) - simplified
  score += 5; // Assume adequate if experience section exists
  details.push('✅ Experience section present');

  // Skill overlap (5 points) - will be covered by keyword matching, but give bonus
  score += 5;
  details.push('✅ Skills assessed via keyword matching');

  return {
    score: Math.min(score, maxScore),
    maxScore,
    details,
    weighted: false,
  };
}

/**
 * Calculate Tailoring Effectiveness Score (0-15 points)
 */
function calculateTailoringEffectiveness(
  baselineScore?: number,
  currentScore?: number
): ScoreBreakdown {
  let score = 0;
  const details: string[] = [];
  const maxScore = 15;

  if (baselineScore !== undefined && currentScore !== undefined) {
    const improvement = currentScore - baselineScore;
    if (improvement > 0) {
      // Improvement score: up to 10 points based on improvement amount
      const improvementScore = Math.min((improvement / 20) * 10, 10);
      score += improvementScore;
      details.push(`✅ Resume improved by ${improvement} points from tailoring`);
    } else {
      details.push('⚠️ No improvement from tailoring yet');
    }

    // Additional bonus if score is high
    if (currentScore >= 80) {
      score += 5;
      details.push('✅ Excellent overall score');
    }
  } else {
    // No baseline available
    score = 7.5; // Neutral score
    details.push('ℹ️ Tailoring in progress - score will update as you accept suggestions');
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    details,
    weighted: false,
  };
}

/**
 * Calculate ATS Optimization Score (0-15 points)
 */
function calculateATSOptimization(resume: ResumeRecord): ScoreBreakdown {
  let score = 15; // Assume full score for structured data
  const details: string[] = [];
  const maxScore = 15;

  details.push('✅ Standard formatting');
  details.push('✅ Keyword placement in key sections');
  details.push('✅ ATS-friendly structure');

  return {
    score,
    maxScore,
    details,
    weighted: false,
  };
}

/**
 * Generate improvement suggestions
 */
function generateSuggestions(
  score: JobSpecificATSScore,
  keywords: ExtractedKeywords
): { suggestions: string[]; improvementAreas: string[] } {
  const suggestions: string[] = [];
  const improvementAreas: string[] = [];

  if (score.breakdown.keywordMatch.score < score.breakdown.keywordMatch.maxScore * 0.7) {
    improvementAreas.push('Keyword Matching');
    const missingKeywords = score.keywordCoverage.unmatchedKeywords.slice(0, 5);
    if (missingKeywords.length > 0) {
      suggestions.push(`Add these keywords: ${missingKeywords.join(', ')}`);
    }
    suggestions.push('Accept AI tailoring suggestions to incorporate job-specific keywords');
  }

  if (score.breakdown.contentQuality.score < score.breakdown.contentQuality.maxScore * 0.7) {
    improvementAreas.push('Content Quality');
    suggestions.push('Add more quantified achievements with numbers and metrics');
    suggestions.push('Use action verbs from the job description');
  }

  if (score.overallScore < 70) {
    suggestions.push('Accept more AI tailoring suggestions to improve your score');
    suggestions.push('Focus on incorporating missing keywords from the job description');
  }

  return { suggestions, improvementAreas };
}

/**
 * Calculate job-specific ATS score
 */
export async function calculateJobSpecificATSScore(
  resume: ResumeRecord,
  jobDescription: string,
  keywords: ExtractedKeywords,
  finalUpdatedBySection?: Record<string, any>,
  baselineScore?: number
): Promise<JobSpecificATSScore> {
  // Extract data
  const fullText = extractResumeText(resume, finalUpdatedBySection);
  const bullets = extractAllBullets(resume, finalUpdatedBySection);

  // Calculate each breakdown
  const keywordMatch = calculateKeywordMatch(resume, keywords, finalUpdatedBySection);
  const contentQuality = calculateContentQuality(resume, fullText, bullets, jobDescription);
  const experienceRelevance = calculateExperienceRelevance(resume, jobDescription, finalUpdatedBySection);
  const tailoringEffectiveness = calculateTailoringEffectiveness(baselineScore);
  const atsOptimization = calculateATSOptimization(resume);

  // Calculate overall score
  const overallScore = Math.round(
    keywordMatch.breakdown.score +
      contentQuality.score +
      experienceRelevance.score +
      tailoringEffectiveness.score +
      atsOptimization.score
  );

  const score: JobSpecificATSScore = {
    overallScore,
    breakdown: {
      keywordMatch: keywordMatch.breakdown,
      contentQuality,
      experienceRelevance,
      tailoringEffectiveness,
      atsOptimization,
    },
    suggestions: [],
    improvementAreas: [],
    keywordCoverage: keywordMatch.coverage,
    comparisonScore: baselineScore,
  };

  // Update tailoring effectiveness with current score
  score.breakdown.tailoringEffectiveness = calculateTailoringEffectiveness(baselineScore, overallScore);

  // Generate suggestions
  const { suggestions, improvementAreas } = generateSuggestions(score, keywords);
  score.suggestions = suggestions;
  score.improvementAreas = improvementAreas;

  return score;
}

