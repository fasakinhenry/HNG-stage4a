/**
 * popup.js — Clarity Extension UI Controller
 * Handles all popup interactions and communicates with background service worker
 */

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  theme: 'light',
  summaryStyle: 'balanced',
  apiKey: '',
  currentUrl: '',
  currentSummary: null,
  highlightsActive: false,
};

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  themeToggle: $('themeToggle'),
  settingsBtn: $('settingsBtn'),
  settingsPanel: $('settingsPanel'),
  mainView: $('mainView'),
  apiKeyInput: $('apiKeyInput'),
  toggleKeyBtn: $('toggleKeyBtn'),
  saveSettings: $('saveSettings'),
  styleOpts: document.querySelectorAll('.style-opt'),
  pageTitle: $('pageTitle'),
  pageUrl: $('pageUrl'),
  pageFavicon: $('pageFavicon'),
  noKeyState: $('noKeyState'),
  idleState: $('idleState'),
  loadingState: $('loadingState'),
  errorState: $('errorState'),
  resultState: $('resultState'),
  summarizeBtn: $('summarizeBtn'),
  retryBtn: $('retryBtn'),
  clearBtn: $('clearBtn'),
  copyBtn: $('copyBtn'),
  highlightBtn: $('highlightBtn'),
  openSettingsFromState: $('openSettingsFromState'),
  loaderText: $('loaderText'),
  step1: $('step1'),
  step2: $('step2'),
  step3: $('step3'),
  readingTime: $('readingTime'),
  wordCount: $('wordCount'),
  insightCount: $('insightCount'),
  summaryText: $('summaryText'),
  insightsList: $('insightsList'),
  takeawayText: $('takeawayText'),
  cachedHint: $('cachedHint'),
  toast: $('toast'),
};

// ─── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadPageInfo();
  setupEventListeners();
  await checkCache();
});

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const data = await chrome.storage.local.get(['theme', 'apiKey', 'summaryStyle']);

  state.theme = data.theme || 'light';
  state.apiKey = data.apiKey || '';
  state.summaryStyle = data.summaryStyle || 'balanced';

  applyTheme(state.theme);

  if (state.apiKey) {
    els.apiKeyInput.value = state.apiKey;
  }

  // Apply style selection
  els.styleOpts.forEach(opt => {
    opt.classList.toggle('active', opt.dataset.style === state.summaryStyle);
  });
}

async function saveSettings() {
  const key = els.apiKeyInput.value.trim();
  state.apiKey = key;
  state.summaryStyle = document.querySelector('.style-opt.active')?.dataset.style || 'balanced';

  await chrome.storage.local.set({
    theme: state.theme,
    apiKey: state.apiKey,
    summaryStyle: state.summaryStyle,
  });

  showToast('Settings saved ✓');
  closeSettings();
  updateNoKeyState();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
}

