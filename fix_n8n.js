const fs = require('fs');
const workflows = JSON.parse(fs.readFileSync('workflows.json', 'utf8'));

const scoreCode = `const candidate = $('Code in JavaScript').first().json.candidate || {};
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
  if (error.response && error.response.statusCode === 502) {
    throw new Error('The limit has been exceeded');
  } else if (error.error && error.error.includes && error.error.includes('limit has been exceeded')) {
    throw new Error('The limit has been exceeded');
  }
  
  console.log('AI Gateway call failed for opportunity:', error.message);
  opportunity.score = null;
  opportunity.reasoning = 'Scoring failed due to timeout or error';
}

return [{ json: opportunity }];
`;

for (const wf of workflows) {
  const rankNode = wf.nodes.find(n => n.name === 'Parse + Rank Opportunities');
  if (rankNode) {
    rankNode.parameters.jsCode = scoreCode;
    console.log('Updated Parse + Rank Opportunities logic');
  }
}

fs.writeFileSync('workflows.json', JSON.stringify(workflows, null, 2));
console.log('Updated workflows.json');
