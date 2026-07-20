#!/usr/bin/env node
'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  BlastGuard Agent - Universal Change Impact Analyzer        ║
 * ║  Works in any IDE: VS Code, Kiro, Eclipse, IntelliJ         ║
 * ║  Zero dependencies - just Node.js + Git                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 * 
 * Usage:
 *   node index.js                          (auto-detect repo in cwd)
 *   node index.js --repo /path/to/repo     (specify repo path)
 *   node index.js --branch origin/main     (specify base branch)
 *   node index.js --output ./reports       (specify output dir)
 */

const path = require('path');
const fs = require('fs');
const { getCurrentBranch, getDetailedChanges, getAffectedOwners } = require('./git-utils');
const { detectProjectType, discoverModules, findImpactedModules } = require('./analyzer');
const { calculateRiskScore, getRiskLevel, buildVerdict, generateRecommendations, buildTestImpact, buildModuleRollup, buildOwnershipMap } = require('./risk-engine');
const { generateReport } = require('./report-generator');
const { analyzeFileHealth } = require('./file-health');
const { detectPatterns } = require('./pattern-detector');
const { suggestTests } = require('./test-suggester');
const { generatePRSummary, savePRSummary } = require('./pr-summary');
const { saveTestSummary } = require('./test-summary');
const { estimateReviewTime, generateChecklist } = require('./checklist');
const { analyzeSpecs } = require('./spec-analyzer');
const { findDeadCode } = require('./dead-code');
const { generateFixSuggestions } = require('./fix-suggester');
const { trackRiskHistory } = require('./risk-history');
const { analyzeTestGaps } = require('./test-gap');
const { validateJiraTicket, validateJiraTicketInteractive } = require('./jira-validator');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}

const repoPath = path.resolve(getArg('repo', process.cwd()));
const baseBranch = getArg('branch', 'origin/develop');
const outputDir = path.resolve(getArg('output', path.join(repoPath, 'blastguard-reports')));

console.log('\n🛡️  BlastGuard Agent - Change Impact Analysis (PRO)');
console.log('━'.repeat(55));
console.log(`📁 Repo:   ${repoPath}`);
console.log(`🌿 Base:   ${baseBranch}`);
console.log(`📄 Output: ${outputDir}`);
console.log('━'.repeat(55));
console.log('');

// Step 1: Detect project
console.log('\n⏳ [1/14] Detecting project type...');
const projectType = detectProjectType(repoPath);
const currentBranch = getCurrentBranch(repoPath);
console.log(`   ✓ ${projectType} project on branch: ${currentBranch}`);

// Step 2: Get changes
console.log('⏳ [2/14] Scanning changed files...');
const detailedChanges = getDetailedChanges(repoPath, baseBranch);
if (!detailedChanges.length) {
  console.log('\n✅ No changes detected between your branch and ' + baseBranch);
  console.log('   Nothing to analyze.\n');
  process.exit(0);
}
const changedFiles = detailedChanges.map(c => c.filePath);
console.log(`   ✓ ${changedFiles.length} files changed`);

// Step 3: Discover modules
console.log('⏳ [3/14] Discovering project modules...');
const allModules = discoverModules(repoPath, projectType);
console.log(`   ✓ ${allModules.length} modules found`);

// Step 4: Impact analysis
console.log('⏳ [4/14] Analyzing function-level impact...');
const impactedModules = findImpactedModules(repoPath, changedFiles, detailedChanges);
console.log(`   ✓ ${impactedModules.length} modules impacted`);

// Step 5: Team & ownership
console.log('⏳ [5/14] Identifying affected team members...');
const owners = getAffectedOwners(repoPath, changedFiles);

// Step 6: File Health Analysis
console.log('⏳ [6/14] Analyzing file health (churn detection)...');
const fileHealth = analyzeFileHealth(repoPath, changedFiles);
const unhealthyFiles = fileHealth.filter(f => f.status !== 'HEALTHY');
console.log(`   ✓ ${unhealthyFiles.length} file(s) with health warnings`);

// Step 7: Pattern Detection
console.log('⏳ [7/14] Scanning for anti-patterns...');
const patterns = detectPatterns(repoPath, changedFiles);
console.log(`   ✓ ${patterns.length} pattern issue(s) found`);

