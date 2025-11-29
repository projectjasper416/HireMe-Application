/**
 * Word-level diff utility for showing inline changes
 * Shows changed words with strikethrough (red) and new words with underline (green)
 */

import React from 'react';

export interface WordDiffToken {
    type: 'unchanged' | 'deleted' | 'inserted';
    text: string;
}

/**
 * Strip markdown formatting from text (e.g., **bold**, *italic*, etc.)
 */
function stripMarkdown(text: string): string {
    if (!text) return text;
    // Remove markdown bold: **text** or __text__
    return text
        .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold**
        .replace(/\*([^*]+)\*/g, '$1')      // *italic* (but not **bold**)
        .replace(/__([^_]+)__/g, '$1')      // __bold__
        .replace(/_([^_]+)_/g, '$1')       // _italic_ (but not __bold__)
        .replace(/~~([^~]+)~~/g, '$1');     // ~~strikethrough~~
}

/**
 * Simple word-level diff algorithm
 * Compares two texts and returns tokens indicating what changed
 */
export function wordDiff(original: string, suggested: string): WordDiffToken[] {
    if (!original && !suggested) return [];
    
    // Strip markdown formatting from both texts
    const cleanOriginal = stripMarkdown(original);
    const cleanSuggested = stripMarkdown(suggested);
    
    if (!original) return [{ type: 'inserted', text: cleanSuggested }];
    if (!suggested) return [{ type: 'deleted', text: cleanOriginal }];

    // Normalize whitespace
    const origWords = cleanOriginal.trim().split(/\s+/);
    const suggWords = cleanSuggested.trim().split(/\s+/);

    // If texts are identical, return as unchanged
    if (cleanOriginal.trim() === cleanSuggested.trim()) {
        return [{ type: 'unchanged', text: cleanOriginal }];
    }

    // Calculate similarity - if very different, treat as full rewrite
    const similarity = calculateSimilarity(origWords, suggWords);
    const isFullRewrite = similarity < 0.6; // Less than 30% similar = full rewrite

    if (isFullRewrite) {
        // Full rewrite: show original with strikethrough, suggested with underline
        // Return as separate tokens so they can be rendered on separate lines if needed
        return [
            { type: 'deleted', text: cleanOriginal },
            { type: 'inserted', text: cleanSuggested },
        ];
    }

    // Word-level diff using longest common subsequence
    return computeWordDiff(origWords, suggWords);
}

/**
 * Calculate similarity between two word arrays (0-1)
 */
function calculateSimilarity(words1: string[], words2: string[]): number {
    if (words1.length === 0 && words2.length === 0) return 1;
    if (words1.length === 0 || words2.length === 0) return 0;

    const set1 = new Set(words1.map(w => w.toLowerCase()));
    const set2 = new Set(words2.map(w => w.toLowerCase()));

    const intersection = new Set([...set1].filter(w => set2.has(w)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
}

/**
 * Compute word-level diff using a simple algorithm
 */
function computeWordDiff(origWords: string[], suggWords: string[]): WordDiffToken[] {
    const tokens: WordDiffToken[] = [];
    let i = 0;
    let j = 0;

    while (i < origWords.length || j < suggWords.length) {
        if (i >= origWords.length) {
            // Only suggested words left
            tokens.push({ type: 'inserted', text: suggWords[j] });
            j++;
        } else if (j >= suggWords.length) {
            // Only original words left
            tokens.push({ type: 'deleted', text: origWords[i] });
            i++;
        } else if (origWords[i].toLowerCase() === suggWords[j].toLowerCase()) {
            // Words match
            tokens.push({ type: 'unchanged', text: origWords[i] });
            i++;
            j++;
        } else {
            // Words don't match - look ahead to find best match
            const lookAhead = 5; // Look ahead up to 5 words
            let foundMatch = false;

            // Check if current suggested word appears soon in original
            for (let k = i + 1; k < Math.min(i + lookAhead, origWords.length); k++) {
                if (origWords[k].toLowerCase() === suggWords[j].toLowerCase()) {
                    // Found match ahead - mark words in between as deleted
                    for (let m = i; m < k; m++) {
                        tokens.push({ type: 'deleted', text: origWords[m] });
                    }
                    tokens.push({ type: 'unchanged', text: origWords[k] });
                    i = k + 1;
                    j++;
                    foundMatch = true;
                    break;
                }
            }

            if (!foundMatch) {
                // Check if current original word appears soon in suggested
                for (let k = j + 1; k < Math.min(j + lookAhead, suggWords.length); k++) {
                    if (suggWords[k].toLowerCase() === origWords[i].toLowerCase()) {
                        // Found match ahead - mark words in between as inserted
                        for (let m = j; m < k; m++) {
                            tokens.push({ type: 'inserted', text: suggWords[m] });
                        }
                        tokens.push({ type: 'unchanged', text: suggWords[k] });
                        j = k + 1;
                        i++;
                        foundMatch = true;
                        break;
                    }
                }
            }

            if (!foundMatch) {
                // No match found - treat as replacement
                tokens.push({ type: 'deleted', text: origWords[i] });
                tokens.push({ type: 'inserted', text: suggWords[j] });
                i++;
                j++;
            }
        }
    }

    return tokens;
}

/**
 * Render word diff tokens as React elements
 * Handles full rewrites (shows on separate lines) and inline changes
 */
export function renderWordDiff(tokens: WordDiffToken[]): React.ReactNode[] {
    // Check if this is a full rewrite (only deleted and inserted tokens, no unchanged)
    const hasUnchanged = tokens.some(t => t.type === 'unchanged');
    const isFullRewrite = !hasUnchanged && tokens.length === 2 && 
        tokens[0].type === 'deleted' && tokens[1].type === 'inserted';

    if (isFullRewrite) {
        // Full rewrite: show on separate lines
        return [
            <div key="deleted-full" style={{ marginBottom: '4px' }}>
                <span
                    style={{
                        textDecoration: 'line-through',
                        color: '#dc2626',
                        backgroundColor: '#fee2e2',
                        padding: '2px 4px',
                        borderRadius: '4px',
                    }}
                >
                    {tokens[0].text}
                </span>
            </div>,
            <div key="inserted-full">
                <span
                    style={{
                        textDecoration: 'underline',
                        textDecorationColor: '#16a34a',
                        textDecorationThickness: '2px',
                        color: '#16a34a',
                        backgroundColor: '#dcfce7',
                        padding: '2px 4px',
                        borderRadius: '4px',
                    }}
                >
                    {tokens[1].text}
                </span>
            </div>,
        ];
    }

    // Inline word-level changes
    return tokens.map((token, index) => {
        const key = `diff-${index}-${token.type}`;

        if (token.type === 'unchanged') {
            return <span key={key}>{token.text} </span>;
        } else if (token.type === 'deleted') {
            return (
                <span
                    key={key}
                    style={{
                        textDecoration: 'line-through',
                        color: '#dc2626',
                        backgroundColor: '#fee2e2',
                        padding: '0 2px',
                        borderRadius: '2px',
                    }}
                >
                    {token.text}{' '}
                </span>
            );
        } else {
            // inserted
            return (
                <span
                    key={key}
                    style={{
                        textDecoration: 'underline',
                        textDecorationColor: '#16a34a',
                        textDecorationThickness: '2px',
                        color: '#16a34a',
                        backgroundColor: '#dcfce7',
                        padding: '0 2px',
                        borderRadius: '2px',
                    }}
                >
                    {token.text}{' '}
                </span>
            );
        }
    });
}

