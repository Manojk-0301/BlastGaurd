'use strict';
const fs = require('fs');
const path = require('path');

function generateFixSuggestions(repoPath, detailedChanges, impactedModules, specAnalysis) {
  const suggestions = [];

  for (const change of detailedChanges) {
    if (!change.diffSummaries?.length) continue;
    const fileName = path.basename(change.filePath);

    for (const diff of change.diffSummaries) {
      const removed = diff.removed || '';
      const added = diff.added || '';
      if (!removed || !added) continue;

      // Detect array value change: [10,20,30] → [5,15,25]
      const oldArr = extractArray(removed);
      const newArr = extractArray(added);
      if (oldArr && newArr) {
        const affected = impactedModules.filter(m => m.dependsOn === path.basename(change.filePath).replace(/\.(ts|js|java)$/, ''));
        for (const mod of affected.slice(0, 5)) {
          suggestions.push({
            type: 'VALUE_CHANGE',
            severity: 'HIGH',
            file: mod.filePath,
            module: mod.moduleName,
            title: `Update hardcoded references to old values [${oldArr}]`,
            description: `Values changed from [${oldArr}] to [${newArr}] in ${fileName}. Check if ${mod.moduleName} has any hardcoded references to the old values.`,
            fix: `Search for [${oldArr.split(',')[0].trim()}] in ${mod.moduleName} and update to new values`
          });
        }
      }

      // Detect indexing change: (page - 1) → page (1-based to 0-based)
      if ((removed.includes('- 1') && !added.includes('- 1')) || (!removed.includes('- 1') && added.includes('- 1'))) {
        const affected = impactedModules.filter(m => m.usedFunctions?.some(f => diff.context?.includes(f) || change.functionsChanged?.some(fc => fc.functionName === f)));
        for (const mod of affected.slice(0, 5)) {
          const wasOneBased = removed.includes('- 1');
          suggestions.push({
            type: 'INDEX_CHANGE',
            severity: 'CRITICAL',
            file: mod.filePath,
            module: mod.moduleName,
            title: `Update page index: now ${wasOneBased ? '0-based' : '1-based'}`,
            description: `${diff.context || 'Function'} changed from ${wasOneBased ? '1-based' : '0-based'} to ${wasOneBased ? '0-based' : '1-based'} indexing.`,
            fix: wasOneBased
              ? `In ${mod.moduleName}, change initial page from 1 to 0, or adjust calls to pass (page - 1)`
              : `In ${mod.moduleName}, change initial page from 0 to 1, or adjust calls to pass (page + 1)`
          });
        }
      }

      // Detect return type/structure change
      if (removed.includes('return') && added.includes('return')) {
        const funcName = diff.context || '';
        const affected = impactedModules.filter(m => m.usedFunctions?.includes(funcName));
        for (const mod of affected.slice(0, 3)) {
          suggestions.push({
            type: 'RETURN_CHANGE',
            severity: 'HIGH',
            file: mod.filePath,
            module: mod.moduleName,
            title: `Verify return value handling of ${funcName}`,
            description: `Return statement changed in ${funcName}. ${mod.moduleName} calls this function — verify it handles the new return value correctly.`,
            fix: `Check how ${mod.moduleName} uses the return value of ${funcName} and update accordingly`
          });
        }
      }
    }
  }

  // Add fix suggestions for failing tests
  if (specAnalysis?.specResults) {
    for (const spec of specAnalysis.specResults.filter(s => s.overallStatus !== 'SAFE')) {
      for (const tc of spec.testCases.filter(t => t.prediction === 'LIKELY_FAIL')) {
        suggestions.push({
          type: 'TEST_FIX',
          severity: 'MEDIUM',
          file: spec.specFile,
          module: path.basename(spec.specFile),
          title: `Fix test: "${tc.testName}"`,
          description: tc.reason,
          fix: `Update test assertions to match new behavior`
        });
      }
    }
  }

  // Deduplicate by file+title
  const seen = new Set();
  const unique = suggestions.filter(s => {
    const key = `${s.file}|${s.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  unique.sort((a, b) => (order[a.severity] || 3) - (order[b.severity] || 3));
  return unique.slice(0, 20);
}

function extractArray(line) {
  const s = line.indexOf('['), e = line.indexOf(']');
  if (s >= 0 && e > s) return line.substring(s + 1, e).trim();
  return null;
}

module.exports = { generateFixSuggestions };
