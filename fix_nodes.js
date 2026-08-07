const fs = require('fs');

const workflows = JSON.parse(fs.readFileSync('workflows.json', 'utf8'));

const gatewayScoreCode = `const candidate = $('Code in JavaScript').first().json.candidate || {};
const opportunity = $input.first().json;

try {
  const response = await this.helpers.httpRequest({
    method: 'POST',
    url: 'http://localhost:4000/api/ai/chat',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.GATEWAY_API_KEY
    },
    body: {
      task: 'score_fit',
      input: { candidate, opportunity }
    },
    json: true
  });
  
  opportunity.score = response.data.fit_score;
  opportunity.reasoning = response.data.reasoning;
  opportunity.missing_requirements = response.data.missing_requirements;
  
} catch (error) {
  console.log('AI Gateway call failed for opportunity:', error.message);
  opportunity.score = 0;
  opportunity.reasoning = 'Scoring failed due to timeout or error';
  opportunity.missing_requirements = [];
}

return [{ json: opportunity }];
`;

const parseRankCode = `const item = $json.data || $json;
return [{ json: item }];
`;

let foundParse = false;
let foundResume = false;

for (const wf of workflows) {
  for (const node of wf.nodes) {
    if (node.name === 'Parse + Rank Opportunities') {
      node.parameters.jsCode = parseRankCode;
      foundParse = true;
    }
    if (node.name === 'Resume Match Engine') {
      node.parameters.jsCode = gatewayScoreCode;
      foundResume = true;
    }
  }
}

console.log('Parse + Rank Opportunities updated:', foundParse);
console.log('Resume Match Engine updated:', foundResume);

fs.writeFileSync('workflows.json', JSON.stringify(workflows, null, 2));
