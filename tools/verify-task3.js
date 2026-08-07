'use strict';

/**
 * verify-task3.js — proves the search-planner wiring against the real captured
 * candidate, with zero network calls.
 *
 * The patched "Build Multi-Source Search Plan" node calls search-planner over
 * HTTP. Here that call is served IN-PROCESS by the real search-planner module
 * (composeSearchPlan), so we exercise the genuine planning logic and the
 * genuine node code without a live service or any API quota.
 */

const path = require('path');
const assert = require('assert');
const { runNode, loadFixture } = require('./replay');

const { composeSearchPlan } = require(path.resolve(__dirname, '..', 'search-planner/src/search-planner'));

/** Stand in for POST /search-plan/preview using the real planner module. */
function plannerStub() {
  return async ({ url, body }) => {
    assert.ok(/\/search-plan\/preview$/.test(url), `unexpected planner url: ${url}`);
    const { planJson, components, planHash } = composeSearchPlan({ cip: body.cip });
    return {
      planVersion:             planJson.planVersion,
      planHash,
      queryCount:              planJson.queries.length,
      opportunityType:         components.opportunityTarget.primary,
      opportunityTypeFallback: components.opportunityTarget.fallback,
      opportunityTypeSource:   components.opportunityTarget.source,
      opportunityTypeFallbackReason: components.opportunityTarget.fallbackReason,
      studentStatus:           components.opportunityTarget.studentStatus,
      isCurrentStudent:        components.opportunityTarget.isCurrentStudent,
      graduationYear:          components.opportunityTarget.endYear,
      careerStage:             components.careerStage,
      titleVariants:           components.titleVariants,
      skills:                  components.skills,
      exclusions:              components.exclusions,
      locations:               components.locations,
      queries:                 planJson.queries,
      meta:                    planJson.meta,
    };
  };
}

async function planFor(candidateJson) {
  return runNode('Build Multi-Source Search Plan', {
    input: [candidateJson],
    nodes: {},
    helpers: { httpRequest: plannerStub() },
  });
}

function withGradYear(base, year, level) {
  const c = JSON.parse(JSON.stringify(base));
  c.candidate.education = c.candidate.education || {};
  c.candidate.education.graduation_year = year;
  if (level) c.candidate.experience_level = level;
  return c;
}

function report(label, queries) {
  const all = queries.map((q) => String(q.query).toLowerCase());
  const internQ = all.filter((q) => /intern/.test(q)).length;
  const roles = [...new Set(queries.flatMap((q) => q.target_roles || []))];
  console.log(`\n--- ${label} ---`);
  console.log(`  queries generated   : ${queries.length}`);
  console.log(`  opportunity_type    : ${queries[0].opportunity_type}  (source: ${queries[0].opportunity_type_source}, gradYear: ${queries[0].graduation_year})`);
  console.log(`  student_status      : ${queries[0].student_status}  (is_current_student: ${queries[0].is_current_student})`);
  console.log(`  target_roles        : ${JSON.stringify(roles)}`);
  console.log(`  queries mentioning "intern": ${internQ}`);
  console.log(`  source families     : ${JSON.stringify([...new Set(queries.map((q) => q.source_family))])}`);
  console.log(`  sample queries      :`);
  for (const q of queries.slice(0, 3)) console.log(`      ${q.query}`);
  return {
    count: queries.length, internQ, roles,
    studentStatus: queries[0].student_status,
    isCurrentStudent: queries[0].is_current_student,
  };
}

(async () => {
  const base = loadFixture('candidate')[0];
  const CURRENT_YEAR = new Date().getFullYear();

  console.log('=== TASK 3: search-planner drives the inline discovery node ===');
  console.log(`(current year ${CURRENT_YEAR}; real captured candidate reused for all three cases)`);

  const second = report('2nd-year student (grad +3)',
    await planFor(withGradYear(base, CURRENT_YEAR + 3, 'student')));
  const finalYr = report('Final-year student (grad +1)',
    await planFor(withGradYear(base, CURRENT_YEAR + 1, 'student')));
  const grad = report('Graduated (grad -2)',
    await planFor(withGradYear(base, CURRENT_YEAR - 2, 'early_career')));

  console.log('\n=== ASSERTIONS ===');

  // Internships only: every candidate gets intern-oriented roles and queries.
  for (const [label, r] of [['2nd-year', second], ['final-year', finalYr], ['graduate', grad]]) {
    assert.equal(r.roles.every((x) => /intern/i.test(x)), true,
      `${label} roles should all be intern-oriented, got ${JSON.stringify(r.roles)}`);
    assert.ok(r.internQ > 0, `${label} queries should mention internship`);
  }
  console.log('  PASS  all three candidates -> internship roles and internship queries');

  // The year is now a guard, not a router: a graduate is still served
  // internships but must be flagged as not a current student.
  assert.equal(second.studentStatus, 'student', '2nd-year should be a current student');
  assert.equal(finalYr.studentStatus, 'student', 'final-year should still be a current student');
  assert.equal(grad.studentStatus, 'graduated', 'graduate should be flagged as graduated');
  assert.equal(grad.isCurrentStudent, false, 'graduate must not be marked a current student');
  console.log('  PASS  student-status guard: student / student / graduated (flagged, still served)');

  // Discovery breadth must not regress — this is why the node was not deleted.
  for (const [label, r] of [['2nd-year', second], ['final-year', finalYr], ['graduate', grad]]) {
    assert.ok(r.count >= 20, `${label}: discovery breadth collapsed to ${r.count} queries`);
  }
  console.log(`  PASS  discovery breadth preserved (${second.count}/${finalYr.count}/${grad.count} queries; search-planner alone yields ~9)`);

  console.log('\nALL TASK-3 FIXTURE ASSERTIONS PASSED (0 network calls)');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
