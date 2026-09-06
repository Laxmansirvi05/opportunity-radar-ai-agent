'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMainContent } = require('../src/content-extractor');

test('Readability extracts job content while excluding navigation', () => {
  const article = extractMainContent('<html><body><nav>Jobs Home</nav><article><h1>Software Intern</h1><p>Build useful products with Node.js.</p><p>Apply by Friday.</p></article></body></html>');
  assert.match(article.text, /Software Intern/);
  assert.match(article.text, /Node\.js/);
  assert.doesNotMatch(article.text, /Jobs Home/);
});
