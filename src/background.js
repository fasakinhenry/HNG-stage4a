/**
 * background.js — Clarity Background Service Worker
 *
 * ALL Gemini API calls happen here — never in content scripts or popup.
 * This keeps the API key from being accessible via page DevTools.
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─── Message Router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SUMMARIZE') {
    handleSummarize(message.payload)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ─── Summarize Handler ───────────────────────────────────────────────────────
async function handleSummarize({ text, title, url, apiKey, style }) {
  if (!apiKey) throw new Error('No API key provided. Add one in Settings.');
  if (!text || text.length < 50) throw new Error('Not enough content to summarize.');

  const prompt = buildPrompt(text, title, style);

  let raw;
  try {
    raw = await callGemini(apiKey, prompt);
  } catch (err) {
    if (err.message.includes('400')) throw new Error('Bad request — check your API key format (should start with AIza...).');
    if (err.message.includes('403')) throw new Error('API key unauthorized. Visit aistudio.google.com to verify your key.');
    if (err.message.includes('429')) throw new Error('Rate limit hit. Wait a moment and try again.');
    if (err.message.includes('500')) throw new Error('Gemini API error. Please try again shortly.');
    throw new Error(`API error: ${err.message}`);
  }

  const summary = parseSummary(raw, text);
  return { summary };
}

// ─── Gemini API Call ─────────────────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1500,
        topP: 0.9,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    const blockReason = data?.candidates?.[0]?.finishReason;
    if (blockReason === 'SAFETY') throw new Error('Content was blocked by safety filters. Try a different page.');
    throw new Error('Empty response from Gemini API. Please try again.');
  }

  return content;
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────
function buildPrompt(text, title, style) {
  const styleInstructions = {
    brief:    'Be very concise. Summary: 1-2 sentences. Insights: exactly 3.',
    balanced: 'Be thorough but concise. Summary: 2-3 sentences. Insights: exactly 5.',
    detailed: 'Be comprehensive. Summary: 3-4 sentences. Insights: exactly 7.',
  };

  const instruction = styleInstructions[style] || styleInstructions.balanced;

  return `You are an expert content analyst. Analyze the webpage content below and return a JSON object.

PAGE TITLE: ${title}

CONTENT:
${text}

INSTRUCTIONS: ${instruction}

Return a JSON object with exactly these three fields:
- "summary": string — a clear flowing paragraph summarizing the main content
- "insights": array of strings — each a specific, standalone key fact or point  
- "takeaway": string — one powerful sentence capturing the core message

Rules:
- Each insight must be a complete informative sentence, not vague
- Write directly about the content, data, and ideas — not meta-commentary
- The takeaway should give the reader something concrete to act on or remember`;
}

// ─── Response Parser (multi-strategy, bulletproof) ────────────────────────────
function parseSummary(raw, originalText) {
  let parsed = null;

  // Strategy 1: Direct JSON.parse — works when responseMimeType forces clean JSON
  try { parsed = JSON.parse(raw); } catch (_) {}

  // Strategy 2: Strip markdown code fences, then parse
  if (!parsed) {
    try {
      const stripped = raw
        .replace(/^```(?:json)?\s*/im, '')
        .replace(/```\s*$/m, '')
        .trim();
      parsed = JSON.parse(stripped);
    } catch (_) {}
  }

  // Strategy 3: Grab the first {...} block from the response
  if (!parsed) {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (_) {}
  }

  // Strategy 4: Manual regex field extraction as absolute last resort
  if (!parsed) {
    parsed = extractFieldsManually(raw);
  }

  // Sanitize and normalise
  const summary  = typeof parsed.summary  === 'string' ? parsed.summary.trim()  : '';
  const takeaway = typeof parsed.takeaway === 'string' ? parsed.takeaway.trim() : '';
  const insights = Array.isArray(parsed.insights)
    ? parsed.insights.filter(i => typeof i === 'string' && i.trim().length > 0)
    : [];

  const words = originalText.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(words / 200));

  return { summary, insights, takeaway, wordCount: words, readingTime };
}

// ─── Manual Field Extraction ──────────────────────────────────────────────────
function extractFieldsManually(raw) {
  const summaryMatch  = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  const takeawayMatch = raw.match(/"takeaway"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  const insightsBlock = raw.match(/"insights"\s*:\s*\[([\s\S]*?)\]/);

  let insights = [];
  if (insightsBlock) {
    insights = [...insightsBlock[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map(m => m[1].trim())
      .filter(Boolean);
  }

  return {
    summary:  summaryMatch  ? summaryMatch[1]  : raw.replace(/[{}"\[\]]/g, '').slice(0, 500).trim(),
    insights: insights.length ? insights : ['Page content parsed — key insights could not be individually extracted.'],
    takeaway: takeawayMatch ? takeawayMatch[1] : 'Review the summary above for the main ideas from this page.',
  };
}