// Step 8: Smart Test Suggestions
console.log('⏳ [8/14] Mapping tests to changes...');
const testSuggestions = suggestTests(repoPath, changedFiles, impactedModules);
console.log(`   ✓ ${testSuggestions.suggestions.length} test(s) suggested`);

// Step 9: Spec File Analysis
console.log('⏳ [9/14] Analyzing spec files for test failures...');
const specAnalysis = analyzeSpecs(repoPath, changedFiles, detailedChanges, impactedModules);
console.log(`   ✓ ${specAnalysis.totalSpecs} spec files analyzed, ${specAnalysis.totalTests} test cases`);
console.log(`     ❌ ${specAnalysis.totalLikelyFail} likely to fail | ⚠️ ${specAnalysis.totalAtRisk} at risk | ✅ ${specAnalysis.totalSafe} safe`);

// Step 10: Dead Code Detection
console.log('⏳ [10/14] Detecting dead code...');
const deadCode = findDeadCode(repoPath, changedFiles);
console.log(`   ✓ ${deadCode.length} potentially unused function(s) found`);

// Step 11: Test Gap Analysis
console.log('⏳ [11/14] Analyzing test gaps...');
const testGaps = analyzeTestGaps(repoPath, changedFiles, impactedModules);
console.log(`   ✓ ${testGaps.totalUntested} untested function(s) across ${testGaps.filesWithGaps} file(s)`);

// Step 12: Risk calculation
console.log('⏳ [12/14] Calculating risk & generating outputs...');
const riskScoreVal = calculateRiskScore(detailedChanges, impactedModules, changedFiles);
const riskLevel = getRiskLevel(riskScoreVal);
const verdict = buildVerdict(riskScoreVal, riskLevel, impactedModules, changedFiles);
const recommendations = generateRecommendations(riskLevel, detailedChanges, impactedModules, changedFiles);
const testImpact = buildTestImpact(detailedChanges, impactedModules);
const moduleRollup = buildModuleRollup(impactedModules);
const ownershipMap = buildOwnershipMap(owners, impactedModules);

// Build stats
const totalAdditions = detailedChanges.reduce((s, c) => s + c.additions, 0);
const totalDeletions = detailedChanges.reduce((s, c) => s + c.deletions, 0);
const totalFuncs = detailedChanges.reduce((s, c) => s + c.functionsChanged.length, 0);
const stats = { totalFilesChanged: changedFiles.length, totalAdditions, totalDeletions, totalFunctionsChanged: totalFuncs, totalImpactedModules: impactedModules.length, totalProjectModules: allModules.length };

// Review time estimation
const reviewTime = estimateReviewTime(stats, impactedModules, detailedChanges);

// Build full result
const result = {
  repoPath,
  currentBranch,
  comparedAgainst: baseBranch,
  projectType,
  analyzedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
  riskScore: { score: riskScoreVal, level: riskLevel },
  verdict,
  stats,
  changedFiles: detailedChanges,
  impactedModules,
  testImpact,
  moduleRollup,
  ownershipMap,
  recommendations,
  userImpact: buildUserImpact(detailedChanges, impactedModules),
  // PRO features
  fileHealth,
  patterns,
  testSuggestions,
  specAnalysis,
  reviewTime
};

// Run quality checks and attach to result
const { runQualityChecks } = require('./pr-summary');
result.qualityChecks = runQualityChecks(repoPath);

// Step 13: Auto-Fix Suggestions
console.log('⏳ [13/14] Generating fix suggestions...');
const fixSuggestions = generateFixSuggestions(repoPath, detailedChanges, impactedModules, specAnalysis);
console.log(`   ✓ ${fixSuggestions.length} fix suggestion(s) generated`);
result.fixSuggestions = fixSuggestions;
result.deadCode = deadCode;
result.testGaps = testGaps;

// Step 14: Jira Ticket Validation (interactive)
console.log('⏳ [14/14] Validating against Jira ticket...');
const jiraTicketFound = require('./jira-validator').extractTicketId(result.currentBranch, repoPath);

