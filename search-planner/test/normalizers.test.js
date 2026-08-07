'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { normalizeTitle, normalizeTitles, expandTitleForStage, SENIOR_QUALIFIERS }
  = require('../src/normalizers/title-normalizer');
const { normalizeSkill, normalizeSkills, categorizeSkills, prioritizedSkillList }
  = require('../src/normalizers/skill-normalizer');
const { classifyLocation, normalizeLocations, locationStrings }
  = require('../src/normalizers/location-normalizer');

// ---------------------------------------------------------------------------
// Title normalizer
// ---------------------------------------------------------------------------

test('normalizeTitle: resolves known alias swe → Software Engineer', () => {
  assert.equal(normalizeTitle('swe'), 'Software Engineer');
});

test('normalizeTitle: resolves case-insensitively via toLowerCase', () => {
  // normalizeTitle lowercases before alias lookup
  assert.equal(normalizeTitle('SDE'), 'Software Engineer');
  assert.equal(normalizeTitle('sde'), 'Software Engineer');
  assert.equal(normalizeTitle('SWE'), 'Software Engineer');
});

test('normalizeTitle: returns original when no alias found', () => {
  assert.equal(normalizeTitle('Quantum Researcher'), 'Quantum Researcher');
});

test('normalizeTitles: deduplicates case-insensitively', () => {
  // 'backend developer' → alias 'Backend Engineer'; same as first entry → deduplicated to 1.
  const result = normalizeTitles(['Backend Engineer', 'backend engineer', 'Backend Developer']);
  assert.equal(result.length, 1);
  assert.equal(result[0], 'Backend Engineer');
});

test('normalizeTitles: removes senior qualifiers for student/early-career', () => {
  const titles = ['Senior Backend Engineer', 'Staff Engineer', 'Backend Engineer'];
  assert.deepEqual(normalizeTitles(titles, 'student'), ['Backend Engineer']);
  assert.deepEqual(normalizeTitles(titles, 'early-career'), ['Backend Engineer']);
});

test('normalizeTitles: preserves senior qualifiers for senior/mid-career', () => {
  // A senior candidate's own title must survive normalization — stripping it
  // would search for junior roles on their behalf.
  const titles = ['Senior Backend Engineer', 'Staff Engineer', 'Backend Engineer'];
  assert.deepEqual(normalizeTitles(titles, 'senior'), titles);
  assert.deepEqual(normalizeTitles(titles, 'mid-career'), titles);
});

test('normalizeTitles: handles empty array', () => {
  assert.deepEqual(normalizeTitles([]), []);
});

test('expandTitleForStage: student → intern suffixes', () => {
  const variants = expandTitleForStage('Backend Engineer', 'student');
  assert.ok(variants.some((v) => v.includes('Intern')));
});

test('expandTitleForStage: opportunityType overrides careerStage for titles', () => {
  // A final-year student is careerStage "student" but targets jobs. Without the
  // override they would get "Backend Engineer Intern" titles alongside an
  // "entry level" keyword — contradictory queries that search the wrong roles.
  const jobVariants = expandTitleForStage('Backend Engineer', 'student', 'job');
  assert.ok(!jobVariants.some((v) => /intern/i.test(v)), 'job target must not produce Intern titles');
  assert.ok(jobVariants.includes('Backend Engineer'), 'bare title expected');
  assert.ok(jobVariants.some((v) => v.includes('Entry Level')), 'Entry Level variant expected');

  // And the internship target still produces intern titles for the same stage.
  const internVariants = expandTitleForStage('Backend Engineer', 'student', 'internship');
  assert.ok(internVariants.every((v) => /intern/i.test(v)), 'internship target expects Intern titles');
});

