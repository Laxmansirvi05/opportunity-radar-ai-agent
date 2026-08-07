#!/usr/bin/env python3
"""
patch-task5.py — weak-resume exit with honest gap aggregation.

Adds a "Build Response" node after Geographic Allocator that produces the
final service response, and takes the weak-resume path when fewer than 5
opportunities qualify.

Gated on task-1: gaps are aggregated ONLY over successfully-scored items.
Aggregating over a set with unacknowledged failures would tell a strong
candidate their resume is weak because a provider throttled us.
"""

import json

PATH = "workflows.json"
NEW_NODE = "Build Response"
AFTER = "Geographic Allocator"

CODE = r'''// ============================================================
// BUILD RESPONSE
// ============================================================
// Produces the final service response and decides between the normal path
// and the weak-resume path.
//
// Gap feedback is aggregated ONLY over successfully-scored opportunities.
// If half the scoring failed to rate limits, aggregating across the whole
// set would tell a strong candidate their resume is weak because a provider
// throttled us — false, discouraging feedback that is worse than none.
// ============================================================

const MIN_USEFUL_COUNT = 5;

// A gap must appear in at least this many postings to be reported. One
// mention is noise, not a pattern.
const MIN_GAP_FREQUENCY = 2;

// The scoring model sometimes reports missing SCHEMA FIELDS rather than
// missing candidate skills ("job description", "location", "workplace type").
// Those describe a thin posting, not a gap in the resume, and must never be
// shown to a student as something they lack.
const SCHEMA_ARTIFACT_TERMS = new Set([
  'job description', 'description', 'required skills', 'requirements',
  'location', 'workplace type', 'employment type', 'employment type details',
  'salary', 'compensation', 'deadline', 'company', 'title', 'none',
  'not specified', 'n/a', 'unknown', 'experience', 'qualifications'
]);

const allocatorItems = $input.all().map(i => i.json);

// The allocator emits an explicit empty carrier when nothing qualified.
const isEmptyCarrier =
  allocatorItems.length === 1 && Array.isArray(allocatorItems[0].opportunities);

const opportunities = isEmptyCarrier ? [] : allocatorItems;

const allocationSummary =
  (isEmptyCarrier ? allocatorItems[0].allocation_summary : opportunities[0]?.allocation_summary) || {};

const scoringSummary = allocationSummary.scoring || null;

// Successfully-scored pool, for gap aggregation.
let scoredPool = [];
try {
  scoredPool = $('Finalize Results').all()
    .map(i => i.json)
    .filter(o => o && o.scoring_status === 'scored');
} catch (e) {
  scoredPool = [];
}

function canonicalGap(raw) {
  let g = String(raw || '').trim().toLowerCase();
  if (!g) return null;
  // Drop parenthetical examples: "ml frameworks (e.g. pytorch)" -> "ml frameworks"
  g = g.replace(/\s*\((?:e\.?g\.?|i\.?e\.?)[^)]*\)/g, '').trim();
  g = g.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
  if (!g || g.length < 2 || g.length > 60) return null;
  if (SCHEMA_ARTIFACT_TERMS.has(g)) return null;
  return g;
}

function aggregateGaps(pool) {
  const counts = new Map();
  let contributing = 0;

  for (const opp of pool) {
    const reqs = Array.isArray(opp.missing_requirements) ? opp.missing_requirements : [];
    if (reqs.length === 0) continue;
    contributing += 1;
    // Count each gap at most once per posting.
    const seen = new Set();
    for (const raw of reqs) {
      const g = canonicalGap(raw);
      if (!g || seen.has(g)) continue;
      seen.add(g);
      counts.set(g, (counts.get(g) || 0) + 1);
    }
  }

  const gaps = [...counts.entries()]
    .filter(([, n]) => n >= MIN_GAP_FREQUENCY)
    .sort((a, b) => b[1] - a[1])
    .map(([skill, n]) => ({
      skill,
      postings_requiring: n,
      of_postings_analyzed: contributing,
      message: `${n} of ${contributing} relevant roles wanted ${skill}, which your resume doesn't show.`
    }));

  return { gaps, postings_analyzed: contributing };
}

const { gaps, postings_analyzed } = aggregateGaps(scoredPool);

const sufficient = opportunities.length >= MIN_USEFUL_COUNT;

// Honest diagnosis of WHY the list is short — "only 4 good matches exist" and
// "9 existed but 5 failed to score" are completely different situations.
const reasons = [];
if (!sufficient) {
  if (scoringSummary && scoringSummary.failed > 0) {
    reasons.push(
      `${scoringSummary.failed} of ${scoringSummary.attempted} opportunities could not be scored ` +
      `(provider errors), so they were excluded rather than guessed at.`
    );
  }
  if (allocationSummary.below_score_floor > 0) {
    reasons.push(
      `${allocationSummary.below_score_floor} scored below the minimum fit threshold ` +
      `of ${allocationSummary.min_score} and were not padded into the results.`
    );
  }
  if (reasons.length === 0) {
    reasons.push('Too few relevant open postings were discovered for this profile.');
  }
}

const response = {
  status: sufficient ? 'ok' : 'weak_profile',
  opportunity_count: opportunities.length,
  opportunities,
  scoring: scoringSummary,
  allocation: allocationSummary,
};

if (!sufficient) {
  response.weak_profile = {
    // Whatever genuinely qualified is still returned — never an empty list
    // when real matches exist.
    returned: opportunities.length,
    minimum_expected: MIN_USEFUL_COUNT,
    reasons,
    gaps,
    gaps_note: gaps.length === 0
      ? (postings_analyzed === 0
          ? 'No successfully-scored postings were available to derive gaps from.'
          : `No skill gap appeared in at least ${MIN_GAP_FREQUENCY} of the ${postings_analyzed} scored postings, so none is reported as a pattern.`)
      : `Derived from ${postings_analyzed} successfully-scored postings.`
  };
}

return [{ json: response }];
'''


def main():
    with open(PATH) as f:
        doc = json.load(f)
    wf = doc[0]

    if any(n["name"] == NEW_NODE for n in wf["nodes"]):
        print(f"  {NEW_NODE} already present — replacing code")
        node = next(n for n in wf["nodes"] if n["name"] == NEW_NODE)
        node["parameters"]["jsCode"] = CODE
    else:
        anchor = next(n for n in wf["nodes"] if n["name"] == AFTER)
        pos = anchor.get("position", [0, 0])
        wf["nodes"].append({
            "parameters": {"jsCode": CODE},
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [pos[0] + 220, pos[1]],
            "id": "b1d3f0ce-7a21-4f55-9c30-weakresume01",
            "name": NEW_NODE,
        })
        conns = wf.setdefault("connections", {})
        conns.setdefault(AFTER, {"main": [[]]})
        conns[AFTER]["main"][0].append({"node": NEW_NODE, "type": "main", "index": 0})
        print(f"  added node {NEW_NODE} and connected {AFTER} -> {NEW_NODE}")

    with open(PATH, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print("OK")


if __name__ == "__main__":
    main()
