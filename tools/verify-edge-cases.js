'use strict';

/**
 * verify-edge-cases.js — observed behaviour for the mandated edge cases that
 * can be exercised offline. Records ACTUAL behaviour, including bad behaviour.
 * Zero network calls.
 */

const path = require('path');
const { runNode, loadFixture } = require('./replay');
const { composeSearchPlan } = require(path.resolve(__dirname, '..', 'search-planner/src/search-planner'));
const { deriveOpportunityTarget } = require(path.resolve(__dirname, '..', 'search-planner/src/opportunity-type'));

const results = [];
function record(area, name, observed, ok) {
  results.push({ area, name, observed, ok });
}

function plannerStub() {
  return async ({ body }) => {
    const { planJson, components, planHash } = composeSearchPlan({ cip: body.cip });
    return {
      planVersion: planJson.planVersion, planHash, queryCount: planJson.queries.length,
      opportunityType: components.opportunityTarget.primary,
      opportunityTypeFallback: components.opportunityTarget.fallback,
      opportunityTypeSource: components.opportunityTarget.source,
      opportunityTypeFallbackReason: components.opportunityTarget.fallbackReason,
      studentStatus: components.opportunityTarget.studentStatus,
      isCurrentStudent: components.opportunityTarget.isCurrentStudent,
      graduationYear: components.opportunityTarget.endYear,
      careerStage: components.careerStage, titleVariants: components.titleVariants,
      skills: components.skills, exclusions: components.exclusions,
      locations: components.locations, queries: planJson.queries, meta: planJson.meta,
    };
  };
}

async function planFor(profile) {
  return runNode('Build Multi-Source Search Plan', {
    input: [profile], nodes: {}, helpers: { httpRequest: plannerStub() },
  });
}

function baseProfile(overrides = {}) {
  const base = JSON.parse(JSON.stringify(loadFixture('candidate')[0]));
  return { ...base, ...overrides };
}

async function pipeline(items, candidate) {
  const finalized = await runNode('Finalize Results', { input: items, nodes: { 'Code in JavaScript': candidate } });
  const allocated = await runNode('Geographic Allocator', { input: finalized, nodes: { 'Code in JavaScript': candidate } });
  const resp = await runNode('Build Response', {
    input: allocated, nodes: { 'Code in JavaScript': candidate, 'Finalize Results': finalized },
  });
  return resp[0];
}

function synth(n, score, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Role ${i}`, company: `Co${i}`, score, scoring_status: 'scored',
    state: 'Telangana', country: 'India', missing_requirements: [],
    application_url: `https://boards.greenhouse.io/co${i}/jobs/${1000 + i}`, ...extra,
  }));
}

