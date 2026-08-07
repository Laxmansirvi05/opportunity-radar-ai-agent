const fs = require('fs');
const workflows = JSON.parse(fs.readFileSync('workflows.json', 'utf8'));

const allocatorCode = `// Retrieve candidate profile from earlier node
const candidate = $('Code in JavaScript').first().json.candidate || {};
const candLoc = candidate.location || {};

// All processed and scored opportunities
const opportunities = $input.all().map(item => item.json);

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
  buckets.same_state.sort(sortByScore);
  buckets.same_country.sort(sortByScore);
  buckets.international.sort(sortByScore);
  buckets.unresolved_location.sort(sortByScore);

  const allocated = [];

  // Helper to pull top N from a bucket and tag them
  const pull = (bucketName, count, tag) => {
    const bucket = buckets[bucketName];
    const pulled = bucket.splice(0, count);
    pulled.forEach(item => item.tier = tag);
    allocated.push(...pulled);
  };

  // 3. Initial Allocation
  pull('same_state', 7, 'same_state');
  pull('same_country', 2, 'same_country');
  pull('international', 1, 'international');

  // 4. Backfill to reach 10
  const needed = () => 10 - allocated.length;
  
  if (needed() > 0) pull('same_country', needed(), 'backfilled');
  if (needed() > 0) pull('international', needed(), 'backfilled');
  if (needed() > 0) pull('unresolved_location', needed(), 'backfilled');

  allocated.sort(sortByScore);

  let quota_status = "full";
  if (allocated.length < 10) {
    quota_status = "insufficient_data";
  } else {
    // Check if initial quotas were met
    const sameStateCount = allocated.filter(o => o.tier === 'same_state').length;
    if (sameStateCount < 7) {
      quota_status = "degraded";
    }
  }

  return {
    allocated,
    quota_status
  };
}

const result = allocateGeographicDistribution(opportunities, candLoc);

// n8n requires returning an array of items
return result.allocated.map(opp => {
  opp.quota_status = result.quota_status;
  return { json: opp };
});
`;

for (const wf of workflows) {
  // Check if it already has Geographic Allocator
  const hasAllocator = wf.nodes.find(n => n.name === 'Geographic Allocator');
  if (hasAllocator) {
    hasAllocator.parameters.jsCode = allocatorCode;
    console.log('Updated existing Geographic Allocator node');
    continue;
  }
  
  const allocatorNode = {
    "parameters": {
      "jsCode": allocatorCode
    },
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [
      1650,
      -448
    ],
    "id": "e45893a7-e123-4567-89ab-cdef01234567",
    "name": "Geographic Allocator"
  };
  
  wf.nodes.push(allocatorNode);
  
  // Update connections
  if (!wf.connections["Finalize Results"]) {
    wf.connections["Finalize Results"] = {
      "main": [
        [
          {
            "node": "Geographic Allocator",
            "type": "main",
            "index": 0
          }
        ]
      ]
    };
  }
}

fs.writeFileSync('workflows.json', JSON.stringify(workflows, null, 2));
console.log('Successfully injected Geographic Allocator into workflows.json');