async function runJiraAndFinish() {
  let jiraValidation;
  if (jiraTicketFound) {
    jiraValidation = validateJiraTicket(repoPath, result, outputDir);
  } else {
    jiraValidation = await validateJiraTicketInteractive(repoPath, result, outputDir);
  }

  if (jiraValidation.status === 'SKIPPED' || jiraValidation.status === 'NO_TICKET') {
    console.log(`   ⚪ Jira validation skipped`);
  } else if (jiraValidation.status === 'NO_CONFIG') {
    console.log(`   ⚠️  Ticket ${jiraValidation.ticketId} found but Jira not configured`);
  } else if (jiraValidation.status === 'VALIDATED') {
    console.log(`   ✓ All ${jiraValidation.validation.totalCriteria} acceptance criteria matched`);
  } else if (jiraValidation.status === 'GAPS_FOUND') {
    console.log(`   ⚠️  ${jiraValidation.validation.gapCount} acceptance criteria not covered by code changes`);
  }
  result.jiraValidation = jiraValidation;

  // Generate outputs
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const reportPath = generateReport(result, outputDir);
  const prSummaryPath = savePRSummary(result, outputDir);
  const testSummaryPath = saveTestSummary(result, outputDir);
  const checklist = generateChecklist(result);

  // Track risk history
  const riskHistory = trackRiskHistory(outputDir, result);

  // Save checklist as JSON for IDE integration
  const checklistPath = path.join(outputDir, `checklist_${currentBranch.replace(/\//g, '_')}.json`);
  fs.writeFileSync(checklistPath, JSON.stringify({ checklist, reviewTime }, null, 2), 'utf8');

  // ═══════════════════════════════════════════════════════
  // CONSOLE OUTPUT
  // ═══════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(55));
  console.log(`${verdict.icon} VERDICT: ${verdict.message}`);
  console.log(`   ${verdict.reason}`);
  console.log('═'.repeat(55));

  console.log(`\n📊 Risk Score: ${riskScoreVal}/100 (${riskLevel})`);
  console.log(`⏱️  Review Time: ${reviewTime.label}`);
  console.log(`📁 Files Changed: ${changedFiles.length}`);
  console.log(`⚡ Modules Impacted: ${impactedModules.length}`);
  console.log(`   🔴 Critical: ${impactedModules.filter(m => m.impactLevel === 'CRITICAL').length}`);
  console.log(`   🟠 High: ${impactedModules.filter(m => m.impactLevel === 'HIGH').length}`);
  console.log(`   🟡 Medium: ${impactedModules.filter(m => m.impactLevel === 'MEDIUM').length}`);

  if (unhealthyFiles.length) {
    console.log(`\n🏥 File Health Warnings:`);
    for (const f of unhealthyFiles.slice(0, 5)) {
      console.log(`   ${f.status === 'CRITICAL' ? '🔴' : '🟡'} ${path.basename(f.file)} — ${f.reason}`);
    }
  }

  if (patterns.length) {
    console.log(`\n🔍 Anti-Patterns Detected:`);
    for (const p of patterns.slice(0, 5)) {
      console.log(`   ${p.severity === 'CRITICAL' ? '🔴' : p.severity === 'HIGH' ? '🟠' : '🟡'} ${p.title} in ${path.basename(p.file)} (${p.count}x)`);
    }
  }

  if (testSuggestions.suggestions.length) {
    console.log(`\n🧪 Tests to Run:`);
    console.log(`   Must: ${testSuggestions.summary.mustRun} | Should: ${testSuggestions.summary.shouldRun}`);
    console.log(`   Command: ${testSuggestions.combinedCommand}`);
  }

  if (specAnalysis.totalSpecs > 0) {
    console.log(`\n📋 Spec File Analysis (${specAnalysis.totalSpecs} files, ${specAnalysis.totalTests} tests):`);
    for (const spec of specAnalysis.specResults.filter(s => s.overallStatus !== 'SAFE').slice(0, 8)) {
      const icon = spec.overallStatus === 'FAILING' ? '❌' : '⚠️';
      console.log(`   ${icon} ${path.basename(spec.specFile)} — ${spec.summary.likelyFail} fail, ${spec.summary.atRisk} at risk / ${spec.totalTests} total`);
      for (const tc of spec.testCases.filter(t => t.prediction === 'LIKELY_FAIL').slice(0, 3)) {
        console.log(`      └─ "${tc.testName}" → ${tc.reason}`);
      }
    }
  }

  console.log(`\n✅ Pre-merge Checklist:`);
  for (const cat of checklist) {
    const passed = cat.items.filter(i => i.done).length;
    const total = cat.items.length;
    console.log(`   [${cat.category}] ${passed}/${total} passed`);
    for (const item of cat.items) {
      console.log(`      ${item.done ? '✅' : '❌'} ${item.text}`);
    }
  }

  if (deadCode.length) {
    console.log(`\n💀 Dead Code (${deadCode.length} unused functions):`);
    for (const d of deadCode.slice(0, 5)) {
      console.log(`   ⚪ ${d.functionName} in ${path.basename(d.file)} (line ${d.line})`);
    }
  }

  if (testGaps.filesWithGaps > 0) {
    console.log(`\n🕳️  Test Gaps (${testGaps.totalUntested} untested functions):`);
    for (const gap of testGaps.gaps.slice(0, 5)) {
      console.log(`   ⚠️  ${path.basename(gap.file)} — ${gap.untestedCount} untested / ${gap.totalFunctions} total (${gap.coveragePercent}% covered)`);
    }
  }

  if (fixSuggestions.length) {
    console.log(`\n🔧 Auto-Fix Suggestions (${fixSuggestions.length}):`);
    for (const fix of fixSuggestions.slice(0, 5)) {
      console.log(`   ${fix.severity === 'CRITICAL' ? '🔴' : '🟠'} ${fix.title}`);
      console.log(`      → ${fix.fix}`);
    }
  }

  if (riskHistory.history.length > 1) {
    const trend = riskHistory.trend;
    const trendIcon = trend.direction === 'INCREASING' ? '📈' : trend.direction === 'DECREASING' ? '📉' : '➡️';
    console.log(`\n${trendIcon} Risk Trend: ${trend.direction} (avg: ${trend.recentAvg}/100)`);
  }

  if (jiraValidation.status === 'GAPS_FOUND') {
    console.log(`\n🎫 Jira Validation (${jiraValidation.ticketId}): ${jiraValidation.validation.matchedCount}/${jiraValidation.validation.totalCriteria} criteria met`);
    for (const gap of jiraValidation.validation.gaps.slice(0, 3)) {
      console.log(`   ❌ ${gap.criteria}`);
    }
  } else if (jiraValidation.status === 'VALIDATED') {
    console.log(`\n🎫 Jira Validation (${jiraValidation.ticketId}): ✅ All criteria met`);
  }

  console.log('\n' + '━'.repeat(55));
  console.log(`📄 HTML Report:  ${reportPath}`);
  console.log(`📋 PR Summary:   ${prSummaryPath}`);
  console.log(`🧪 Test Summary: ${testSummaryPath}`);
  console.log(`📝 Checklist:    ${checklistPath}`);
  console.log('━'.repeat(55) + '\n');
}

