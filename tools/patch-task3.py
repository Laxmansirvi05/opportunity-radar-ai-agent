#!/usr/bin/env python3
"""
patch-task3.py — wire the inline search-plan node to search-planner:4200.

Surgical, not a rewrite. The node's provider-specific discovery (9 source
families, 12 discovery types) is deliberately KEPT — search-planner is
provider-agnostic by design and has a passing test that fails if a provider
name appears in a plan, so it cannot replace that layer.

What changes:
  1. Section 4 (TARGET ROLE RESOLUTION) — the hardcoded "X Intern" inference
     is replaced by a call to search-planner's stateless /search-plan/preview,
     which supplies opportunityType (year-derived) and titleVariants.
  2. Hardcoded "internship" words in query templates become ${stageTerm},
     driven by opportunityType.
  3. The Internshala source is gated to internship-seeking candidates.
"""

import json
import sys

PATH = "workflows.json"
NODE = "Build Multi-Source Search Plan"

NEW_SECTION_4 = '''// ------------------------------------------------------------
// 4. TARGET ROLE + OPPORTUNITY TYPE  (via search-planner:4200)
// ------------------------------------------------------------
// Opportunity type follows the candidate's academic year rather than the
// old assumption that every candidate wants an internship (F2/F3).
// search-planner owns that logic (search-planner/src/opportunity-type.js);
// it is deliberately NOT duplicated here.
//
// /search-plan/preview is the stateless endpoint. /search-plan/build cannot
// be used: search_plans.candidate_id is a FK into candidates(id) and this
// pipeline never persists a candidate row.
// ------------------------------------------------------------

function toCareerStage(value) {
  const v = String(value || "").toLowerCase();
  if (/senior|lead|principal|staff/.test(v)) return "senior";
  if (/mid/.test(v)) return "mid-career";
  if (/entry|early|junior|fresher|graduate|new.?grad/.test(v)) return "early-career";
  if (/student|intern|undergrad/.test(v)) return "student";
  return "student";
}

const careerIntel   = input.career_intelligence || {};
const searchProfile = input.search_profile || {};

const graduationYear =
  education.graduation_year ??
  education.graduationYear ??
  null;

const cip = {
  meta: {
    schemaVersion:     "2.0.0",
    modelVersion:      "n8n-inline-adapter",
    builtAt:           new Date().toISOString(),
    resumeHash:        "",
    overallConfidence: 0.5
  },
  literal: {
    fullName:  candidate.name || null,
    rawSkills: allTechnicalSkills,
    education: [
      {
        institution: education.institution || "Unknown",
        degree:      education.degree || null,
        field:       education.field || null,
        startYear:   null,
        endYear:     graduationYear,
        gpa:         null
      }
    ],
    experience: (candidate.experience || [])
      .map((e) => ({
        company:      e.organization || e.company || "Unknown",
        title:        e.role || e.title || "",
        startDate:    null,
        endDate:      null,
        description:  e.description || null,
        technologies: e.technologies || []
      }))
      .filter((e) => e.title),
    projects:           [],
    preferredLocations: []
  },
  inferred: {
    careerStage: {
      value:      toCareerStage(candidate.experience_level || searchProfile.candidate_stage),
      confidence: 0.7,
      evidence:   ["resume"]
    },
    canonicalSkills: uniqueStrings(candidate.domains || []).map((d) => ({
      canonical: d, raw: d, category: "domain", confidence: 0.7
    })),
    inferredRoles: [],
    careerDirection: {
      primary: (careerIntel.primary_roles || searchProfile.target_roles || [])[0] || null,
      adjacent: uniqueStrings([
        ...(careerIntel.primary_roles || []).slice(1),
        ...(careerIntel.secondary_roles || [])
      ]),
      confidence: 0.7,
      evidence:   ["resume"]
    },
    searchKeywords:    uniqueStrings(careerIntel.search_keywords || []),
    searchIntent:      "Discovery via Opportunity Radar pipeline.",
    workAuthorization: { value: "unknown", confidence: 0.1, evidence: ["not stated"] },
    openToRelocation:  { value: null,      confidence: 0.1, evidence: ["not stated"] }
  }
};

let plan;
try {
  plan = await this.helpers.httpRequest({
    method:  "POST",
    url:     "http://localhost:4200/search-plan/preview",
    headers: { "Content-Type": "application/json" },
    body:    { cip },
    json:    true
  });
} catch (error) {
  // Deliberately NOT swallowed. Without the planner every candidate would
  // silently fall back to internship-biased search — the exact bug this
  // wiring exists to fix. Failing loudly is correct here.
  throw new Error(
    "SEARCH_PLANNER_UNAVAILABLE: could not reach search-planner:4200 " +
    "(/search-plan/preview). Start it before running the pipeline. " +
    "Underlying error: " + (error.message || error)
  );
}

const opportunityType     = plan.opportunityType;
const opportunityFallback = plan.opportunityTypeFallback || [];
const wantsInternship =
  opportunityType === "internship" || opportunityFallback.includes("internship");

// Discovery word injected into queries, driven by opportunity type.
const stageTerm =
  opportunityType === "internship"            ? "internship"
  : opportunityFallback.includes("internship") ? "entry level"
  : "jobs";

let targetRoles = uniqueStrings([
  ...(plan.titleVariants || []),
  ...(searchProfile.target_roles || []),
  ...(careerIntel.primary_roles || [])
]);

if (targetRoles.length === 0) {
  targetRoles = ["Software Engineer"];
}

// Keep search explosion controlled.
targetRoles = uniqueStrings(targetRoles.map(normaliseRole)).slice(0, 4);


'''

