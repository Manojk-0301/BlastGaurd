'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function generatePRSummary(result) {
  const { currentBranch, changedFiles, specAnalysis, riskScore, impactedModules } = result;

  const qualityChecks = runQualityChecks(result.repoPath);

  let md = '';

  // Header
  md += `**PR Summary - ${currentBranch}**\n\n`;

  // What changed
  md += `**Changes:**\n`;
  md += generateFunctionalDescription(changedFiles) + '\n\n';

  // Type of change
  md += `**Type of Change:**\n`;
  md += generateChangeType(changedFiles) + '\n\n';

  // Lint
  md += `**Lint:** ${qualityChecks.lint.passed ? 'Passed' : 'Failed'}\n\n`;
  md += `**Screenshot:**\n\n\n\n`;

  // Testing
  md += `**Testing:**\n`;
  md += `- Unit Tests: ${qualityChecks.tests.passed ? 'Passed' : 'Failed'}\n`;
  md += `- Coverage: ${qualityChecks.coverage.value}%${qualityChecks.coverage.passed ? '' : ' (below 80% threshold)'}\n`;
  md += `- Manual Testing: Pending\n\n`;
  md += `**Screenshot:**\n\n`;



  return md;
}

function generateFunctionalDescription(changedFiles) {
  const descriptions = [];

  for (const file of (changedFiles || [])) {
    if (file.filePath.includes('lock') || file.filePath.includes('.json')) continue;

    const fileName = path.basename(file.filePath).replace(/\.(ts|js|java)$/, '');
    const funcs = (file.functionsChanged || []).map(f => f.functionName).filter(Boolean);
    const diffs = file.diffSummaries || [];

    for (const func of funcs) {
      descriptions.push(inferFunctionChange(func, diffs, fileName));
    }

    if (funcs.length === 0 && diffs.length > 0) {
      descriptions.push(inferFromDiffs(diffs, fileName));
    }
  }

  if (descriptions.length === 0) return '- Minor code changes and refactoring';
  return descriptions.map(d => `- ${d}`).join('\n');
}

function inferFunctionChange(funcName, diffs, fileName) {
  const lower = funcName.toLowerCase();
  if (lower.includes('pagina') || lower.includes('pagesize')) return 'Updated pagination logic';
  if (lower.includes('login') || lower.includes('auth') || lower.includes('token')) return 'Updated authentication flow';
  if (lower.includes('get') || lower.includes('fetch') || lower.includes('load')) return 'Modified data retrieval logic';
  if (lower.includes('valid') || lower.includes('check') || lower.includes('verify')) return 'Updated validation logic';
  if (lower.includes('render') || lower.includes('display') || lower.includes('show')) return 'Updated UI rendering';
  return `Modified ${funcName} in ${fileName}`;
}

function inferFromDiffs(diffs, fileName) {
  for (const diff of diffs) {
    const combined = ((diff.removed || '') + ' ' + (diff.added || '')).toLowerCase();
    if (combined.includes('pagesize') || combined.includes('pagination')) return 'Updated pagination configuration';
    if (combined.includes('label') || combined.includes('text') || combined.includes('title')) return 'Updated display labels/text';
    if (combined.includes('url') || combined.includes('endpoint') || combined.includes('api')) return 'Updated API endpoint configuration';
    if (combined.includes('style') || combined.includes('css') || combined.includes('color')) return 'Updated styling';
  }
  return `Updated ${fileName}`;
}

function generateChangeType(changedFiles) {
  const types = new Set();
  for (const file of (changedFiles || [])) {
    const filePath = file.filePath.toLowerCase();
    const funcs = (file.functionsChanged || []).map(f => (f.functionName || '').toLowerCase());
    if (filePath.includes('.spec.') || filePath.includes('.test.')) types.add('Test update');
    else if (filePath.includes('fix') || funcs.some(f => f.includes('fix'))) types.add('Bug fix');
    else if (file.additions > file.deletions * 2) types.add('New feature');
    else if (file.deletions > file.additions) types.add('Refactor');
    else types.add('Enhancement');
  }
  if (types.size === 0) types.add('Enhancement');
  return [...types].map(t => `- ${t}`).join('\n');
}

