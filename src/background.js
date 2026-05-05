/**
 * background.js — Clarity Background Service Worker
 *
 * Security: ALL Gemini API calls happen here — never exposed to page context.
 * Users provide their own Gemini API key via the Settings panel.
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─── Response Schema — enforces exact JSON shape from Gemini ─────────────────
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: {
      type: 'STRING',
      description: 'A clear flowing paragraph summarizing the main content of the page.',
    },
    insights: {
      type: 'ARRAY',
      description: 'List of key facts or insights from the page.',
      items: {
        type: 'STRING',
        description: 'A complete, specific, informative sentence about a key point.',
      },
    },
    takeaway: {
      type: 'STRING',
      description: 'One powerful sentence capturing the core message or value.',
    },
  },
  required: ['summary', 'insights', 'takeaway'],
};

// ─── Message Router ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SUMMARIZE') {
    handleSummarize(message.payload)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep message channel open for async
  }

});

// ─── Summarize Handler ───────────────────────────────────────────────────────
async function handleSummarize({ text, title, apiKey, style }) {
  if (!apiKey) {
    throw new Error('No API key provided. Add your Gemini API key in Settings.');
  }
  if (!text || text.length < 50) {
    throw new Error('Not enough readable content found on this page.');
  }

  const prompt = buildPrompt(text, title, style);
  const insightCount = { brief: 3, balanced: 5, detailed: 7 }[style] || 5;

  let raw;
  try {
    raw = await callGemini(apiKey, prompt, insightCount);
  } catch (err) {
    if (err.message.includes('400')) throw new Error('Invalid API key format. It should start with "AIza".');
    if (err.message.includes('403')) throw new Error('API key unauthorized. Check it at aistudio.google.com.');
    if (err.message.includes('429')) throw new Error('Rate limit reached. Wait a moment and try again.');
    if (err.message.includes('500') || err.message.includes('503')) throw new Error('Gemini service error. Try again shortly.');
    throw new Error(`API error: ${err.message}`);
  }

  const summary = parseSummary(raw, text);

  if (!summary.summary || summary.insights.length === 0) {
    throw new Error('Gemini returned an empty summary. Try again or try a different page.');
  }

  return { summary };
}

// ─── Gemini API Call ─────────────────────────────────────────────────────────
async function callGemini(apiKey, prompt, insightCount) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
      topP: 0.85,
      // Forces Gemini to return structured JSON matching our schema exactly
      responseMimeType: 'application/json',
      responseSchema: {
        ...RESPONSE_SCHEMA,
        properties: {
          ...RESPONSE_SCHEMA.properties,
          insights: {
            ...RESPONSE_SCHEMA.properties.insights,
            minItems: insightCount,
            maxItems: insightCount,
          },
        },
      },
    },
  };

  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${response.status}: ${errText}`);
  }

  const data = await response.json();

  // Check for safety blocks or empty candidates
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error('No response candidates from Gemini.');
  if (candidate.finishReason === 'SAFETY') throw new Error('Content blocked by safety filters. Try a different page.');
  if (candidate.finishReason === 'MAX_TOKENS') {
    // Still try to use what we got — it might be complete enough
    console.warn('Clarity: Response hit max tokens limit.');
  }

  const content = candidate?.content?.parts?.[0]?.text;
  if (!content || content.trim() === '') {
    throw new Error('Gemini returned empty content. Please try again.');
  }

  return content;
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────
function buildPrompt(text, title, style) {
  const counts = { brief: 3, balanced: 5, detailed: 7 };
  const n = counts[style] || 5;

  return `You are an expert content analyst. Read the following webpage content carefully and produce a structured summary.

PAGE TITLE: ${title}

WEBPAGE CONTENT:
${text}

Your task:
1. Write a "summary" — a clear, flowing paragraph (${style === 'brief' ? '1-2' : style === 'detailed' ? '3-4' : '2-3'} sentences) that captures what this page is about.
2. Write exactly ${n} "insights" — each must be a complete, specific sentence containing an actual fact, statistic, name, date, or concrete detail from the content. Do NOT write vague statements.
3. Write a "takeaway" — one memorable sentence that gives the reader a clear conclusion or action.

Important:
- Write about what is actually ON the page, not about the page itself
- Do not use phrases like "The article discusses" or "This page covers"
- Every insight must contain specific information — no filler
- If the page has ${n} or more distinct points, extract the ${n} most important ones`;
}

// ─── Response Parser ─────────────────────────────────────────────────────────
// With responseSchema set, Gemini MUST return valid JSON matching the schema.
// These fallbacks handle any edge cases gracefully.
function parseSummary(raw, originalText) {
  let parsed = null;

  // Primary: direct parse (should always work with responseSchema)
  try {
    parsed = JSON.parse(raw.trim());
  } catch (_) {}

  // Fallback 1: strip any residual markdown fences
  if (!parsed) {
    try {
      const stripped = raw
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      parsed = JSON.parse(stripped);
    } catch (_) {}
  }

  // Fallback 2: find JSON object anywhere in the string
  if (!parsed) {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (_) {}
  }

  // Fallback 3: reconstruct from whatever fields we can find
  if (!parsed) {
    parsed = manualExtract(raw);
  }

  // Normalise all fields
  const summary  = sanitizeString(parsed?.summary);
  const takeaway = sanitizeString(parsed?.takeaway);
  const insights = sanitizeArray(parsed?.insights);

  const wordCount   = originalText.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  return { summary, insights, takeaway, wordCount, readingTime };
}

function sanitizeString(val) {
  if (typeof val !== 'string') return '';
  return val.trim();
}

function sanitizeArray(val) {
  if (!Array.isArray(val)) return [];
  return val
    .map(item => (typeof item === 'string' ? item.trim() : String(item).trim()))
    .filter(item => item.length > 3);
}

// ─── Manual Extraction (absolute last resort) ─────────────────────────────────
function manualExtract(raw) {
  // Try to pull string values from key fields
  const get = (key) => {
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's'));
    return m ? m[1] : null;
  };

  // Pull array items — handles both ["a","b"] and ["a",\n"b"] formats
  const getArray = () => {
    const block = raw.match(/"insights"\s*:\s*\[([\s\S]*?)\]/);
    if (!block) return [];
    return [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map(m => m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim())
      .filter(s => s.length > 3);
  };

  return {
    summary:  get('summary')  || '',
    insights: getArray(),
    takeaway: get('takeaway') || '',
  };
}
