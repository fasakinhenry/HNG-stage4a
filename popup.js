/**
 * popup.js — Clarity Extension UI Controller
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

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  themeToggle:         $('themeToggle'),
  settingsBtn:         $('settingsBtn'),
  settingsPanel:       $('settingsPanel'),
  apiKeyInput:         $('apiKeyInput'),
  toggleKeyBtn:        $('toggleKeyBtn'),
  saveSettings:        $('saveSettings'),
  styleOpts:           document.querySelectorAll('.style-opt'),
  pageTitle:           $('pageTitle'),
  pageUrl:             $('pageUrl'),
  pageFavicon:         $('pageFavicon'),
  noKeyState:          $('noKeyState'),
  idleState:           $('idleState'),
  loadingState:        $('loadingState'),
  errorState:          $('errorState'),
  resultState:         $('resultState'),
  summarizeBtn:        $('summarizeBtn'),
  retryBtn:            $('retryBtn'),
  clearBtn:            $('clearBtn'),
  copyBtn:             $('copyBtn'),
  highlightBtn:        $('highlightBtn'),
  openSettingsFromState: $('openSettingsFromState'),
  loaderText:          $('loaderText'),
  step1:               $('step1'),
  step2:               $('step2'),
  step3:               $('step3'),
  readingTime:         $('readingTime'),
  wordCount:           $('wordCount'),
  insightCount:        $('insightCount'),
  summaryText:         $('summaryText'),
  insightsList:        $('insightsList'),
  takeawayText:        $('takeawayText'),
  cachedHint:          $('cachedHint'),
  toast:               $('toast'),
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadPageInfo();
  setupEventListeners();
  await checkCache();
});

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const data = await chrome.storage.local.get(['theme', 'apiKey', 'summaryStyle']);

  state.theme        = data.theme        || 'light';
  state.apiKey       = data.apiKey       || '';
  state.summaryStyle = data.summaryStyle || 'balanced';

  applyTheme(state.theme);
  if (state.apiKey) els.apiKeyInput.value = state.apiKey;

  els.styleOpts.forEach(opt => {
    opt.classList.toggle('active', opt.dataset.style === state.summaryStyle);
  });
}

async function saveSettings() {
  const key = els.apiKeyInput.value.trim();
  state.apiKey = key;
  state.summaryStyle = document.querySelector('.style-opt.active')?.dataset.style || 'balanced';

  await chrome.storage.local.set({
    theme:        state.theme,
    apiKey:       state.apiKey,
    summaryStyle: state.summaryStyle,
  });

  showToast('Settings saved ✓');
  closeSettings();
  updateReadyState();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
}

// ─── Page Info ────────────────────────────────────────────────────────────────
async function loadPageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  state.currentUrl = tab.url;
  els.pageTitle.textContent = tab.title || 'Untitled Page';

  try {
    els.pageUrl.textContent = new URL(tab.url).hostname;
  } catch (_) {
    els.pageUrl.textContent = tab.url;
  }

  const faviconUrl = `https://www.google.com/s2/favicons?domain=${new URL(tab.url).hostname}&sz=32`;
  const img = document.createElement('img');
  img.src = faviconUrl;
  img.alt = '';
  els.pageFavicon.appendChild(img);

  updateReadyState();
}

// Decides whether to show the "no key" gate or the idle/ready state
function updateReadyState() {
  showState(state.apiKey ? 'idle' : 'noKey');
}

// ─── Cache ────────────────────────────────────────────────────────────────────
async function checkCache() {
  if (!state.currentUrl) return;
  const cacheKey = `summary_${state.currentUrl}`;
  const data = await chrome.storage.local.get(cacheKey);
  if (data[cacheKey]) els.cachedHint.classList.remove('hidden');
}

// ─── State Display ────────────────────────────────────────────────────────────
function showState(which) {
  const map = {
    noKey:   els.noKeyState,
    idle:    els.idleState,
    loading: els.loadingState,
    error:   els.errorState,
    result:  els.resultState,
  };
  Object.values(map).forEach(el => el?.classList.add('hidden'));
  map[which]?.classList.remove('hidden');
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function toggleSettings() {
  els.settingsPanel.classList.toggle('hidden');
}
function closeSettings() {
  els.settingsPanel.classList.add('hidden');
}

// ─── Summarize Flow ───────────────────────────────────────────────────────────
async function startSummarize() {
  if (!state.apiKey) { showState('noKey'); return; }

  // Serve from cache if available
  const cacheKey = `summary_${state.currentUrl}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) {
    displayResult(cached[cacheKey]);
    return;
  }

  showState('loading');
  setStep(1);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    let pageContent;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageContent,
      });
      pageContent = results[0]?.result;
    } catch (e) {
      throw new Error('Cannot access this page. Try on a regular article or webpage.');
    }

    if (!pageContent || pageContent.text.length < 100) {
      throw new Error('Not enough readable content found. Try a page with more article text.');
    }

    setStep(2);

    const response = await chrome.runtime.sendMessage({
      type: 'SUMMARIZE',
      payload: {
        text:   pageContent.text,
        title:  pageContent.title,
        url:    state.currentUrl,
        apiKey: state.apiKey, // may be empty — background falls back to dev key
        style:  state.summaryStyle,
      },
    });

    if (response.error) throw new Error(response.error);

    setStep(3);
    await delay(400);

    // Cache result
    await chrome.storage.local.set({ [cacheKey]: response.summary });
    els.cachedHint.classList.remove('hidden');

    displayResult(response.summary);
  } catch (err) {
    showError(err.message);
  }
}

// Runs inside page context — extracts clean article text
function extractPageContent() {
  const title = document.title;

  const noiseSelectors = [
    'nav','header','footer','aside','.sidebar','.advertisement','.ads',
    '.cookie','.popup','.modal','.menu','.social','script','style',
    'noscript','.comments','#comments','[role="banner"]','[role="navigation"]',
    '.related','#related','.share','.sharing','.newsletter-signup',
  ];

  const bodyClone = document.body.cloneNode(true);
  noiseSelectors.forEach(sel => {
    bodyClone.querySelectorAll(sel).forEach(el => el.remove());
  });

  const candidates = [
    bodyClone.querySelector('article'),
    bodyClone.querySelector('[role="main"]'),
    bodyClone.querySelector('main'),
    bodyClone.querySelector('.post-content, .article-content, .entry-content, .post-body'),
    bodyClone.querySelector('#content, #main-content, #article'),
    bodyClone.querySelector('.content, .main'),
    bodyClone,
  ].filter(Boolean);

  const contentEl = candidates[0];
  let text = (contentEl.innerText || contentEl.textContent || '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // Cap at 10000 chars to stay within token budget while maximising content
  if (text.length > 10000) text = text.slice(0, 10000) + '...';

  return { title, text, length: text.length };
}

// ─── Loading Steps ────────────────────────────────────────────────────────────
function setStep(n) {
  const steps   = [els.step1, els.step2, els.step3];
  const labels  = ['Reading page content...', 'Sending to Gemini AI...', 'Crafting your summary...'];

  steps.forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i + 1 < n)  el.classList.add('done');
    if (i + 1 === n) el.classList.add('active');
  });

  els.loaderText.textContent = labels[n - 1] || '';
}

// ─── Display Result ───────────────────────────────────────────────────────────
function displayResult(summary) {
  state.currentSummary = summary;

  els.wordCount.textContent   = Number(summary.wordCount || 0).toLocaleString();
  els.readingTime.textContent = `${summary.readingTime || 1} min`;
  els.insightCount.textContent = summary.insights?.length || 0;

  els.summaryText.textContent = summary.summary || '';

  els.insightsList.innerHTML = '';
  (summary.insights || []).forEach((insight, i) => {
    const li = document.createElement('li');
    li.textContent = insight;
    li.style.animationDelay = `${i * 60}ms`;
    els.insightsList.appendChild(li);
  });

  els.takeawayText.textContent = summary.takeaway || '';

  showState('result');
}

// ─── Error ────────────────────────────────────────────────────────────────────
function showError(message) {
  $('errorTitle').textContent = 'Something went wrong';
  $('errorDesc').textContent  = message || 'An unexpected error occurred. Please try again.';
  showState('error');
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function copyToClipboard() {
  if (!state.currentSummary) return;
  const s = state.currentSummary;

  const text = [
    `📄 ${els.pageTitle.textContent}`,
    `🔗 ${state.currentUrl}`,
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
    'Summarized by Clarity Chrome Extension',
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    const orig = els.copyBtn.innerHTML;
    els.copyBtn.classList.add('copied');
    els.copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => {
      els.copyBtn.classList.remove('copied');
      els.copyBtn.innerHTML = orig;
    }, 2200);
  } catch {
    showToast('Copy failed — try again.');
  }
}

async function toggleHighlight() {
  if (!state.currentSummary?.insights) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.highlightsActive = !state.highlightsActive;

  await chrome.tabs.sendMessage(tab.id, {
    type: state.highlightsActive ? 'HIGHLIGHT' : 'REMOVE_HIGHLIGHTS',
    payload: { insights: state.currentSummary.insights },
  }).catch(() => {}); // silently ignore if content script isn't ready

  els.highlightBtn.style.color = state.highlightsActive ? 'var(--accent)' : '';
  showToast(state.highlightsActive ? 'Highlights added ✓' : 'Highlights removed');
}

async function clearResult() {
  const cacheKey = `summary_${state.currentUrl}`;
  await chrome.storage.local.remove(cacheKey);
  state.currentSummary   = null;
  state.highlightsActive = false;
  els.cachedHint.classList.add('hidden');

  // Remove any active highlights
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'REMOVE_HIGHLIGHTS' });
  } catch (_) {}

  showState('idle');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  requestAnimationFrame(() => els.toast.classList.add('show'));
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => els.toast.classList.add('hidden'), 300);
  }, 2500);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  els.themeToggle.addEventListener('click', () => {
    const next = state.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    chrome.storage.local.set({ theme: next });
  });

  els.settingsBtn.addEventListener('click', toggleSettings);
  els.saveSettings.addEventListener('click', saveSettings);
  els.openSettingsFromState?.addEventListener('click', () => {
    updateReadyState(); // ensure correct idle/nokey shown after
    els.settingsPanel.classList.remove('hidden');
  });

  els.toggleKeyBtn.addEventListener('click', () => {
    els.apiKeyInput.type = els.apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  els.styleOpts.forEach(opt => {
    opt.addEventListener('click', () => {
      els.styleOpts.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      state.summaryStyle = opt.dataset.style;
    });
  });

  els.summarizeBtn.addEventListener('click', startSummarize);
  els.retryBtn.addEventListener('click',     startSummarize);
  els.copyBtn.addEventListener('click',      copyToClipboard);
  els.highlightBtn.addEventListener('click', toggleHighlight);
  els.clearBtn.addEventListener('click',     clearResult);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSettings();
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));
