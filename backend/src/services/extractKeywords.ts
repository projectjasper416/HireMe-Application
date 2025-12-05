import fetch from 'node-fetch';
import { detectLLMProvider, buildLLMHeaders, buildLLMRequestBody, parseLLMResponse } from './llmProvider';
import { Logger } from '../utils/Logger';
import { v4 as uuid } from 'uuid';

export interface KeywordCategory {
  category: string;
  keywords: string[];
}

export interface ExtractedKeywords {
  categories: KeywordCategory[];
}

const systemInstructions = `You are an expert ATS (Applicant Tracking System) optimization specialist. Your task is to extract and categorize keywords from job descriptions that will maximize ATS compatibility and resume matching scores.

Extract keywords that are:
1. **ATS-friendly**: Use exact terminology that ATS systems recognize and commonly match
2. **Industry-standard**: Common terms used in job postings and resumes within the specific industry/role
3. **Skill-specific**: Technical skills, tools, methodologies, competencies, certifications, and qualifications
4. **Action-oriented**: Verbs and phrases that indicate capabilities and achievements

**Categorization Guidelines:**
- Categorize keywords into the following types:
  - **Technical Skills**: Programming languages, software, platforms, frameworks, databases, APIs, tools, technologies, etc
  - **Hard Skills**: Specific competencies, methodologies, certifications, standards, protocols, processes, techniques, etc
  - **Soft Skills**: Communication, teamwork, problem-solving, leadership, collaboration, adaptability, interpersonal skills,etc

- Group related keywords together logically within these 3 categories
- Each category should contain 5-7 relevant keywords



Return ONLY valid JSON in this exact format:
{
  "categories": [
    {
      "category": "Broad Category Name (ATS-optimized)",
      "keywords": ["keyword1", "keyword2", "keyword3"]
    },
    {
      "category": "Another Broad Category",
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
  ]
}

Example output structure (use broad categories, adapt based on the job description):
{
  "categories": [
    {
      "category": "Technical Skills & Tools",
      "keywords": ["Python", "JavaScript", "AWS", "Docker", "Kubernetes", "React", "SQL", "MongoDB"]
    },
    {
      "category": "Hard Skills & Methodologies",
      "keywords": ["Agile", "Scrum", "CI/CD", "Microservices", "RESTful APIs", "DevOps", "Test-Driven Development"]
    },
    {
      "category": "Soft Skills & Leadership",
      "keywords": ["Team Leadership", "Cross-functional Collaboration", "Problem Solving", "Communication", "Stakeholder Management"]
    }
  ]
}

Important:
- Use these 3 broad category names (Technical Skills, Hard Skills, Soft Skills) not specific ones (Programming Languages, Cloud Platforms, etc.)
- Extract 5-7 keywords per category based on what's most relevant it is not mandatory to have 5-7 keywords per category if there are no that many relevant keywords which are required
- Prioritize keywords that appear multiple times or are emphasized in the job description
- Include both exact terms and common variations/synonyms
- Focus on skills, tools, and competencies that can be verified and measured
- Exclude generic terms like "experience", "ability", "knowledge" (unless they're part of a specific certification or methodology)
- Return only the JSON object, no additional text, markdown, or explanations`;