(async () => {
  const CY = new Date().getFullYear();
  const candidate = loadFixture('candidate');

  // ---------------- Year routing ----------------
  for (const [label, year, stage, expectStatus] of [
    ['2nd-year student', CY + 3, 'student', 'student'],
    ['final-year student', CY + 1, 'student', 'student'],
    ['graduated (past endYear)', CY - 2, 'early-career', 'graduated'],
  ]) {
    const t = deriveOpportunityTarget({ education: [{ endYear: year }], careerStage: stage, currentYear: CY });
    record('student-status guard', label,
      `-> ${t.primary}, studentStatus ${t.studentStatus} (source ${t.source})`,
      t.primary === 'internship' && t.studentStatus === expectStatus);
  }
  {
    const t = deriveOpportunityTarget({ education: [{ endYear: 'not a year' }], careerStage: 'student', currentYear: CY });
    record('student-status guard', 'missing/unparseable endYear',
      `-> ${t.primary}, source "${t.source}", fallback recorded: ${!!t.fallbackReason}`,
      t.primary === 'internship' && t.source === 'career_stage_fallback' && !!t.fallbackReason);
  }

  // ---------------- Resume inputs ----------------
  {
    const p = baseProfile();
    delete p.candidate.education;
    const out = await planFor(p);
    record('resume input', 'no education section',
      `-> opportunity_type ${out[0].opportunity_type}, source ${out[0].opportunity_type_source}`,
      out[0].opportunity_type_source === 'career_stage_fallback');
  }
  {
    const p = baseProfile();
    p.candidate.education = { graduation_year: CY + 3, institution: 'A' };
    p.candidate.experience = [];
    const out = await planFor(p);
    record('resume input', 'no work experience', `-> ${out.length} queries generated`, out.length > 0);
  }
  {
    const p = baseProfile();
    p.candidate.skills = []; p.candidate.programming_languages = [];
    p.candidate.frameworks = []; p.candidate.tools = []; p.candidate.domains = [];
    const out = await planFor(p);
    record('resume input', 'zero technical skills', `-> ${out.length} queries generated`, out.length > 0);
  }
  {
    const p = baseProfile();
    p.candidate.location = {};
    const out = await planFor(p);
    const geos = [...new Set(out.map((q) => q.geography))];
    record('resume input', 'no location anywhere', `-> ${out.length} queries, geographies ${JSON.stringify(geos)}`, out.length > 0);
  }
  {
    const p = baseProfile();
    p.candidate.education = [
      { degree: 'HSC', institution: 'S', graduation_year: CY - 6 },
      { degree: 'B.Tech', institution: 'X', graduation_year: CY + 2 },
    ];
    const out = await planFor(p);
    record('resume input', 'multiple degrees (array form)',
      `-> gradYear ${out[0].graduation_year}, source ${out[0].opportunity_type_source}, student_status ${out[0].student_status}`,
      out[0].graduation_year === CY + 2 && out[0].opportunity_type_source === 'education_end_year');

    // Graduate whose earlier degree is older — must not fall back to internships.
    const g = baseProfile();
    g.candidate.education = [
      { degree: 'B.Tech', institution: 'X', graduation_year: CY - 4 },
      { degree: 'M.Tech', institution: 'Y', graduation_year: CY - 1 },
    ];
    g.candidate.experience_level = 'early_career';
    const gOut = await planFor(g);
    record('resume input', 'graduate with multiple degrees',
      `-> ${gOut[0].opportunity_type}, gradYear ${gOut[0].graduation_year}, student_status ${gOut[0].student_status}`,
      gOut[0].opportunity_type === 'internship' && gOut[0].graduation_year === CY - 1
      && gOut[0].student_status === 'graduated');
  }
  {
    const t = deriveOpportunityTarget({
      education: [{ endYear: CY - 6 }, { endYear: CY + 2 }, { endYear: CY - 1 }],
      careerStage: 'student', currentYear: CY,
    });
    record('resume input', 'multiple degrees, overlapping years (planner)',
      `-> uses most recent endYear ${t.endYear} -> ${t.primary}`, t.endYear === CY + 2);
  }
  {
    const p = baseProfile();
    p.candidate.experience_level = 'senior';
    p.candidate.education = { graduation_year: CY - 10, institution: 'X' };
    const out = await planFor(p);
    const internish = out.filter((q) => /intern/i.test(q.query)).length;
    record('resume input', 'experienced professional, not a student',
      `-> ${out[0].opportunity_type}, student_status ${out[0].student_status}, ${internish} queries mention intern`,
      out[0].opportunity_type === 'internship' && out[0].student_status !== 'student');
  }

  // ---------------- Pipeline conditions ----------------
  {
    const r = await pipeline([], candidate);
    record('pipeline', 'zero opportunities reach scoring',
      `-> status ${r.status}, count ${r.opportunity_count}`, r.opportunity_count === 0);
  }
  {
    const allFailed = Array.from({ length: 8 }, (_, i) => ({
      title: `F${i}`, score: null, scoring_status: 'failed', scoring_error: 'PROVIDERS_UNAVAILABLE',
      application_url: `https://boards.greenhouse.io/f/jobs/${3000 + i}`,
    }));
    const r = await pipeline(allFailed, candidate);
    const named = (r.weak_profile?.reasons || []).some((x) => /could not be scored/.test(x));
    record('pipeline', 'scoring fails for EVERY item',
      `-> status ${r.status}, scoring ${JSON.stringify(r.scoring)}, cause named: ${named}`,
      named && r.scoring.failed === 8 && r.scoring.succeeded === 0);
  }
  {
    const r = await pipeline(synth(12, 20), candidate);
    record('pipeline', 'only junk / all below score floor',
      `-> status ${r.status}, count ${r.opportunity_count}, below_floor ${r.allocation.below_score_floor}`,
      r.opportunity_count === 0);
  }
  {
    const r = await pipeline(synth(3, 88), candidate);
    record('pipeline', 'fewer than 5 qualify',
      `-> status ${r.status}, returned ${r.opportunity_count}, weak block present ${!!r.weak_profile}`,
      r.status === 'weak_profile' && r.opportunity_count === 3);
  }
  {
    const r = await pipeline([...synth(12, 95), ...synth(8, 72)], candidate);
    const scores = r.opportunities.map((o) => o.score);
    record('pipeline', 'more than 10 qualify',
      `-> ${r.opportunity_count} returned, scores ${JSON.stringify(scores)}, quota ${r.allocation.quota_status}`,
      r.opportunity_count === 10 && scores.every((s) => s === 95));
  }
  {
    const r = await pipeline(synth(11, 85), candidate);
    const tiers = [...new Set(r.opportunities.map((o) => o.tier))];
    record('pipeline', 'all results in one geographic bucket',
      `-> ${r.opportunity_count} returned, tiers ${JSON.stringify(tiers)}`,
      r.opportunity_count === 10);
  }

  // ---------------- Report ----------------
  console.log('=== EDGE CASE OBSERVED BEHAVIOUR (offline) ===\n');
  let area = null;
  for (const r of results) {
    if (r.area !== area) { area = r.area; console.log(`\n## ${area}`); }
    console.log(`  ${r.ok ? 'OK  ' : 'NOTE'}  ${r.name}`);
    console.log(`          ${r.observed}`);
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length} cases exercised, ${bad.length} flagged for review.`);
  if (bad.length) {
    console.log('\nFLAGGED:');
    for (const b of bad) console.log(`  - [${b.area}] ${b.name}: ${b.observed}`);
  }
})().catch((e) => { console.error('HARNESS FAILED:', e); process.exit(1); });
