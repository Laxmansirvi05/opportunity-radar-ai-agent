'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findDuplicate } = require('../src/duplicate-detector');
test('detects title/org fuzzy and supplied pgvector duplicates', () => {
  assert.equal(findDuplicate({ title: 'Software Engineering Intern', company: 'Acme' }, [{ title: 'Software Engineer Internship', company: 'Acme' }]).reason, 'title_org_fuzzy');
  assert.equal(findDuplicate({ title: 'Different', company: 'Else' }, [{ title: 'Other', company: 'Org', semantic_similarity: 0.95 }]).reason, 'pgvector_semantic');
});