export async function extractKeywordsFromJobDescription(
  jobDescription: string
): Promise<ExtractedKeywords> {
  const transactionId = `extract-keywords-${uuid()}`;
  try {
    const apiUrl = process.env.LLM_KEYWORDS_API_URL || process.env.LLM_REVIEW_API_URL || process.env.LLM_PARSE_API_URL;
    const apiKey = process.env.LLM_KEYWORDS_API_KEY || process.env.LLM_REVIEW_API_KEY || process.env.LLM_PARSE_API_KEY;
    const model = process.env.LLM_KEYWORDS_MODEL || process.env.LLM_REVIEW_MODEL || process.env.LLM_PARSE_MODEL;


    if (!apiUrl || !apiKey) {
      const error = new Error('LLM keywords extraction configuration missing (LLM_KEYWORDS_API_URL / LLM_KEYWORDS_API_KEY). You can also use LLM_REVIEW_API_URL/KEY or LLM_PARSE_API_URL/KEY as fallback.');
      await Logger.logBackendError('ExtractKeywords', error, {
        TransactionID: transactionId,
        Endpoint: 'extractKeywordsFromJobDescription',
        Status: 'CONFIG_ERROR'
      });
      throw error;
    }

  const provider = detectLLMProvider(apiUrl, apiKey);
  const headers = buildLLMHeaders(provider, apiKey);

  const prompt = `${systemInstructions}\n\nJob Description:\n"""\n${jobDescription}\n"""\n\nExtract and categorize keywords that will boost ATS score. Return only the JSON object.`;

  const body = buildLLMRequestBody(provider, { apiUrl, apiKey, model }, {
    prompt,
    maxTokens: 2048,
  });

    let response: any;
    let raw: string;

    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      raw = await response.text();

      if (!response.ok) {
        await Logger.logBackendError('ExtractKeywords', new Error(`LLM failed with status ${response.status}`), {
          TransactionID: transactionId,
          Endpoint: 'extractKeywordsFromJobDescription',
          Status: 'LLM_ERROR',
          Exception: raw.substring(0, 500)
        });
        throw new Error(`Keywords extraction LLM failed with status ${response.status}: ${raw}`);
      }
    } catch (err: any) {
      if (err.message?.includes('503') || err.message?.includes('overload')) {
        await Logger.logInfo('ExtractKeywords', 'Retrying after overload', {
          TransactionID: transactionId,
          Endpoint: 'extractKeywordsFromJobDescription',
          Status: 'RETRY'
        });
        // Retry once for overloaded services
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          raw = await response.text();
          if (!response.ok) {
            await Logger.logBackendError('ExtractKeywords', new Error(`LLM retry failed with status ${response.status}`), {
              TransactionID: transactionId,
              Endpoint: 'extractKeywordsFromJobDescription',
              Status: 'LLM_ERROR',
              Exception: raw.substring(0, 500)
            });
            throw new Error(`Keywords extraction LLM failed with status ${response.status}: ${raw}`);
          }
        } catch (retryErr: any) {
          await Logger.logBackendError('ExtractKeywords', retryErr, {
            TransactionID: transactionId,
            Endpoint: 'extractKeywordsFromJobDescription',
            Status: 'LLM_ERROR',
            Exception: 'Retry failed'
          });
          throw new Error(`Keywords extraction LLM request failed: ${retryErr.message}`);
        }
      } else {
        await Logger.logBackendError('ExtractKeywords', err, {
          TransactionID: transactionId,
          Endpoint: 'extractKeywordsFromJobDescription',
          Status: 'LLM_ERROR',
          Exception: 'Request failed'
        });
        throw new Error(`Keywords extraction LLM request failed: ${err.message}`);
      }
    }

    let json: any;
    try {
      json = JSON.parse(raw);
    } catch (parseErr) {
      // Try to extract JSON from code blocks or wrapped responses
      const jsonMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || raw.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        try {
          json = JSON.parse(jsonMatch[1]);
        } catch (e) {
          const error = new Error(`Keywords extraction LLM returned invalid JSON: ${raw.substring(0, 500)}`);
          await Logger.logBackendError('ExtractKeywords', error, {
            TransactionID: transactionId,
            Endpoint: 'extractKeywordsFromJobDescription',
            Status: 'PARSE_ERROR',
            Exception: 'Failed to parse JSON from response'
          });
          throw error;
        }
      } else {
        const error = new Error(`Keywords extraction LLM returned invalid JSON: ${raw.substring(0, 500)}`);
        await Logger.logBackendError('ExtractKeywords', error, {
          TransactionID: transactionId,
          Endpoint: 'extractKeywordsFromJobDescription',
          Status: 'PARSE_ERROR',
          Exception: 'No JSON found in response'
        });
        throw error;
      }
    }

    // Extract text content from provider-specific response structure
    const textContent = parseLLMResponse(provider, json);

    // Try to parse the text content as JSON
    let extractedData: ExtractedKeywords;
    try {
      extractedData = JSON.parse(textContent);
    } catch (e) {
      // Try to extract JSON from code blocks
      const jsonMatch = textContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || textContent.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[1]);
      } else {
        const error = new Error(`Keywords extraction LLM did not return valid JSON structure: ${textContent.substring(0, 500)}`);
        await Logger.logBackendError('ExtractKeywords', error, {
          TransactionID: transactionId,
          Endpoint: 'extractKeywordsFromJobDescription',
          Status: 'PARSE_ERROR',
          Exception: 'Failed to parse text content as JSON'
        });
        throw error;
      }
    }

    // Validate structure
    if (!extractedData.categories || !Array.isArray(extractedData.categories)) {
      const error = new Error(`Keywords extraction LLM returned invalid structure. Expected categories array: ${JSON.stringify(extractedData)}`);
      await Logger.logBackendError('ExtractKeywords', error, {
        TransactionID: transactionId,
        Endpoint: 'extractKeywordsFromJobDescription',
        Status: 'VALIDATION_ERROR',
        Exception: 'Invalid structure - missing categories array'
      });
      throw error;
    }

    // Ensure all categories have the required structure
    const validatedCategories: KeywordCategory[] = extractedData.categories
      .filter((cat: any) => cat && cat.category && Array.isArray(cat.keywords))
      .map((cat: any) => ({
        category: String(cat.category),
        keywords: Array.isArray(cat.keywords) ? cat.keywords.map((k: any) => String(k)) : [],
      }));

    if (validatedCategories.length === 0) {
      const error = new Error(`Keywords extraction LLM returned no valid categories: ${JSON.stringify(extractedData)}`);
      await Logger.logBackendError('ExtractKeywords', error, {
        TransactionID: transactionId,
        Endpoint: 'extractKeywordsFromJobDescription',
        Status: 'VALIDATION_ERROR',
        Exception: 'No valid categories found'
      });
      throw error;
    }

    await Logger.logInfo('ExtractKeywords', 'Keywords extracted successfully', {
      TransactionID: transactionId,
      Endpoint: 'extractKeywordsFromJobDescription',
      Status: 'SUCCESS',
      ResponsePayload: { categoriesCount: validatedCategories.length }
    });

    return {
      categories: validatedCategories,
    };
  } catch (error) {
    await Logger.logBackendError('ExtractKeywords', error, {
      TransactionID: transactionId,
      Endpoint: 'extractKeywordsFromJobDescription',
      Status: 'INTERNAL_ERROR'
    });
    throw error;
  }
}

