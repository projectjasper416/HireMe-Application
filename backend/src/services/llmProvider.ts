/**
 * Centralized LLM Provider Detection and Request/Response Handling
 * Automatically detects provider (OpenAI, Google Gemini, or Anthropic Claude) based on API URL or key format
 * Provides unified interface for making LLM requests regardless of provider
 */

export type LLMProvider = 'openai' | 'google' | 'anthropic';

export interface LLMRequestConfig {
  apiUrl: string;
  apiKey: string;
  model?: string;
}

export interface LLMRequestOptions {
  prompt: string;
  fileBase64?: string;
  fileMimeType?: string;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  raw: any;
}

/**
 * Detects LLM provider based on API URL or API key format
 */
export function detectLLMProvider(apiUrl: string, apiKey: string): LLMProvider {
  const urlLower = apiUrl.toLowerCase();
  
  // Check URL first (most reliable)
  if (urlLower.includes('openai') || urlLower.includes('api.openai.com') || urlLower.includes('azure.openai.com')) {
    return 'openai';
  }
  if (urlLower.includes('anthropic') || urlLower.includes('claude') || urlLower.includes('api.anthropic.com')) {
    return 'anthropic';
  }
  if (urlLower.includes('google') || urlLower.includes('gemini') || urlLower.includes('generativelanguage.googleapis.com')) {
    return 'google';
  }
  
  // Check API key format as fallback
  // OpenAI keys start with 'sk-' (but not 'sk-ant-')
  // Anthropic keys start with 'sk-ant-'
  // Google keys are typically shorter and alphanumeric (no 'sk-' prefix)
  if (apiKey.startsWith('sk-ant-')) {
    return 'anthropic';
  }
  if (apiKey.startsWith('sk-') && !apiKey.startsWith('sk-ant-')) {
    return 'openai';
  }
  
  // Default to Google (most common)
  return 'google';
}

/**
 * Builds request headers based on provider
 */
export function buildLLMHeaders(provider: LLMProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (provider === 'openai') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    // Google
    headers['x-goog-api-key'] = apiKey;
  }

  return headers;
}

/**
 * Builds request body based on provider
 */
export function buildLLMRequestBody(
  provider: LLMProvider,
  config: LLMRequestConfig,
  options: LLMRequestOptions
): any {
  const { model, apiKey } = config;
  const { prompt, fileBase64, fileMimeType = 'application/pdf', maxTokens } = options;

  if (provider === 'openai') {
    const messages: any[] = [
      {
        role: 'user',
        content: [] as any[],
      },
    ];

    // Add text content
    if (prompt) {
      messages[0].content.push({
        type: 'text',
        text: prompt,
      });
    }

    // Add file if provided
    // Note: OpenAI supports images in vision models (gpt-4-vision, gpt-4o, etc.)
    // For PDFs, they need to be converted to images or use a different approach
    if (fileBase64) {
      if (fileMimeType.startsWith('image/')) {
        // Image support for vision models
        messages[0].content.push({
          type: 'image_url',
          image_url: {
            url: `data:${fileMimeType};base64,${fileBase64}`,
          },
        });
      } else {
        // For PDFs, we'll include as text with a note that it needs conversion
        // In practice, PDFs should be converted to images for OpenAI vision models
        messages[0].content.push({
          type: 'text',
          text: `[Note: PDF file provided but OpenAI requires image format. Please convert PDF to images for vision models.]`,
        });
      }
    }

    return {
      ...(model ? { model } : { model: 'gpt-4o' }),
      messages,
      max_tokens: maxTokens || 4096,
    };
  } else if (provider === 'anthropic') {
    const content: any[] = [
      {
        type: 'text',
        text: prompt,
      },
    ];

    // Add file if provided
    // Note: Anthropic's API may not support PDFs directly. If you encounter errors,
    // consider using Google Gemini API (LLM_PARSE_API_URL with 'google' or 'gemini' in the URL)
    // or convert PDFs to images first.
    if (fileBase64) {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: fileMimeType,
          data: fileBase64,
        },
      });
    }

    return {
      ...(model ? { model } : { model: 'claude-3-5-sonnet-20241022' }),
      max_tokens: maxTokens || 4096,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    };
  } else {
    // Google Gemini format
    const parts: any[] = [
      {
        text: prompt,
      },
    ];

    // Add file if provided
    if (fileBase64) {
      parts.push({
        inline_data: {
          mime_type: fileMimeType,
          data: fileBase64,
        },
      });
    }

    return {
      ...(model ? { model } : {}),
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
    };
  }
}

/**
 * Parses LLM response based on provider
 */
export function parseLLMResponse(provider: LLMProvider, json: any): string {
  if (provider === 'openai') {
    // OpenAI returns: { choices: [{ message: { content: "..." } }] }
    const choices = Array.isArray(json?.choices) ? json.choices : [];
    for (const choice of choices) {
      if (choice?.message?.content) {
        return String(choice.message.content);
      }
    }
    return '';
  } else if (provider === 'anthropic') {
    // Anthropic returns: { content: [{ type: "text", text: "..." }] }
    const contentArray = json?.content || [];
    let textContent = '';
    for (const item of contentArray) {
      if (item.type === 'text' && item.text) {
        textContent += item.text;
      }
    }
    return textContent;
  } else {
    // Google Gemini format
    const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
    for (const candidate of candidates) {
      const contentParts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      const outputParts = Array.isArray(candidate?.output?.parts) ? candidate.output.parts : [];
      const parts = [...contentParts, ...outputParts];

      for (const part of parts) {
        if (typeof part?.text === 'string') {
          return part.text;
        }
      }
    }
    return '';
  }
}

/**
 * Makes an LLM request with automatic provider detection
 */
export async function makeLLMRequest(
  config: LLMRequestConfig,
  options: LLMRequestOptions
): Promise<LLMResponse> {
  const provider = detectLLMProvider(config.apiUrl, config.apiKey);
  const headers = buildLLMHeaders(provider, config.apiKey);
  const body = buildLLMRequestBody(provider, config, options);

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`LLM request failed with status ${response.status}: ${raw}`);
  }

  const raw = await response.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`LLM returned invalid JSON: ${raw}`);
  }

  const text = parseLLMResponse(provider, json);

  return {
    text,
    raw: json,
  };
}

