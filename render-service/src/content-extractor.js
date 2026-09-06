'use strict';

const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

/** Extract Firefox Reader View-quality job text from rendered HTML. */
function extractMainContent(html, url = 'https://example.invalid/') {
  if (!html || typeof html !== 'string') return { title: null, text: '', html: '' };
  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article) return { title: null, text: '', html: '' };
    return {
      title: article.title || null,
      text: (article.textContent || '').replace(/\s+/g, ' ').trim(),
      html: article.content || '',
    };
  } catch {
    // Rendering itself succeeded; extraction failure is non-fatal and callers
    // retain the raw HTML for the existing downstream fallback.
    return { title: null, text: '', html: '' };
  }
}

module.exports = { extractMainContent };