function getDeploymentNotes(changedFiles) {
  const notes = [];
  for (const file of (changedFiles || [])) {
    const fp = file.filePath.toLowerCase();
    if (fp.includes('.env') || fp.includes('environment')) notes.push(`Environment config changed: ${file.filePath} - verify env variables in all environments`);
    if (fp.includes('dockerfile') || fp.includes('docker-compose')) notes.push(`Docker config changed: ${file.filePath} - rebuild container image`);
    if (fp.includes('nginx') || fp.includes('proxy.conf')) notes.push(`Proxy/NGINX config changed: ${file.filePath} - verify routing`);
    if (fp.includes('package.json') && !fp.includes('lock')) notes.push(`Dependencies changed: ${file.filePath} - run npm install after pulling`);
    if (fp.includes('angular.json') || fp.includes('tsconfig')) notes.push(`Build config changed: ${file.filePath} - verify build pipeline`);
  }
  return notes;
}

function detectBreakingChanges(changedFiles, impactedModules) {
  const breaking = [];
  for (const file of (changedFiles || [])) {
    const fp = file.filePath.toLowerCase();
    const funcs = (file.functionsChanged || []).map(f => f.functionName).filter(Boolean);
    const diffs = file.diffSummaries || [];
    const isSharedService = fp.includes('service') || fp.includes('shared') || fp.includes('common') || fp.includes('core');

    if (!isSharedService || funcs.length === 0) continue;

    const dependents = (impactedModules || []).filter(m =>
      fp.includes(m.dependsOn?.toLowerCase() || '')
    ).length;

    if (dependents < 3) continue;

    for (const func of funcs) {
      const behaviorChanged = diffs.some(d => {
        const rem = (d.removed || '');
        const add = (d.added || '');
        return rem.includes('return') || add.includes('return') || rem.includes('[') || add.includes('[');
      });
      if (behaviorChanged) {
        breaking.push(`${func} in ${path.basename(file.filePath)} - behavior/return value changed (${dependents} consumers affected)`);
      }
    }
  }
  return breaking;
}

function runQualityChecks(repoPath) {
  const result = {
    lint: { passed: false, output: '' },
    tests: { passed: false, output: '' },
    coverage: { passed: false, value: 0 }
  };

  if (!repoPath) return result;

  // Lint check
  try {
    execSync('npm run lint --silent 2>&1', { cwd: repoPath, encoding: 'utf8', timeout: 60000 });
    result.lint.passed = true;
  } catch (e) {
    result.lint.passed = false;
  }

  // Coverage - check coverage-summary.json first
  const coverageSummaryPath = path.join(repoPath, 'coverage', 'coverage-summary.json');
  if (fs.existsSync(coverageSummaryPath)) {
    try {
      const cov = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
      const pct = cov.total?.lines?.pct || cov.total?.statements?.pct || 0;
      result.coverage.value = Math.round(pct);
      result.coverage.passed = pct >= 80;
      result.tests.passed = true;
    } catch {}
  }

  // Fallback - parse lcov.info if coverage-summary.json not found
  if (result.coverage.value === 0) {
    const lcovPath = path.join(repoPath, 'coverage', 'lcov.info');
    if (fs.existsSync(lcovPath)) {
      try {
        const lcov = fs.readFileSync(lcovPath, 'utf8');
        let linesHit = 0, linesTotal = 0;
        for (const line of lcov.split('\n')) {
          if (line.startsWith('LH:')) linesHit += parseInt(line.substring(3)) || 0;
          if (line.startsWith('LF:')) linesTotal += parseInt(line.substring(3)) || 0;
        }
        if (linesTotal > 0) {
          const pct = (linesHit / linesTotal) * 100;
          result.coverage.value = Math.round(pct);
          result.coverage.passed = pct >= 80;
          result.tests.passed = true;
        }
      } catch {}
    }
  }

  // Fallback - parse cobertura XML for line-rate
  if (result.coverage.value === 0) {
    const coberturaPath = path.join(repoPath, 'coverage', 'cobertura-coverage.xml');
    if (fs.existsSync(coberturaPath)) {
      try {
        const xml = fs.readFileSync(coberturaPath, 'utf8').substring(0, 2000);
        const match = xml.match(/line-rate="([\d.]+)"/);
        if (match) {
          const pct = parseFloat(match[1]) * 100;
          result.coverage.value = Math.round(pct);
          result.coverage.passed = pct >= 80;
          result.tests.passed = true;
        }
      } catch {}
    }
  }

  return result;
}

function savePRSummary(result, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  // Remove old PR summary files
  fs.readdirSync(outputDir).filter(f => f.startsWith('PR_Summary-') && f.endsWith('.md')).forEach(f => fs.unlinkSync(path.join(outputDir, f)));
  const enrichedResult = { ...result, repoPath: result.repoPath };
  const md = generatePRSummary(enrichedResult);
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
  const fileName = `PR_Summary-${timestamp}.md`;
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, md, 'utf8');
  return filePath;
}

module.exports = { generatePRSummary, savePRSummary, runQualityChecks };
