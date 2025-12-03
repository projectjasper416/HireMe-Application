import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ScoreBreakdown {
  score: number;
  maxScore: number;
  details: string[];
  weighted: boolean;
}

interface GenericResumeScore {
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

interface Props {
  apiBaseUrl: string;
  token: string;
  resumeId: string;
  onScoreChange?: (score: number) => void;
  refreshTrigger?: number; // Parent can trigger refresh by changing this number
}

export function GenericResumeScoreCard({ apiBaseUrl, token, resumeId, onScoreChange, refreshTrigger = 0 }: Props) {
  const [score, setScore] = useState<GenericResumeScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fetchInProgressRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  
  // Early return if no resumeId
  if (!resumeId) {
    return null;
  }

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    [token]
  );

  // Normalize score data from API (handles both snake_case and camelCase)
  const normalizeScore = (scoreData: any): GenericResumeScore | null => {
    if (!scoreData || typeof scoreData !== 'object') return null;

    // Handle snake_case from database
    const overallScore = scoreData.overall_score ?? scoreData.overallScore ?? 0;
    const breakdown = scoreData.score_breakdown ?? scoreData.breakdown ?? {};
    const suggestions = scoreData.suggestions ?? [];
    const improvementAreas = scoreData.improvement_areas ?? scoreData.improvementAreas ?? [];

    // Validate that we have at least an overall score
    if (typeof overallScore !== 'number') return null;

    return {
      overallScore,
      breakdown,
      suggestions: Array.isArray(suggestions) ? suggestions : [],
      improvementAreas: Array.isArray(improvementAreas) ? improvementAreas : [],
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
      // Only fetch - never calculate on GET request
      const res = await fetch(`${apiBaseUrl}/resumes/${resumeId}/score`, {
        headers: authHeaders,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        // If it's a 404, score doesn't exist yet - that's okay
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
    fetchScore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, apiBaseUrl]);

  // Manual refresh when refreshTrigger changes (debounced to prevent multiple simultaneous calls)
  const lastRefreshTriggerRef = useRef(0);
  useEffect(() => {
    // Only refresh if trigger actually changed and is greater than 0
    if (refreshTrigger > 0 && refreshTrigger !== lastRefreshTriggerRef.current) {
      lastRefreshTriggerRef.current = refreshTrigger;
      const timeoutId = setTimeout(() => {
        fetchScore();
      }, 1000); // Debounce: wait 1 second after trigger
      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

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

  if (!loading && (error || !score)) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-gray-600">
          {error || 'Score not available. Run AI Review first to calculate your resume score.'}
        </div>
      </div>
    );
  }

  // Safety check: ensure score exists and has required properties
  if (!score || typeof score.overallScore !== 'number') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-gray-600">
          Score not available. Run AI Review first to calculate your resume score.
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Resume Score</h3>
        <p className="text-xs text-gray-500">Overall ATS-friendly quality</p>
      </div>

      {/* Overall Score */}
      <div className="mb-6">
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3 }}
          className={`inline-flex items-center justify-center w-20 h-20 rounded-full font-bold text-2xl ${getScoreColor(score.overallScore)}`}
        >
          {score.overallScore}
        </motion.div>
        <div className="mt-2 text-sm text-gray-600">
          {score.overallScore >= 80 && 'Excellent! Your resume is well-optimized.'}
          {score.overallScore >= 60 && score.overallScore < 80 && 'Good. Some improvements possible.'}
          {score.overallScore < 60 && 'Needs improvement. Review suggestions below.'}
        </div>
      </div>

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
            {score.breakdown && typeof score.breakdown === 'object' && Object.entries(score.breakdown).map(([key, breakdown]: [string, any]) => {
              if (!breakdown || typeof breakdown !== 'object') return null;
              
              const breakdownScore = breakdown.score ?? 0;
              const breakdownMaxScore = breakdown.maxScore ?? 1;
              const breakdownDetails = breakdown.details ?? [];
              
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
                  {Array.isArray(breakdownDetails) && breakdownDetails.length > 0 && (
                    <ul className="text-xs text-gray-600 space-y-1 ml-2">
                      {breakdownDetails.slice(0, 2).map((detail: string, idx: number) => (
                        <li key={idx} className="flex items-start">
                          <span className="mr-2">{detail?.startsWith('✅') ? '✓' : detail?.startsWith('⚠️') ? '⚠' : '✗'}</span>
                          <span>{String(detail || '').replace(/^[✅⚠️❌]/g, '').trim()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
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
              <span
                key={idx}
                className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-lg"
              >
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

