'use strict';

/**
 * skill-normalizer.js
 *
 * Normalizes and deduplicates skill entries from a Candidate Intelligence Profile.
 *
 * Responsibilities:
 *   - Canonicalize skill names (e.g. "js" → "JavaScript", "postgres" → "PostgreSQL")
 *   - Deduplicate across literal and inferred skill lists
 *   - Separate skills by category priority for query construction:
 *       technical > tool > domain > soft
 *   - Generate keyword variants (e.g. "TypeScript" also produces "TS")
 *
 * DETERMINISTIC — no LLM calls, no I/O.
 */

// Canonical skill aliases: raw lowercase → canonical display name.
const SKILL_ALIASES = new Map([
  // JavaScript ecosystem
  ['js',              'JavaScript'],
  ['javascript',      'JavaScript'],
  ['ts',              'TypeScript'],
  ['typescript',      'TypeScript'],
  ['node',            'Node.js'],
  ['nodejs',          'Node.js'],
  ['node.js',         'Node.js'],
  ['react',           'React'],
  ['reactjs',         'React'],
  ['next',            'Next.js'],
  ['nextjs',          'Next.js'],
  ['next.js',         'Next.js'],
  ['vue',             'Vue.js'],
  ['vuejs',           'Vue.js'],
  ['svelte',          'Svelte'],
  ['angular',         'Angular'],
  // Python ecosystem
  ['python',          'Python'],
  ['py',              'Python'],
  ['django',          'Django'],
  ['flask',           'Flask'],
  ['fastapi',         'FastAPI'],
  ['pytorch',         'PyTorch'],
  ['tensorflow',      'TensorFlow'],
  ['tf',              'TensorFlow'],
  ['pandas',          'pandas'],
  ['numpy',           'NumPy'],
  ['scikit-learn',    'scikit-learn'],
  ['sklearn',         'scikit-learn'],
  // Databases
  ['postgres',        'PostgreSQL'],
  ['postgresql',      'PostgreSQL'],
  ['mysql',           'MySQL'],
  ['mongo',           'MongoDB'],
  ['mongodb',         'MongoDB'],
  ['redis',           'Redis'],
  ['sqlite',          'SQLite'],
  ['sql',             'SQL'],
  // Cloud & DevOps
  ['aws',             'AWS'],
  ['amazon web services', 'AWS'],
  ['gcp',             'GCP'],
  ['google cloud',    'GCP'],
  ['azure',           'Azure'],
  ['docker',          'Docker'],
  ['kubernetes',      'Kubernetes'],
  ['k8s',             'Kubernetes'],
  ['terraform',       'Terraform'],
  ['ci/cd',           'CI/CD'],
  ['github actions',  'GitHub Actions'],
  // Languages
  ['java',            'Java'],
  ['golang',          'Go'],
  ['go',              'Go'],
  ['rust',            'Rust'],
  ['c++',             'C++'],
  ['cpp',             'C++'],
  ['c#',              'C#'],
  ['csharp',          'C#'],
  ['ruby',            'Ruby'],
  ['swift',           'Swift'],
  ['kotlin',          'Kotlin'],
  ['scala',           'Scala'],
  // AI/ML
  ['llm',             'LLM'],
  ['large language models', 'LLM'],
  ['openai',          'OpenAI API'],
  ['langchain',       'LangChain'],
  ['rag',             'RAG'],
  ['nlp',             'NLP'],
  ['natural language processing', 'NLP'],
  ['computer vision', 'Computer Vision'],
  ['cv',              'Computer Vision'],
  // General
  ['git',             'Git'],
  ['rest',            'REST APIs'],
  ['rest api',        'REST APIs'],
  ['graphql',         'GraphQL'],
  ['linux',           'Linux'],
  ['agile',           'Agile'],
  ['scrum',           'Scrum'],
]);

// Category priority for query ordering: higher = used in more queries.
const CATEGORY_PRIORITY = { technical: 4, tool: 3, domain: 2, soft: 1 };

/**
 * Normalize a single skill string.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeSkill(raw) {
  if (typeof raw !== 'string') return '';
  const lower = raw.trim().toLowerCase();
  return SKILL_ALIASES.get(lower) || raw.trim();
}

/**
 * Normalize and deduplicate a flat array of skill strings.
 *
 * @param {string[]} rawSkills
 * @returns {string[]}
 */
function normalizeSkills(rawSkills) {
  if (!Array.isArray(rawSkills)) return [];

  const seen = new Set();
  const result = [];

  for (const raw of rawSkills) {
    const normalized = normalizeSkill(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result;
}

/**
 * Extract skills from the CIP literal section, organized by category and priority.
 *
 * CIP literal.skills is an array of { name, category, yearsOfExperience? }
 *
 * @param {object[]} cipSkills  — from CIP literal.skills
 * @returns {{ technical: string[], tool: string[], domain: string[], soft: string[] }}
 */
function categorizeSkills(cipSkills) {
  const categories = { technical: [], tool: [], domain: [], soft: [] };

  if (!Array.isArray(cipSkills)) return categories;

  for (const skill of cipSkills) {
    const name     = normalizeSkill(skill.name || skill);
    const category = (skill.category || 'technical').toLowerCase();
    const bucket   = categories[category] || categories.technical;
    const key      = name.toLowerCase();

    // Deduplicate within each category.
    if (!bucket.some((s) => s.toLowerCase() === key)) {
      bucket.push(name);
    }
  }

  return categories;
}

/**
 * Return a flat, deduplicated, priority-ordered skill list for query construction.
 * Technical skills come first (most search-relevant), soft skills last.
 *
 * @param {object[]} cipSkills
 * @returns {string[]}
 */
function prioritizedSkillList(cipSkills) {
  const { technical, tool, domain, soft } = categorizeSkills(cipSkills);
  return [...technical, ...tool, ...domain, ...soft];
}

module.exports = { normalizeSkill, normalizeSkills, categorizeSkills, prioritizedSkillList };