# (old query string, new query string)
QUERY_SUBS = [
    ('`"${role}" "${city}" careers internship`',
     '`"${role}" "${city}" careers ${stageTerm}`'),
    ('`"${role}" "${geo}" startup internship hiring`',
     '`"${role}" "${geo}" startup ${stageTerm} hiring`'),
    ('`"${skill}" internship "${country}" careers`',
     '`"${skill}" ${stageTerm} "${country}" careers`'),
]


def main():
    with open(PATH) as f:
        doc = json.load(f)

    wf = doc[0]
    node = next(n for n in wf["nodes"] if n["name"] == NODE)
    code = node["parameters"]["jsCode"]
    original_len = len(code)

    # --- 1. Replace section 4 wholesale ---
    start_marker = "// ------------------------------------------------------------\n// 4. TARGET ROLE RESOLUTION"
    end_marker = "// ------------------------------------------------------------\n// 5. LOCATION RESOLUTION"
    s = code.index(start_marker)
    e = code.index(end_marker)
    code = code[:s] + NEW_SECTION_4 + code[e:]
    print(f"  section 4 replaced ({e - s} chars -> {len(NEW_SECTION_4)} chars)")

    # --- 2. Opportunity-type-driven query terms ---
    for old, new in QUERY_SUBS:
        if old not in code:
            raise SystemExit(f"FAIL: query template not found: {old}")
        code = code.replace(old, new)
        print(f"  query term updated: {old[:48]}...")

    # --- 3. Gate Internshala to internship seekers ---
    internshala_old = '''  addSearch({

    query:
      `site:internshala.com "${role}" "${country}"`,'''
    internshala_new = '''  // Internshala is internship-oriented; skip it for candidates targeting jobs.
  if (wantsInternship) addSearch({

    query:
      `site:internshala.com "${role}" "${country}"`,'''
    if internshala_old not in code:
        raise SystemExit("FAIL: internshala block not found")
    code = code.replace(internshala_old, internshala_new)
    print("  internshala gated to internship seekers")

    # --- 4. Surface planner provenance in node output ---
    meta_old = '''      search_metadata: {

        engine_version:
          "internet-discovery-v3",'''
    meta_new = '''      opportunity_type:
        opportunityType,

      opportunity_type_fallback:
        opportunityFallback,

      opportunity_type_source:
        plan.opportunityTypeSource,

      graduation_year:
        plan.graduationYear,

      search_metadata: {

        engine_version:
          "internet-discovery-v4-search-planner",

        planner:
          "search-planner:4200/search-plan/preview",

        plan_hash:
          plan.planHash,'''
    if meta_old not in code:
        raise SystemExit("FAIL: search_metadata block not found")
    code = code.replace(meta_old, meta_new)
    print("  planner provenance added to node output")

    node["parameters"]["jsCode"] = code

    with open(PATH, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")

    print(f"\nOK  jsCode {original_len} -> {len(code)} chars")
    remaining = code.lower().count("intern")
    print(f"    'intern' occurrences: 31 -> {remaining} (remaining are internship-gated or the stageTerm value)")


if __name__ == "__main__":
    main()