// ─── Page Info ─────────────────────────────────────────────────────────────────
async function loadPageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  state.currentUrl = tab.url;
  els.pageTitle.textContent = tab.title || 'Untitled Page';
  els.pageUrl.textContent = new URL(tab.url).hostname;

  // Favicon
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${new URL(tab.url).hostname}&sz=32`;
  const img = document.createElement('img');
  img.src = faviconUrl;
  img.alt = '';
  els.pageFavicon.appendChild(img);

  updateNoKeyState();
}

function updateNoKeyState() {
  if (!state.apiKey) {
    showState('noKey');
  } else {
    showState('idle');
  }
}

// ─── Cache Check ───────────────────────────────────────────────────────────────
async function checkCache() {
  if (!state.currentUrl) return;
  const cacheKey = `summary_${state.currentUrl}`;
  const data = await chrome.storage.local.get(cacheKey);
  if (data[cacheKey]) {
    els.cachedHint.classList.remove('hidden');
  }
}

// ─── State Display ─────────────────────────────────────────────────────────────
function showState(which) {
  const states = {
    noKey: els.noKeyState,
    idle: els.idleState,
    loading: els.loadingState,
    error: els.errorState,
    result: els.resultState,
  };

  Object.values(states).forEach(el => el.classList.add('hidden'));
  if (states[which]) states[which].classList.remove('hidden');
}

// ─── Settings Panel ─────────────────────────────────────────────────────────────
function toggleSettings() {
  const isOpen = !els.settingsPanel.classList.contains('hidden');
  els.settingsPanel.classList.toggle('hidden', isOpen);
}

function closeSettings() {
  els.settingsPanel.classList.add('hidden');
}

// ─── Summarize Flow ─────────────────────────────────────────────────────────────
async function startSummarize() {
  if (!state.apiKey) {
    showState('noKey');
    return;
  }

  // Check cache first
  const cacheKey = `summary_${state.currentUrl}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) {
    displayResult(cached[cacheKey]);
    return;
  }

  showState('loading');
  animateSteps();

  try {
    // Step 1: Extract content from page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    let pageContent;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageContent,
      });
      pageContent = results[0]?.result;
    } catch (e) {
      throw new Error('Cannot access this page. Try on a regular webpage.');
    }

    if (!pageContent || pageContent.text.length < 100) {
      throw new Error('Not enough readable content found on this page.');
    }

    // Step 2: Send to background for AI call
    setStep(2);
    const response = await chrome.runtime.sendMessage({
      type: 'SUMMARIZE',
      payload: {
        text: pageContent.text,
        title: pageContent.title,
        url: state.currentUrl,
        apiKey: state.apiKey,
        style: state.summaryStyle,
      },
    });

    if (response.error) throw new Error(response.error);

    setStep(3);
    await delay(500);

    // Save to cache
    await chrome.storage.local.set({ [cacheKey]: response.summary });

    displayResult(response.summary);
  } catch (err) {
    showError(err.message);
  }
}

function extractPageContent() {
  /**
   * Content extractor — runs in page context.
   * Priority: article > main > body fallback with heuristic filtering.
   */
  const title = document.title;

  // Remove noise elements
  const noiseSelectors = [
    'nav', 'header', 'footer', 'aside', '.sidebar', '.advertisement',
    '.ads', '.cookie', '.popup', '.modal', '.nav', '.menu', '.social',
    'script', 'style', 'noscript', '.comments', '#comments',
  ];

  // Clone the body to avoid mutating the page
  const bodyClone = document.body.cloneNode(true);
  noiseSelectors.forEach(sel => {
    bodyClone.querySelectorAll(sel).forEach(el => el.remove());
  });

  // Try to find main content area
  const contentPriority = [
    bodyClone.querySelector('article'),
    bodyClone.querySelector('[role="main"]'),
    bodyClone.querySelector('main'),
    bodyClone.querySelector('.post-content'),
    bodyClone.querySelector('.article-content'),
    bodyClone.querySelector('.entry-content'),
    bodyClone.querySelector('#content'),
    bodyClone.querySelector('.content'),
    bodyClone,
  ].filter(Boolean);

  const contentEl = contentPriority[0];

  // Extract and clean text
  let text = contentEl.innerText || contentEl.textContent || '';
  text = text
    .replace(/\n{3,}/g, '\n\n') // collapse excess newlines
    .replace(/[ \t]{2,}/g, ' ')  // collapse spaces
    .trim();

  // Limit to ~8000 chars to stay within token budget
  if (text.length > 8000) {
    text = text.slice(0, 8000) + '...';
  }

  return { title, text, length: text.length };
}

// ─── Loading Animation ─────────────────────────────────────────────────────────
let stepTimeout;

function animateSteps() {
  setStep(1);
}

function setStep(n) {
  clearTimeout(stepTimeout);
  [els.step1, els.step2, els.step3].forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i + 1 < n) el.classList.add('done');
    if (i + 1 === n) el.classList.add('active');
  });

  const messages = ['Reading page content...', 'Sending to Gemini AI...', 'Crafting your summary...'];
  els.loaderText.textContent = messages[n - 1] || '';
}

