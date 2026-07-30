const { GatewayError } = require("../errors");

const WORKPLACE_TYPES = new Set(["remote", "hybrid", "onsite", "unknown"]);
const EMPLOYMENT_TYPES = new Set(["internship", "full-time", "part-time", "contract", "temporary", "unknown"]);
const FIELDS = [
  "title",
  "company",
  "location",
  "workplaceType",
  "employmentType",
  "description",
  "requirements",
  "skills",
  "applicationUrl",
  "deadline"
];

function invalid(message) {
  throw new GatewayError("TASK_OUTPUT_INVALID", message, { status: 502 });
}

function nullableString(value, field) {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") invalid(`${field} must be a non-empty string or null`);
  return value.trim();
}

function stringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    invalid(`${field} must be an array of non-empty strings`);
  }
  return value.map((item) => item.trim());
}

function nullableUrl(value) {
  if (value === null) return null;
  const url = nullableString(value, "applicationUrl");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") invalid("applicationUrl must use http or https");
  } catch {
    invalid("applicationUrl must be a valid URL or null");
  }
  return url;
}

function nullableDate(value) {
  if (value === null) return null;
  const date = nullableString(value, "deadline");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    invalid("deadline must use YYYY-MM-DD or null");
  }
  return date;
}

function validateOpportunity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Opportunity output must be a JSON object");
  const keys = Object.keys(value);
  if (keys.length !== FIELDS.length || keys.some((key) => !FIELDS.includes(key)) || FIELDS.some((field) => !(field in value))) {
    invalid("Opportunity output must contain exactly the predefined schema fields");
  }

  const title = nullableString(value.title, "title");
  const company = nullableString(value.company, "company");
  const workplaceType = value.workplaceType;
  const employmentType = value.employmentType;
  if (!WORKPLACE_TYPES.has(workplaceType)) invalid("workplaceType is invalid");
  if (!EMPLOYMENT_TYPES.has(employmentType)) invalid("employmentType is invalid");

  return Object.freeze({
    title,
    company,
    location: nullableString(value.location, "location"),
    workplaceType,
    employmentType,
    description: nullableString(value.description, "description"),
    requirements: stringArray(value.requirements, "requirements"),
    skills: stringArray(value.skills, "skills"),
    applicationUrl: nullableUrl(value.applicationUrl),
    deadline: nullableDate(value.deadline)
  });
}

module.exports = { FIELDS, validateOpportunity };