runJiraAndFinish();

// ═══════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════

function buildUserImpact(changes, impacted) {
  const impacts = [];
  for (const change of changes) {
    if (!change.diffSummaries?.length && !change.functionsChanged?.length) continue;
    const fileName = path.basename(change.filePath).replace(/\.(ts|js|java)$/, '');
    for (const diff of (change.diffSummaries || [])) {
      const effect = inferEffect(diff);
      if (effect) {
        impacts.push({ change: diff.context || fileName, before: diff.removed || '', after: diff.added || '', userEffect: effect });
      }
    }
  }
  return impacts.slice(0, 8);
}

function inferEffect(diff) {
  const rem = diff.removed || '';
  const add = diff.added || '';
  const ctx = (diff.context || '').toLowerCase();
  if ((rem.includes('[') && add.includes('[')) || ctx.includes('option') || ctx.includes('size')) {
    const oldV = extractArr(rem), newV = extractArr(add);
    if (oldV && newV) return `Dropdown/selector will show [${newV}] instead of [${oldV}]`;
  }
  if (rem.includes('Page') || add.includes('Page') || ctx.includes('pagina')) return 'Pagination behavior changed — data shown per page may shift';
  if ((rem.includes('label') || rem.includes('text')) && (add.includes('label') || add.includes('text'))) return 'Display text/labels changed in the UI';
  return null;
}

function extractArr(line) {
  const s = line.indexOf('['), e = line.indexOf(']');
  return (s >= 0 && e > s) ? line.substring(s + 1, e).trim() : null;
}