test('expandTitleForStage: early-career → includes bare title and prefixed variants', () => {
  const variants = expandTitleForStage('Backend Engineer', 'early-career');
  // ENTRY_SUFFIXES = ['', 'Junior', 'Entry Level', 'New Grad']
  // Empty suffix produces the bare title; others produce prefixed forms.
  assert.ok(variants.includes('Backend Engineer'),            'bare title expected');
  assert.ok(variants.some((v) => v.includes('Junior')),       'Junior variant expected');
  assert.ok(variants.some((v) => v.includes('Entry Level')),  'Entry Level variant expected');
});

test('SENIOR_QUALIFIERS: detects senior keyword', () => {
  assert.ok(SENIOR_QUALIFIERS.test('Senior Software Engineer'));
  assert.ok(!SENIOR_QUALIFIERS.test('Software Engineer'));
});

// ---------------------------------------------------------------------------
// Skill normalizer
// ---------------------------------------------------------------------------

test('normalizeSkill: resolves js → JavaScript', () => {
  assert.equal(normalizeSkill('js'), 'JavaScript');
});

test('normalizeSkill: resolves postgres → PostgreSQL', () => {
  assert.equal(normalizeSkill('postgres'), 'PostgreSQL');
});

test('normalizeSkill: returns original for unknown skill', () => {
  assert.equal(normalizeSkill('Haskell'), 'Haskell');
});

test('normalizeSkills: deduplicates normalized names', () => {
  const result = normalizeSkills(['js', 'JavaScript', 'javascript']);
  assert.equal(result.length, 1);
  assert.equal(result[0], 'JavaScript');
});

test('categorizeSkills: separates by category', () => {
  const cipSkills = [
    { name: 'Python', category: 'technical' },
    { name: 'Agile',  category: 'soft'      },
    { name: 'Docker', category: 'tool'      },
  ];
  const cats = categorizeSkills(cipSkills);
  assert.ok(cats.technical.includes('Python'));
  assert.ok(cats.soft.includes('Agile'));
  assert.ok(cats.tool.includes('Docker'));
});

test('prioritizedSkillList: technical skills come first', () => {
  const cipSkills = [
    { name: 'Agile',  category: 'soft'      },
    { name: 'Python', category: 'technical' },
    { name: 'Docker', category: 'tool'      },
  ];
  const list = prioritizedSkillList(cipSkills);
  assert.equal(list[0], 'Python');
});

// ---------------------------------------------------------------------------
// Location normalizer
// ---------------------------------------------------------------------------

test('classifyLocation: remote', () => {
  assert.equal(classifyLocation('Remote'), 'remote');
  assert.equal(classifyLocation('Work From Home'), 'remote');
});

test('classifyLocation: national (USA)', () => {
  assert.equal(classifyLocation('United States'), 'national');
  assert.equal(classifyLocation('USA'), 'national');
});

test('classifyLocation: local (City, ST)', () => {
  assert.equal(classifyLocation('San Francisco, CA'), 'local');
  assert.equal(classifyLocation('Austin, TX'), 'local');
});

test('classifyLocation: regional (bare state abbrev)', () => {
  assert.equal(classifyLocation('CA'), 'regional');
});

test('normalizeLocations: empty input → default national + remote', () => {
  const result = normalizeLocations([]);
  const tiers  = result.map((l) => l.tier);
  assert.ok(tiers.includes('national'));
  assert.ok(tiers.includes('remote'));
});

test('normalizeLocations: deduplicates case-insensitively', () => {
  const result = normalizeLocations(['Remote', 'remote', 'REMOTE']);
  assert.equal(result.filter((l) => l.tier === 'remote').length, 1);
});

test('normalizeLocations: always appends remote if not present', () => {
  const result = normalizeLocations(['San Francisco, CA']);
  assert.ok(result.some((l) => l.tier === 'remote'));
});

test('locationStrings: returns flat string array', () => {
  const locs = [{ location: 'San Francisco, CA', tier: 'local' }, { location: 'Remote', tier: 'remote' }];
  assert.deepEqual(locationStrings(locs), ['San Francisco, CA', 'Remote']);
});
