# ✦ Clarity — AI Page Summarizer

> A beautiful Chrome Extension that distills any webpage into clear summaries using Google's Gemini AI.

![Light & Dark Theme](https://img.shields.io/badge/Theme-Light%20%26%20Dark-green)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Gemini AI](https://img.shields.io/badge/AI-Gemini%201.5%20Flash-orange)

## 🎯 What It Does

Click the extension icon on any article, blog post, or news page and get:

- **📝 Summary** — 2–3 sentence paragraph overview
- **✦ Key Insights** — 4–5 specific, meaningful bullet points
- **◇ Takeaway** — One powerful sentence capturing the core idea
- **⏱ Reading time** — Estimated original reading time
- **Highlight mode** — Marks key phrases on the actual page

## 🚀 Installation (Local / Unpacked)

### Step 1 — Get a Free Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with a Google account
3. Click **"Create API Key"**
4. Copy your key — it looks like `AIzaSy...`

> **Free tier**: 15 requests/minute, 1 million tokens/day — plenty for personal use!

### Step 2 — Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **"Developer mode"** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select the `ai-page-summarizer` folder (this directory)
5. The Clarity icon will appear in your Chrome toolbar

### Step 3 — Add Your API Key

1. Click the Clarity icon in your toolbar
2. Click the ⚙️ Settings icon (top right of popup)
3. Paste your Gemini API key in the field
4. Click **"Save Settings"**

That's it! Navigate to any article and click **"Summarize Page"**.

## 🏗 Architecture

```
ai-page-summarizer/
├── manifest.json          # Extension configuration (Manifest V3)
├── popup.html             # Popup UI structure
├── popup.css              # UI styles (light + dark theme)
├── popup.js               # Popup controller — UI logic & state
├── icons/                 # Extension icons (16, 32, 48, 128px)
└── src/
    ├── background.js      # Service worker — AI API calls
    └── content.js         # In-page highlighting
```

### How the Pieces Connect

```
[User clicks icon]
       ↓
[popup.html/popup.js]  ──── chrome.scripting.executeScript ────▶  [Page DOM]
       │                    (extract content)                      content extraction
       │
       ▼
[chrome.runtime.sendMessage]
       │
       ▼
[src/background.js]  ─── fetch() ───▶  [Gemini API]
       │                               (Google's servers)
       │
       ▼
[Structured Summary JSON]
       │
       ▼
[popup.js displayResult()]
       │
       ▼
[Beautiful UI with stats, bullets, takeaway]
```

## 🤖 AI Integration (Gemini)

### Why Gemini?
- **Free** — Google AI Studio gives generous free quota
- **Fast** — Gemini 1.5 Flash is optimized for speed
- **Smart** — Excellent at structured JSON output

### How the API Call Works

The background service worker sends a POST request to:
```
https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent
```

With a carefully crafted prompt that:
1. Provides the page title and extracted text
2. Specifies the summary style (brief / balanced / detailed)
3. **Instructs Gemini to return strict JSON** — no markdown, no prose
4. Defines the exact schema we expect back

**Example API payload:**
```json
{
  "contents": [{
    "parts": [{
      "text": "You are an expert content analyst. Return ONLY valid JSON...\n\nCONTENT: [page text]"
    }]
  }],
  "generationConfig": {
    "temperature": 0.4,
    "maxOutputTokens": 1024,
    "topP": 0.9
  }
}
```

**Example response (parsed):**
```json
{
  "summary": "The article discusses...",
  "insights": ["Insight 1", "Insight 2", "..."],
  "takeaway": "Core message in one sentence."
}
```

## 🔐 Security Decisions

| Decision | Why |
|----------|-----|
| API key stored in `chrome.storage.local` | Never in source code or transmitted elsewhere |
| All API calls in `background.js` | Background scripts are isolated from page JS |
| Key never passes through content scripts | Content scripts run in page context — accessible via DevTools |
| `host_permissions` scoped to Google API only | Minimal blast radius if extension is compromised |
| Sanitized HTML rendering | Summary text is set via `.textContent`, never `.innerHTML` |
| Content extraction runs in isolated function | Passed via `executeScript`, not string eval |

## ⚖️ Trade-offs

### Content Extraction
- **Simple heuristic** approach (prioritize `<article>`, `<main>`, etc.) vs. full Readability.js
- **Pro**: Zero dependencies, fast, no licensing concerns
- **Con**: May grab some nav/footer text on unusual page layouts

### Caching
- Summaries are cached by URL in `chrome.storage.local`
- **Pro**: No duplicate API calls, instant re-opens
- **Con**: Cache doesn't auto-expire (users manually clear via the Clear button)

### Token Budget
- Page text is capped at **8,000 characters** before sending to Gemini
- **Pro**: Stays well within free tier token limits
- **Con**: Very long articles lose tail content

### Manifest V3 Constraints
- Service worker is non-persistent — wakes on demand
- Background state isn't maintained between calls (stateless by design — a feature)

## 🎨 UI Features

- **Light & Dark theme** — persisted per-user in storage
- **Summary styles** — Brief / Balanced / Detailed (affects prompt length)
- **Cached result indicator** — shown when a URL has been summarized before
- **Copy to clipboard** — formatted plaintext with all sections
- **Highlight mode** — marks key phrases green on the actual page
- **Step-by-step loading** — animated progress indicator
- **Error handling** — friendly messages for API errors, rate limits, bad pages

## 🛠 Development

No build step required — this is plain HTML/CSS/JS.

To modify:
1. Edit the source files
2. Go to `chrome://extensions`
3. Click the refresh icon on the Clarity card
4. Re-open the popup

## 📋 Permissions Used

| Permission | Why |
|-----------|-----|
| `activeTab` | Read the current tab's URL and title |
| `storage` | Save API key, theme, and cached summaries |
| `scripting` | Inject content extractor into the page |
| `host_permissions: generativelanguage.googleapis.com` | Make Gemini API calls |

## 🙋 FAQ

**Q: Is my API key safe?**  
A: Yes. It's stored only in your browser's local storage and sent directly to Google's API. Anthropic, the extension developer, or any third party never sees it.

**Q: It says "Cannot access this page" — why?**  
A: Chrome blocks extensions from running on `chrome://` pages, the Chrome Web Store, and some special pages. This is a Chrome security requirement.

**Q: The summary seems off / incomplete — why?**  
A: Some pages use heavy JavaScript to render content. The extractor reads the DOM — if content loads after the initial render, it might miss it. Try scrolling the page first, then summarizing.

**Q: Can I use GPT-4 instead of Gemini?**  
A: Yes! In `src/background.js`, replace `GEMINI_ENDPOINT` with OpenAI's endpoint and adjust the request/response format. The architecture supports any AI API.
