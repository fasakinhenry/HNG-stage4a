/**
 * content.js — Clarity Content Script
 *
 * Runs on every webpage. Listens for highlight/remove-highlight messages
 * from the popup and injects/cleans up visual highlights.
 */

let highlightedElements = [];
let clarityStyleEl = null;

// ─── Message Listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'HIGHLIGHT') {
    injectStyles();
    highlightKeyPhrases(message.payload.insights || []);
    sendResponse({ ok: true });
  }

  if (message.type === 'REMOVE_HIGHLIGHTS') {
    removeHighlights();
    sendResponse({ ok: true });
  }

  return true;
});

// ─── Inject Highlight Styles ──────────────────────────────────────────────────
function injectStyles() {
  if (clarityStyleEl) return; // already injected

  clarityStyleEl = document.createElement('style');
  clarityStyleEl.id = 'clarity-styles';
  clarityStyleEl.textContent = `
    .clarity-highlight {
      background: linear-gradient(120deg, rgba(82, 183, 136, 0.25) 0%, rgba(82, 183, 136, 0.15) 100%);
      border-bottom: 2px solid rgba(82, 183, 136, 0.6);
      border-radius: 2px;
      padding: 0 2px;
      cursor: help;
      transition: background 0.2s ease;
    }
    .clarity-highlight:hover {
      background: rgba(82, 183, 136, 0.35);
    }
    .clarity-badge {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #2D6A4F;
      color: white;
      padding: 8px 14px;
      border-radius: 20px;
      font-family: -apple-system, sans-serif;
      font-size: 13px;
      font-weight: 500;
      z-index: 999999;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(45, 106, 79, 0.4);
      display: flex;
      align-items: center;
      gap: 6px;
    }
  `;
  document.head.appendChild(clarityStyleEl);
}

// ─── Highlight Logic ──────────────────────────────────────────────────────────
function highlightKeyPhrases(insights) {
  removeHighlights(); // clean before adding

  // Extract meaningful phrases from insights (3+ word sequences)
  const phrases = extractPhrases(insights);
  if (!phrases.length) return;

  // Walk text nodes in main content area
  const contentRoot = findContentRoot();
  const walker = document.createTreeWalker(contentRoot, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      // Skip script, style, etc.
      if (['script', 'style', 'noscript', 'textarea', 'input'].includes(tag)) {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip already highlighted
      if (parent.classList.contains('clarity-highlight')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  let count = 0;
  textNodes.forEach(textNode => {
    const text = textNode.nodeValue;
    if (!text?.trim()) return;

    for (const phrase of phrases) {
      const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
      if (idx === -1) continue;

      try {
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + phrase.length);

        const mark = document.createElement('mark');
        mark.className = 'clarity-highlight';
        mark.title = '✦ Clarity highlighted this key phrase';
        range.surroundContents(mark);

        highlightedElements.push(mark);
        count++;
        break; // one highlight per text node
      } catch (e) {
        // Range errors are safe to ignore (e.g., crossing element boundaries)
      }
    }
  });

  // Show badge
  if (count > 0) {
    showBadge(count);
  }
}

// ─── Extract Phrases ──────────────────────────────────────────────────────────
function extractPhrases(insights) {
  const phrases = new Set();

  insights.forEach(insight => {
    // Split on punctuation, take meaningful chunks of 3-6 words
    const words = insight.split(/[\s,;:]+/).filter(w => w.length > 3);

    // Create 3-5 word windows
    for (let i = 0; i < words.length - 2; i++) {
      const phrase = words.slice(i, i + 3).join(' ');
      if (phrase.length > 12) phrases.add(phrase);
    }
  });

  return Array.from(phrases).slice(0, 12); // cap at 12 phrases
}

// ─── Remove Highlights ────────────────────────────────────────────────────────
function removeHighlights() {
  highlightedElements.forEach(el => {
    if (el.parentNode) {
      const text = document.createTextNode(el.textContent);
      el.parentNode.replaceChild(text, el);
    }
  });
  highlightedElements = [];
  removeBadge();
}

// ─── Find Content Root ────────────────────────────────────────────────────────
function findContentRoot() {
  return (
    document.querySelector('article') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('main') ||
    document.querySelector('.post-content') ||
    document.querySelector('.article-content') ||
    document.body
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function showBadge(count) {
  removeBadge();
  const badge = document.createElement('div');
  badge.id = 'clarity-badge';
  badge.className = 'clarity-badge';
  badge.innerHTML = `✦ Clarity highlighted ${count} key phrase${count !== 1 ? 's' : ''}`;
  document.body.appendChild(badge);
  setTimeout(removeBadge, 3000);
}

function removeBadge() {
  document.getElementById('clarity-badge')?.remove();
}
