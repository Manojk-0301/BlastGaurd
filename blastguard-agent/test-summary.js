'use strict';
const fs = require('fs');
const path = require('path');

function saveTestSummary(result, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Remove old test summary files
  fs.readdirSync(outputDir).filter(f => f.startsWith('Test_Summary-') && f.endsWith('.md')).forEach(f => fs.unlinkSync(path.join(outputDir, f)));

  const md = buildTestSummary(result);
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
  const fileName = `Test_Summary-${timestamp}.md`;
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, md, 'utf8');
  return filePath;
}

function buildTestSummary(result) {
  const { currentBranch, specAnalysis, testSuggestions, qualityChecks } = result;
  let md = '';

  md += `**Test Summary - ${currentBranch}**\n\n`;

  // Unit Test Status
  md += `**Unit Test Status:**\n`;
  md += `- Result: ${qualityChecks?.tests?.passed ? 'Passed' : 'Failed'}\n`;
  md += `- Coverage: ${qualityChecks?.coverage?.value || 0}%${qualityChecks?.coverage?.passed ? '' : ' (below 80% threshold)'}\n\n`;

  // Spec Analysis - Predicted Failures
  if (specAnalysis) {
    md += `**Test Failure Predictions:**\n`;
    md += `- Total Tests Analyzed: ${specAnalysis.totalTests}\n`;
    md += `- Likely to Fail: ${specAnalysis.totalLikelyFail}\n`;
    md += `- At Risk: ${specAnalysis.totalAtRisk}\n`;
    md += `- Safe: ${specAnalysis.totalSafe}\n\n`;

    // Failing tests detail
    const failingSpecs = (specAnalysis.specResults || []).filter(s => s.overallStatus !== 'SAFE');
    if (failingSpecs.length) {
      md += `**Predicted Failing Tests:**\n`;
      for (const spec of failingSpecs) {
        md += `\n${path.basename(spec.specFile)} (${spec.summary.likelyFail} fail, ${spec.summary.atRisk} at risk / ${spec.totalTests} total)\n`;
        for (const tc of spec.testCases.filter(t => t.prediction === 'LIKELY_FAIL')) {
          md += `- FAIL: "${tc.testName}" - ${tc.reason}\n`;
        }
        for (const tc of spec.testCases.filter(t => t.prediction === 'AT_RISK')) {
          md += `- AT RISK: "${tc.testName}" - ${tc.reason}\n`;
        }
      }
      md += '\n';
    }
  }

  // Tests to Run
  if (testSuggestions?.suggestions?.length) {
    md += `**Suggested Tests to Run:**\n`;
    md += `- Must Run: ${testSuggestions.summary.mustRun}\n`;
    md += `- Should Run: ${testSuggestions.summary.shouldRun}\n\n`;
    md += `**Command:**\n`;
    md += `${testSuggestions.combinedCommand}\n\n`;

    md += `**Test Files:**\n`;
    for (const s of testSuggestions.suggestions) {
      md += `- [${s.priority}] ${path.basename(s.file)} - ${s.reason}\n`;
    }
    md += '\n';
  }

  // Test Gap Analysis
  if (result.testGaps && result.testGaps.filesWithGaps > 0) {
    const tg = result.testGaps;
    md += `**Test Gap Analysis:**\n`;
    md += `- Files Analyzed: ${tg.totalFilesAnalyzed}\n`;
    md += `- Files With Gaps: ${tg.filesWithGaps}\n`;
    md += `- Total Untested Functions: ${tg.totalUntested}\n\n`;

    md += `**Untested Functions by File:**\n`;
    for (const gap of tg.gaps) {
      md += `\n${path.basename(gap.file)} (${gap.coveragePercent}% covered, ${gap.untestedCount} untested)\n`;
      if (!gap.specExists) md += `- No spec file found\n`;
      for (const func of gap.untestedFunctions) {
        md += `- ${func.name} (line ${func.line})\n`;
      }
    }
    md += '\n';
  }

  return md;
}

module.exports = { saveTestSummary };
