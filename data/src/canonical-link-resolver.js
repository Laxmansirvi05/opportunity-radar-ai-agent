'use strict';
const OFFICIAL_ATS = ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'workdayjobs.com', 'myworkdayjobs.com', 'smartrecruiters.com'];
const BLOCKED_DOMAINS = ['linkedin.com'];
function hostname(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function isBlocked(host) { return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)); }
function tier(url, company, registry = null) {
  const host = hostname(url);
  if (!host || isBlocked(host)) return 'blocked';
  if (OFFICIAL_ATS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 'official_ats';
  const domains = registry?.official_domains || [];
  if (domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 'official_company';
  const slug = String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug && host.replace(/[^a-z0-9]/g, '').includes(slug) ? 'official_company' : 'third_party';
}
function resolveCanonicalApplyUrl({ company, sourceUrl, candidates = [], registry = null }) {
  const order = ['official_company', 'official_ats', 'third_party'];
  const ranked = [sourceUrl, ...candidates].filter(Boolean).map((url) => ({ url, apply_url_tier: tier(url, company, registry) }))
    .filter((item) => item.apply_url_tier !== 'blocked').sort((a, b) => order.indexOf(a.apply_url_tier) - order.indexOf(b.apply_url_tier));
  return ranked[0] || { url: null, apply_url_tier: 'unresolved' };
}
module.exports = { resolveCanonicalApplyUrl, tier };
