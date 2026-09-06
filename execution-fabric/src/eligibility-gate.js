'use strict';

/**
 * Enforces PDF §3 Eligibility Rules:
 * Internships-only for 2nd-4th year by default; 
 * up to 3-4 fresher roles unlocked only for `4th_year_strong` AND only where the employer explicitly accepts freshers.
 * 
 * @param {Object} candidateProfile 
 * @param {Object} opportunity 
 * @returns {boolean} True if the opportunity passes the eligibility gate.
 */
function isEligible(candidateProfile, opportunity) {
  const tier = candidateProfile.eligibility_tier || 'unknown';
  const type = (opportunity.employment_type || '').toLowerCase();
  const desc = (opportunity.description || '').toLowerCase();
  
  const isInternship = type.includes('intern') || type.includes('internship');
  const isFullTime = type.includes('full-time') || type.includes('full time') || type === 'employee';

  if (isInternship) {
    return true; // Internships are generally eligible for 2nd-4th year
  }

  if (isFullTime) {
    if (tier === '4th_year_strong') {
      // Must explicitly accept freshers or entry-level
      const acceptsFreshers = desc.includes('fresher') || 
                              desc.includes('entry level') || 
                              desc.includes('entry-level') ||
                              desc.includes('0 years') ||
                              desc.includes('0-1 year') ||
                              desc.includes('0-2 year') ||
                              desc.includes('new grad') ||
                              desc.includes('recent grad');
      return acceptsFreshers;
    } else {
      // 2nd year, 3rd year, standard 4th year are rejected for full-time.
      return false;
    }
  }

  // If neither, fail safe or allow based on some generic heuristic?
  // We'll allow unknown types but maybe we should default to false if we don't know it's an internship.
  // Actually, some internships might just lack the `employment_type` metadata. Let's look for "intern" in the title.
  const title = (opportunity.title || '').toLowerCase();
  if (title.includes('intern')) {
    return true;
  }

  if (tier === '4th_year_strong') {
     const acceptsFreshers = desc.includes('fresher') || 
                             desc.includes('new grad');
     if (acceptsFreshers) return true;
  }

  // Strict enforcement: default false if not confirmed eligible
  return false;
}

module.exports = { isEligible };
