const fs = require('fs');

try {
  const content = fs.readFileSync('n8n_output.json', 'utf8');
  
  // The output might have some console logs before the actual JSON.
  // We can try to find the last valid JSON array or object.
  const lines = content.split('\n');
  let jsonStr = '';
  let inJson = false;
  
  for (const line of lines) {
    if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
      inJson = true;
    }
    if (inJson) {
      jsonStr += line + '\n';
    }
  }
  
  // Let's try a safer way: the output is usually the last block.
  // Wait, let's just use regex to extract the JSON.
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    // try to find the start of {"data":
    const idx = content.indexOf('{"data":');
    if (idx !== -1) {
      data = JSON.parse(content.substring(idx - 1)); // -1 for the opening brace
    } else {
      console.log("Could not parse json");
      process.exit(1);
    }
  }
  
  const lastNode = data.data.resultData.runData['Parse + Rank Opportunities'] || data.data.resultData.runData['Allocate Geography'];
  // Let's check which is the last node
  const lastNodeName = data.data.resultData.lastNodeExecuted;
  console.log("Last Node:", lastNodeName);
  
  const items = data.data.resultData.runData[lastNodeName][0].data.main[0][0];
  
  // If it's an array of items
  const finalItems = data.data.resultData.runData[lastNodeName][0].data.main[0];
  
  console.log("Total Time:", (data.data.resultData.runData[lastNodeName][0].startTime + data.data.resultData.runData[lastNodeName][0].executionTime) - data.data.startData.startTime, "ms");
  
  const opps = finalItems.map(item => item.json || item).map(o => ({
    title: o.title,
    tier: o.tier,
    fit_score: o.score || o.overall_score || o.fit_score,
    reasoning: o.reasoning,
    quota_status: o.quota_status
  }));
  
  console.log(JSON.stringify(opps, null, 2));

} catch (e) {
  console.error(e);
}
