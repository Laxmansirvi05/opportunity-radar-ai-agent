#!/usr/bin/env python3
"""
patch-task4.py — score floor in the allocator + fix the tier contract (F5/F6).

Changes:
  - MIN_ALLOCATION_SCORE floor; nothing below it is allocated, including via
    backfill. Geographic widening is KEPT (it pulls real scored opportunities
    from wider buckets, which is desirable) — only the quality floor is added.
  - F6: "backfilled" is no longer emitted as a `tier`. tier stays strictly
    geographic (same_state | same_country | international | unresolved_location)
    and the widening signal moves to a separate `allocation_reason` field.
  - quota_status reports the honest situation instead of "full" after padding.
"""

import json

PATH = "workflows.json"
NODE = "Geographic Allocator"

NEW_CODE = r'''// ============================================================
// GEOGRAPHIC ALLOCATOR
// ============================================================
// Allocates scored opportunities across geographic tiers.
//
// Two rules matter here:
//   1. Quality floor — a low-scoring item is never shown just to reach 10.
//      Geographic WIDENING is kept (pulling real, well-scored opportunities
//      from wider buckets is desirable); only junk is excluded.
//   2. `tier` is strictly geographic. "backfilled" was previously emitted as
//      a fourth tier value, which no consumer of the contract expects. The
//      widening signal now lives in `allocation_reason` instead.
// ============================================================

// Minimum fit score for an opportunity to be shown at all.
// Judgment call: below ~50 the match is not useful to a student, and showing
// it costs more trust than the extra row is worth. Tunable in one place.
const MIN_ALLOCATION_SCORE = 50;

const TARGET_COUNT = 10;
const MIN_USEFUL_COUNT = 5;

// Retrieve candidate profile from earlier node
const candidate = $('Code in JavaScript').first().json.candidate || {};
const candLoc = candidate.location || {};

const allItems = $input.all().map(item => item.json);

// Carry the run-level scoring summary through untouched.
const scoringSummary =
  allItems.find(o => o && o.scoring_summary)?.scoring_summary || null;

// Only genuinely-scored items are eligible. A failed score is not a low score
// and must never be allocated, backfilled, or counted toward the honest total.
const scored = allItems.filter(
  opp => opp.scoring_status === 'scored' && typeof opp.score === 'number'
);

// Apply the quality floor. Tracked separately so the output can report how
// many real matches existed versus how many cleared the bar.
const eligible = scored.filter(opp => opp.score >= MIN_ALLOCATION_SCORE);
const belowFloor = scored.length - eligible.length;

function allocateGeographicDistribution(opportunities, candidateLocation) {
  const buckets = {
    same_state: [],
    same_country: [],
    international: [],
    unresolved_location: []
  };

  const candState = (candidateLocation?.state || '').trim().toLowerCase();
  const candCountry = (candidateLocation?.country || '').trim().toLowerCase();

  // 1. Bucket opportunities
  for (const opp of opportunities) {
    const oppState = (opp.state || (opp.location && opp.location.state) || '').trim().toLowerCase();
    const oppCountry = (opp.country || (opp.location && opp.location.country) || '').trim().toLowerCase();

    if (!oppCountry && !oppState) {
      buckets.unresolved_location.push(opp);
    } else if (oppCountry && candCountry && oppCountry !== candCountry) {
      buckets.international.push(opp);
    } else if (oppCountry === candCountry && oppState === candState && candState && oppState) {
      buckets.same_state.push(opp);
    } else if (oppCountry === candCountry && oppState !== candState) {
      buckets.same_country.push(opp);
    } else {
      buckets.unresolved_location.push(opp);
    }
  }

  // 2. Sort buckets by score descending
  const sortByScore = (a, b) => (b.overall_score || b.score || 0) - (a.overall_score || a.score || 0);
  for (const key of Object.keys(buckets)) buckets[key].sort(sortByScore);

  const allocated = [];

  // Pull top N from a bucket. `tier` is always the geographic bucket the item
  // actually came from; `allocation_reason` records whether it filled its own
  // quota or was pulled in while widening.
  const pull = (bucketName, count, reason) => {
    if (count <= 0) return;
    const pulled = buckets[bucketName].splice(0, count);
    for (const item of pulled) {
      item.tier = bucketName;
      item.allocation_reason = reason;
    }
    allocated.push(...pulled);
  };

  // 3. Initial allocation against the geographic target shape.
  pull('same_state', 7, 'quota');
  pull('same_country', 2, 'quota');
  pull('international', 1, 'quota');

  // 4. Widen to reach the target — real scored opportunities from wider
  //    buckets, all of which already cleared the score floor.
  const needed = () => TARGET_COUNT - allocated.length;
  pull('same_state', needed(), 'widened');
  pull('same_country', needed(), 'widened');
  pull('international', needed(), 'widened');
  pull('unresolved_location', needed(), 'widened');

  allocated.sort(sortByScore);
  return allocated;
}

const allocated = allocateGeographicDistribution(eligible, candLoc);

// Honest quota status — never "full" unless genuinely full of qualifying items.
let quota_status;
if (allocated.length >= TARGET_COUNT) {
  quota_status = 'full';
} else if (allocated.length >= MIN_USEFUL_COUNT) {
  quota_status = 'partial';
} else {
  quota_status = 'insufficient';
}

const sameStateCount = allocated.filter(o => o.tier === 'same_state').length;
const geographicTargetMet = sameStateCount >= 7;

const allocationSummary = {
  returned: allocated.length,
  target: TARGET_COUNT,
  quota_status,
  scored_candidates: scored.length,
  below_score_floor: belowFloor,
  min_score: MIN_ALLOCATION_SCORE,
  geographic_target_met: geographicTargetMet,
  scoring: scoringSummary
};

// Nothing to return is a legitimate outcome; do not fabricate rows.
if (allocated.length === 0) {
  return [{
    json: {
      opportunities: [],
      allocation_summary: allocationSummary,
      quota_status
    }
  }];
}

return allocated.map(opp => {
  opp.quota_status = quota_status;
  opp.allocation_summary = allocationSummary;
  return { json: opp };
});
'''


def main():
    with open(PATH) as f:
        doc = json.load(f)

    wf = doc[0]
    node = next(n for n in wf["nodes"] if n["name"] == NODE)
    before = node["parameters"]["jsCode"]
    node["parameters"]["jsCode"] = NEW_CODE

    with open(PATH, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")

    print(f"OK  {NODE}: {len(before)} -> {len(NEW_CODE)} chars")
    print("    - MIN_ALLOCATION_SCORE floor applied before any allocation")
    print("    - tier is now strictly geographic; widening moved to allocation_reason")
    print("    - quota_status: full | partial | insufficient (honest)")


if __name__ == "__main__":
    main()
