import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ScoreBreakdown {
  score: number;
  maxScore: number;
  details: string[];
  weighted: boolean;
}

interface KeywordMatch {
  keyword: string;
  category: string;
  matched: boolean;
  occurrences: number;
  locations: string[];
}

interface KeywordCoverage {
  totalKeywords: number;
  matchedKeywords: number;
  unmatchedKeywords: string[];
  keywordDetails: KeywordMatch[];
}

interface JobSpecificATSScore {
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

interface Props {
  apiBaseUrl: string;
  token: string;
  resumeId: string;
  jobId: string;
  onScoreChange?: (score: number) => void;
  refreshTrigger?: number; // Parent can trigger refresh by changing this number
}

export function JobSpecificScoreCard({
  apiBaseUrl,
  token,
  resumeId,
  jobId,
  onScoreChange,
  refreshTrigger = 0,
}: Props) {
  const [score, setScore] = useState<JobSpecificATSScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);
  const fetchInProgressRef = useRef(false);
  const lastFetchTimeRef = useRef(0);

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    [token]
  );

  // Normalize score data from API (handles both snake_case and camelCase)
  const normalizeScore = (scoreData: any): JobSpecificATSScore | null => {
    if (!scoreData || typeof scoreData !== 'object') return null;

    // Handle snake_case from database
    const overallScore = scoreData.overall_score ?? scoreData.overallScore ?? 0;
    const breakdown = scoreData.score_breakdown ?? scoreData.breakdown ?? {};
    const suggestions = scoreData.suggestions ?? [];
    const improvementAreas = scoreData.improvement_areas ?? scoreData.improvementAreas ?? [];
    const keywordCoverage = scoreData.keyword_coverage ?? scoreData.keywordCoverage ?? null;
    const comparisonScore = scoreData.comparison_score ?? scoreData.comparisonScore ?? undefined;

    // Validate that we have at least an overall score
    if (typeof overallScore !== 'number') return null;

    // Normalize keyword coverage
    const normalizedKeywordCoverage: KeywordCoverage = keywordCoverage ? {
      totalKeywords: keywordCoverage.total_keywords ?? keywordCoverage.totalKeywords ?? 0,
      matchedKeywords: keywordCoverage.matched_keywords ?? keywordCoverage.matchedKeywords ?? 0,
      unmatchedKeywords: keywordCoverage.unmatched_keywords ?? keywordCoverage.unmatchedKeywords ?? [],
      keywordDetails: keywordCoverage.keyword_details ?? keywordCoverage.keywordDetails ?? [],
    } : {
      totalKeywords: 0,
      matchedKeywords: 0,
      unmatchedKeywords: [],
      keywordDetails: [],
    };

    // Normalize breakdown structure
    const normalizedBreakdown = {
      keywordMatch: breakdown.keyword_match ?? breakdown.keywordMatch ?? { score: 0, maxScore: 0, details: [], weighted: false },
      contentQuality: breakdown.content_quality ?? breakdown.contentQuality ?? { score: 0, maxScore: 0, details: [], weighted: false },
      experienceRelevance: breakdown.experience_relevance ?? breakdown.experienceRelevance ?? { score: 0, maxScore: 0, details: [], weighted: false },
      tailoringEffectiveness: breakdown.tailoring_effectiveness ?? breakdown.tailoringEffectiveness ?? { score: 0, maxScore: 0, details: [], weighted: false },
      atsOptimization: breakdown.ats_optimization ?? breakdown.atsOptimization ?? { score: 0, maxScore: 0, details: [], weighted: false },
    };

    return {
      overallScore,
      breakdown: normalizedBreakdown,
      suggestions: Array.isArray(suggestions) ? suggestions : [],
      improvementAreas: Array.isArray(improvementAreas) ? improvementAreas : [],
      keywordCoverage: normalizedKeywordCoverage,
      comparisonScore,
    };
  };

  const fetchScore = async () => {
    // Prevent multiple simultaneous requests
    const now = Date.now();
    if (fetchInProgressRef.current || (now - lastFetchTimeRef.current < 1000)) {
      return; // Request already in progress or too soon since last request (1 second cooldown)
    }

    fetchInProgressRef.current = true;
    lastFetchTimeRef.current = now;

    try {
      setError(null);
      const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/score?jobId=${jobId}`, {
        headers: authHeaders,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 404) {
          setError(null);
          setScore(null);
          setLoading(false);
          fetchInProgressRef.current = false;
          return;
        }
        throw new Error(errorData.error || 'Failed to fetch score');
      }

      const data = await res.json();
      const normalizedScore = normalizeScore(data.score);
      
      if (normalizedScore) {
        setScore(normalizedScore);
        onScoreChange?.(normalizedScore.overallScore);
      } else {
        setScore(null);
      }
    } catch (err: any) {
      console.error('Error fetching score:', err);
      setError(err.message || 'Failed to fetch score');
    } finally {
      setLoading(false);
      fetchInProgressRef.current = false;
    }
  };

  useEffect(() => {
    if (jobId) {
      fetchScore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, jobId, apiBaseUrl]);

  // Manual refresh when refreshTrigger changes (debounced to prevent multiple simultaneous calls)
  const lastRefreshTriggerRef = useRef(0);
  useEffect(() => {
    // Only refresh if trigger actually changed and is greater than 0
    if (refreshTrigger > 0 && refreshTrigger !== lastRefreshTriggerRef.current && jobId) {
      lastRefreshTriggerRef.current = refreshTrigger;
      const timeoutId = setTimeout(() => {
        fetchScore();
      }, 1000); // Debounce: wait 1 second after trigger
      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger, jobId]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50';
    if (score >= 60) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getScoreBarColor = (score: number, maxScore: number) => {
    const percentage = (score / maxScore) * 100;
    if (percentage >= 80) return 'bg-green-500';
    if (percentage >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (!jobId) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-gray-600 text-center">
          Select a job to see your ATS score
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="animate-pulse">
          <div className="h-6 w-32 bg-gray-200 rounded mb-4"></div>
          <div className="h-12 w-24 bg-gray-200 rounded mb-4"></div>
        </div>
      </div>
    );
  }

  if (error || !score) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-gray-600">
          {error || 'Score not available. Tailor your resume first.'}
        </div>
      </div>
    );
  }

  // Validate score has required properties
  if (score.overallScore === undefined || score.overallScore === null || typeof score.overallScore !== 'number') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-gray-600">
          Invalid score data. Please try tailoring again.
        </div>
      </div>
    );
  }

  const keywordMatchPercentage = score.keywordCoverage?.totalKeywords > 0
    ? Math.round(((score.keywordCoverage?.matchedKeywords || 0) / (score.keywordCoverage?.totalKeywords || 1)) * 100)
    : 0;

  const scoreImprovement = score.comparisonScore !== undefined && score.comparisonScore !== null
    ? score.overallScore - score.comparisonScore
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">ATS Match Score</h3>
        <p className="text-xs text-gray-500">Job-specific optimization</p>
      </div>

      {/* Overall Score */}
      <div className="mb-6">
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.3 }}
            className={`inline-flex items-center justify-center w-20 h-20 rounded-full font-bold text-2xl ${getScoreColor(score.overallScore)}`}
          >
            {score.overallScore}
          </motion.div>
          {scoreImprovement !== null && scoreImprovement !== 0 && (
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-700">
                {scoreImprovement > 0 ? (
                  <span className="text-green-600">+{scoreImprovement} from baseline</span>
                ) : (
                  <span className="text-red-600">{scoreImprovement} from baseline</span>
                )}
              </div>
              <div className="text-xs text-gray-500">Baseline: {score.comparisonScore}</div>
            </div>
          )}
        </div>
        <div className="mt-2 text-sm text-gray-600">
          {score.overallScore >= 80 && 'Excellent match! Your resume aligns well with this job.'}
          {score.overallScore >= 60 && score.overallScore < 80 && 'Good match. Some improvements possible.'}
          {score.overallScore < 60 && 'Needs improvement. Focus on keyword matching.'}
        </div>
      </div>

      {/* Keyword Coverage */}
      {score.keywordCoverage && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Keyword Coverage</span>
            <span className="text-sm font-bold text-gray-900">
              {score.keywordCoverage?.matchedKeywords || 0}/{score.keywordCoverage?.totalKeywords || 0} ({keywordMatchPercentage}%)
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${keywordMatchPercentage}%` }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className={`h-3 rounded-full ${getScoreBarColor(score.keywordCoverage?.matchedKeywords || 0, score.keywordCoverage?.totalKeywords || 1)}`}
            />
          </div>
          <button
            onClick={() => setShowKeywords(!showKeywords)}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            {showKeywords ? 'Hide' : 'Show'} keyword details
          </button>
          {showKeywords && (
            <AnimatePresence>
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-3 space-y-2 text-xs"
              >
                <div>
                  <div className="font-medium text-gray-700 mb-1">Matched Keywords:</div>
                  <div className="flex flex-wrap gap-1">
                    {(score.keywordCoverage?.keywordDetails || [])
                      .filter((k: any) => k && k.matched)
                      .slice(0, 10)
                      .map((k: any, idx: number) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-green-100 text-green-800 rounded"
                        >
                          {k.keyword} ({k.occurrences}x)
                        </span>
                      ))}
                  </div>
                </div>
                {(score.keywordCoverage?.unmatchedKeywords || []).length > 0 && (
                  <div>
                    <div className="font-medium text-gray-700 mb-1">Missing Keywords:</div>
                    <div className="flex flex-wrap gap-1">
                      {(score.keywordCoverage?.unmatchedKeywords || []).slice(0, 10).map((keyword: string, idx: number) => (
                        <span key={idx} className="px-2 py-1 bg-red-100 text-red-800 rounded">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      )}

      {/* Breakdown */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left mb-4 text-sm font-medium text-gray-700 hover:text-gray-900 flex items-center justify-between"
      >
        <span>Score Breakdown</span>
        <motion.svg
          animate={{ rotate: expanded ? 180 : 0 }}
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="space-y-4 mb-4"
          >
            {score.breakdown && Object.entries(score.breakdown).map(([key, breakdown]) => {
              if (!breakdown || typeof breakdown !== 'object') return null;
              const breakdownScore = breakdown.score ?? 0;
              const breakdownMaxScore = breakdown.maxScore ?? 0;
              const breakdownDetails = Array.isArray(breakdown.details) ? breakdown.details : [];
              
              return (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  <span className="text-gray-600">
                    {Math.round(breakdownScore)}/{breakdownMaxScore}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${breakdownMaxScore > 0 ? (breakdownScore / breakdownMaxScore) * 100 : 0}%` }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className={`h-2 rounded-full ${getScoreBarColor(breakdownScore, breakdownMaxScore)}`}
                  />
                </div>
                <ul className="text-xs text-gray-600 space-y-1 ml-2">
                  {breakdownDetails.slice(0, 2).map((detail, idx) => (
                    <li key={idx} className="flex items-start">
                      <span className="mr-2">
                        {detail.startsWith('✅') ? '✓' : detail.startsWith('⚠️') ? '⚠' : '✗'}
                      </span>
                      <span>{detail.replace(/^[✅⚠️❌]/g, '').trim()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Improvement Areas */}
      {score.improvementAreas && Array.isArray(score.improvementAreas) && score.improvementAreas.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Improvement Areas</h4>
          <div className="flex flex-wrap gap-2">
            {score.improvementAreas.map((area, idx) => (
              <span key={idx} className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-lg">
                {area}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {score.suggestions && Array.isArray(score.suggestions) && score.suggestions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Suggestions</h4>
          <ul className="space-y-1 text-xs text-gray-600">
            {score.suggestions.slice(0, 3).map((suggestion, idx) => (
              <li key={idx} className="flex items-start">
                <span className="mr-2">•</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}