// ─── Display Result ─────────────────────────────────────────────────────────────
function displayResult(summary) {
  state.currentSummary = summary;

  // Stats
  const wc = summary.wordCount || '—';
  const rt = summary.readingTime || '—';
  const ic = summary.insights?.length || 0;

  els.wordCount.textContent = wc.toLocaleString?.() ?? wc;
  els.readingTime.textContent = typeof rt === 'number' ? `${rt} min` : rt;
  els.insightCount.textContent = ic;

  // Summary text
  els.summaryText.textContent = summary.summary || '';

  // Insights
  els.insightsList.innerHTML = '';
  (summary.insights || []).forEach((insight, i) => {
    const li = document.createElement('li');
    li.textContent = insight;
    li.style.animationDelay = `${i * 60}ms`;
    els.insightsList.appendChild(li);
  });

  // Takeaway
  els.takeawayText.textContent = summary.takeaway || '';

  showState('result');
}

// ─── Error ─────────────────────────────────────────────────────────────────────
function showError(message) {
  $('errorTitle').textContent = 'Something went wrong';
  $('errorDesc').textContent = message || 'An unexpected error occurred. Please try again.';
  showState('error');
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function copyToClipboard() {
  if (!state.currentSummary) return;

  const s = state.currentSummary;
  const text = [
    `📄 ${els.pageTitle.textContent}`,
    '',
    '── Summary ──',
    s.summary,
    '',
    '── Key Insights ──',
    ...(s.insights || []).map((v, i) => `${i + 1}. ${v}`),
    '',
    '── Takeaway ──',
    s.takeaway,
    '',
    `⏱ ${s.readingTime} min read · ${s.wordCount} words`,
    `🔗 ${state.currentUrl}`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    els.copyBtn.classList.add('copied');
    els.copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => {
      els.copyBtn.classList.remove('copied');
      els.copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    }, 2000);
  } catch {
    showToast('Copy failed. Try again.');
  }
}

async function toggleHighlight() {
  if (!state.currentSummary?.insights) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.highlightsActive = !state.highlightsActive;

  await chrome.tabs.sendMessage(tab.id, {
    type: state.highlightsActive ? 'HIGHLIGHT' : 'REMOVE_HIGHLIGHTS',
    payload: { insights: state.currentSummary.insights },
  });

  els.highlightBtn.style.color = state.highlightsActive ? 'var(--accent)' : '';
  showToast(state.highlightsActive ? 'Highlights added ✓' : 'Highlights removed');
}

async function clearResult() {
  // Remove from cache
  const cacheKey = `summary_${state.currentUrl}`;
  await chrome.storage.local.remove(cacheKey);
  state.currentSummary = null;
  state.highlightsActive = false;
  els.cachedHint.classList.add('hidden');
  showState('idle');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  clearTimeout(toastTimeout);
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  setTimeout(() => els.toast.classList.add('show'), 10);
  toastTimeout = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => els.toast.classList.add('hidden'), 300);
  }, 2500);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  // Theme
  els.themeToggle.addEventListener('click', () => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
    chrome.storage.local.set({ theme: newTheme });
  });

  // Settings
  els.settingsBtn.addEventListener('click', toggleSettings);
  els.saveSettings.addEventListener('click', saveSettings);
  els.openSettingsFromState.addEventListener('click', () => {
    showState('idle');
    els.settingsPanel.classList.remove('hidden');
  });

  // API Key visibility
  els.toggleKeyBtn.addEventListener('click', () => {
    els.apiKeyInput.type = els.apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Style options
  els.styleOpts.forEach(opt => {
    opt.addEventListener('click', () => {
      els.styleOpts.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      state.summaryStyle = opt.dataset.style;
    });
  });

  // Actions
  els.summarizeBtn.addEventListener('click', startSummarize);
  els.retryBtn.addEventListener('click', startSummarize);
  els.copyBtn.addEventListener('click', copyToClipboard);
  els.highlightBtn.addEventListener('click', toggleHighlight);
  els.clearBtn.addEventListener('click', clearResult);

  // Keyboard: close settings on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
