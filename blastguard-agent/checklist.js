'use strict';

/**
 * Estimates review time based on:
 * - Lines changed
 * - Number of files
 * - Complexity (functions modified, impacted modules)
 * - File types (config changes need more careful review)
 */
function estimateReviewTime(stats, impactedModules, changedFiles) {
  let minutes = 0;

  // Base: ~2 min per file
  minutes += (stats.totalFilesChanged || 0) * 2;

  // Lines: ~1 min per 50 lines changed
  const totalLines = (stats.totalAdditions || 0) + (stats.totalDeletions || 0);
  minutes += Math.ceil(totalLines / 50);

  // Functions: ~3 min per modified function
  minutes += (stats.totalFunctionsChanged || 0) * 3;

  // Impacted modules add review complexity
  const critical = (impactedModules || []).filter(m => m.impactLevel === 'CRITICAL').length;
  minutes += critical * 5;

  // Config/env changes need extra attention
  const hasConfig = (changedFiles || []).some(c => {
    const f = c.filePath || c;
    return f.includes('config') || f.includes('environment') || f.includes('package.json') || f.includes('pom.xml');
  });
  if (hasConfig) minutes += 10;

  // Minimum 5 min, max 180 min
  minutes = Math.max(5, Math.min(minutes, 180));

  let label;
  if (minutes <= 15) label = 'Quick Review (~' + minutes + ' min)';
  else if (minutes <= 45) label = 'Standard Review (~' + minutes + ' min)';
  else if (minutes <= 90) label = 'Deep Review (~' + minutes + ' min)';
  else label = 'Extended Review (~' + Math.round(minutes / 60 * 10) / 10 + ' hrs)';

  return { minutes, label, breakdown: buildBreakdown(stats, critical, hasConfig) };
}

function buildBreakdown(stats, criticalModules, hasConfig) {
  const parts = [];
  parts.push(`${stats.totalFilesChanged || 0} files`);
  parts.push(`${(stats.totalAdditions || 0) + (stats.totalDeletions || 0)} lines`);
  if (stats.totalFunctionsChanged) parts.push(`${stats.totalFunctionsChanged} functions`);
  if (criticalModules) parts.push(`${criticalModules} critical deps`);
  if (hasConfig) parts.push('config changes');
  return parts.join(' • ');
}

/**
 * Generate a structured pre-merge checklist based on analysis results
 */
function generateChecklist(result) {
  const { riskScore, impactedModules, testSuggestions, patterns, fileHealth, ownershipMap, specAnalysis, qualityChecks } = result;
  const items = [];

  // === MUST DO ===
  const mustDo = [];

  // Lint - auto-verified
  const lintPassed = qualityChecks?.lint?.passed || false;
  mustDo.push({ text: 'Lint passing', done: lintPassed });

  // Tests - auto-verified from spec analysis
  const noFailures = !specAnalysis || specAnalysis.totalLikelyFail === 0;
  mustDo.push({ text: 'No predicted test failures', done: noFailures });

  // No critical patterns (secrets/security)
  const noCriticalPatterns = !patterns?.some(p => p.severity === 'CRITICAL');
  mustDo.push({ text: 'No critical security issues', done: noCriticalPatterns });

  items.push({ category: 'MUST DO', items: mustDo });

  // === SHOULD DO ===
  const shouldDo = [];

  // Coverage check
  const coveragePassed = qualityChecks?.coverage?.passed || false;
  shouldDo.push({ text: `Coverage above 80%${qualityChecks?.coverage?.value ? ' (' + qualityChecks.coverage.value + '%)' : ''}`, done: coveragePassed });

  // No high-severity anti-patterns
  const noHighPatterns = !patterns?.some(p => p.severity === 'HIGH' || p.severity === 'CRITICAL');
  shouldDo.push({ text: 'No high-severity anti-patterns', done: noHighPatterns });

  // Low risk score
  const lowRisk = (riskScore?.score || 0) <= 40;
  shouldDo.push({ text: `Risk score within safe range (${riskScore?.score || 0}/100)`, done: lowRisk });

  // No at-risk tests
  const noAtRisk = !specAnalysis || specAnalysis.totalAtRisk === 0;
  shouldDo.push({ text: 'No at-risk test cases', done: noAtRisk });

  items.push({ category: 'SHOULD DO', items: shouldDo });

  // === NICE TO DO ===
  const niceToDo = [];

  const noConsoleLogs = !patterns?.some(p => p.id === 'CONSOLE_LOG');
  niceToDo.push({ text: 'No console.log statements', done: noConsoleLogs });

  const noAnyTypes = !patterns?.some(p => p.id === 'ANY_TYPE');
  niceToDo.push({ text: 'No TypeScript `any` types', done: noAnyTypes });

  const allFilesHealthy = !fileHealth?.some(f => f.status !== 'HEALTHY');
  niceToDo.push({ text: 'All modified files healthy', done: allFilesHealthy });

  items.push({ category: 'NICE TO DO', items: niceToDo });

  return items;
}

module.exports = { estimateReviewTime, generateChecklist };
