const fs = require('fs');
const workflows = JSON.parse(fs.readFileSync('workflows.json', 'utf8'));

let targetNode = null;
outer: for (const wf of workflows) {
  for (const node of wf.nodes) {
    if (node.name === "Code in JavaScript" && node.id === "86681c84-3012-42da-a670-1480767f056c") {
      targetNode = node;
      break outer;
    }
  }
}

if (!targetNode) {
  console.log("Node not found!");
  process.exit(1);
}

const newCode = `const raw = $json.content;

let data;

try {
  if (typeof raw === "object" && raw !== null) {
    data = raw;
  } else if (typeof raw === "string") {
    let cleaned = raw.trim();
    cleaned = cleaned
      .replace(/^\\s*\`\`\`(json)?/i, "")
      .replace(/\`\`\`\\s*$/i, "")
      .trim();

    try {
      data = JSON.parse(cleaned);
    } catch (err) {
      // Cleanup pass 2: find first { and last }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const extracted = cleaned.substring(firstBrace, lastBrace + 1);
        try {
          data = JSON.parse(extracted);
        } catch (err2) {
          throw new Error("RESUME_PARSE_FAILED: " + raw.substring(0, 300));
        }
      } else {
        throw new Error("RESUME_PARSE_FAILED: " + raw.substring(0, 300));
      }
    }
  } else {
    throw new Error("RESUME_PARSE_FAILED: Output was empty or unsupported.");
  }
} catch (error) {
  if (error.message && error.message.startsWith("RESUME_PARSE_FAILED")) {
    throw error;
  }
  throw new Error("RESUME_PARSE_FAILED: " + (typeof raw === 'string' ? raw.substring(0, 300) : "unknown error"));
}

if (!data) {
  throw new Error("RESUME_PARSE_FAILED: Parsed data is empty");
}

if (!data.candidate) {
  data = { candidate: data };
}

const candidate = data.candidate;
candidate.location = candidate.location || {};
if (typeof candidate.location === "string") {
  candidate.location = { raw: candidate.location };
}

// JSON Schema check
const missing = [];
if (!candidate.name) missing.push("name");
if (!Array.isArray(candidate.skills) || candidate.skills.length === 0) missing.push("skills");
if (!candidate.experience_level) missing.push("experience_level");
if (!candidate.location || !candidate.location.state) missing.push("location.state");
if (!candidate.location || !candidate.location.country) missing.push("location.country");

if (missing.length > 0) {
  throw new Error("RESUME_PARSE_INCOMPLETE: Missing required fields: " + missing.join(", "));
}

return [
  {
    json: data
  }
];
`;

targetNode.parameters.jsCode = newCode;
fs.writeFileSync('workflows.json', JSON.stringify(workflows, null, 2));
console.log("Updated workflows.json successfully.");
