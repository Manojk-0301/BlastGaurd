'use strict';

function calculateRiskScore(changes, impacted, changedFiles) {
  let score = 0;
  score += Math.min(changedFiles.length * 3, 20);

  const critical = impacted.filter(m => m.impactLevel === 'CRITICAL').length;
  const high = impacted.filter(m => m.impactLevel === 'HIGH').length;
  const medium = impacted.filter(m => m.impactLevel === 'MEDIUM').length;
  score += critical * 10;
  score += high * 6;
  score += medium * 3;

  const hasShared = changedFiles.some(f => (f.includes('service') || f.includes('Service')) && (f.includes('common') || f.includes('shared') || f.includes('core') || f.includes('util')));
  if (hasShared) score += 15;

  const totalChanges = changes.reduce((s, c) => s + c.additions + c.deletions, 0);
  if (totalChanges > 1000) score += 10;
  else if (totalChanges > 500) score += 7;
  else if (totalChanges > 100) score += 4;

  const hasConfig = changedFiles.some(f => f.includes('config') || f.includes('environment') || f.includes('application.') || f.includes('package.json'));
  if (hasConfig) score += 8;

  const totalFuncs = changes.reduce((s, c) => s + c.functionsChanged.length, 0);
  if (totalFuncs > 20) score += 10;
  else if (totalFuncs > 10) score += 5;

  return Math.min(score, 100);
}

function getRiskLevel(score) {
  if (score <= 25) return 'LOW';
  if (score <= 50) return 'MEDIUM';
  if (score <= 75) return 'HIGH';
  return 'CRITICAL';
}

function buildVerdict(riskScore, riskLevel, impacted, changedFiles) {
  const hasShared = changedFiles.some(f => (f.includes('service') || f.includes('Service')) && (f.includes('common') || f.includes('shared') || f.includes('core') || f.includes('util')));
  const criticalCount = impacted.filter(m => m.impactLevel === 'CRITICAL').length;

  if (riskScore > 60 || hasShared || criticalCount > 3) {
    return { status: 'NOT_SAFE', icon: '❌', message: 'NOT SAFE TO MERGE', reason: hasShared ? `Shared service breaking change affects ${impacted.length} consumers` : `${criticalCount} modules will break due to direct function call changes`, action: 'Coordinate with affected teams, add backward compatibility, run full E2E' };
  } else if (riskScore > 30) {
    return { status: 'REVIEW_NEEDED', icon: '⚠️', message: 'REVIEW NEEDED', reason: `${impacted.length} modules impacted with limited blast radius`, action: 'Get 1 senior approval, verify impacted module tests pass' };
  }
  return { status: 'SAFE', icon: '✅', message: 'SAFE TO MERGE', reason: 'Changes are isolated with minimal blast radius', action: 'Standard code review is sufficient' };
}

function generateRecommendations(riskLevel, changes, impacted, changedFiles) {
  const recs = [];
  const getSimpleName = f => { const n = f.includes('/') ? f.substring(f.lastIndexOf('/') + 1) : f; return n.replace(/\.(ts|js|java|tsx|jsx)$/, ''); };

  // Shared service impact
  const sharedChanges = changes.filter(c => (c.filePath.includes('service') || c.filePath.includes('Service')) && (c.filePath.includes('common') || c.filePath.includes('shared') || c.filePath.includes('core') || c.filePath.includes('util')));
  for (const shared of sharedChanges) {
    const svcName = getSimpleName(shared.filePath);
    const consumers = impacted.filter(m => m.dependsOn.includes(svcName));
    if (consumers.length) {
      const critConsumers = consumers.filter(m => m.impactLevel === 'CRITICAL');
      let desc = `Severity: CRITICAL. '${svcName}' is a shared singleton service. Changes silently propagate to all ${consumers.length} consumers.\n\n`;
      if (critConsumers.length) {
        desc += `🔴 CRITICAL (${critConsumers.length}): [${critConsumers.map(m => m.moduleName).slice(0, 6).join(', ')}] directly call modified functions\n`;
      }
      recs.push({ title: `🚨 Shared Service Impact: ${svcName} → ${consumers.length} consumers`, description: desc, priority: 'CRITICAL' });
    }
  }

  // Per-file impact
  const byDep = {};
  for (const m of impacted.filter(m => m.usedFunctions.length > 0)) {
    if (!byDep[m.dependsOn]) byDep[m.dependsOn] = [];
    byDep[m.dependsOn].push(m);
  }
  for (const [dep, affected] of Object.entries(byDep)) {
    if (sharedChanges.some(s => getSimpleName(s.filePath) === dep)) continue;
    const funcs = [...new Set(affected.flatMap(m => m.usedFunctions))].slice(0, 4).join(', ');
    const names = affected.map(m => m.moduleName).slice(0, 5).join(', ');
    recs.push({ title: `⚠️ ${dep} → impacts ${affected.length} module(s)`, description: `Affects: [${names}]. Functions called: ${funcs || '(via import)'}. Ensure backward compatibility.`, priority: 'HIGH' });
  }

  // Risk matrix
  if (impacted.length > 0) {
    const byLevel = { CRITICAL: [], HIGH: [], MEDIUM: [] };
    for (const m of impacted) (byLevel[m.impactLevel] || []).push(m);
    let matrix = 'Risk Matrix:\n';
    if (byLevel.CRITICAL.length) matrix += `• 🔴 Critical (${byLevel.CRITICAL.length}): ${byLevel.CRITICAL.map(m => m.moduleName).slice(0, 8).join(', ')}\n`;
    if (byLevel.HIGH.length) matrix += `• 🟠 High (${byLevel.HIGH.length}): ${byLevel.HIGH.map(m => m.moduleName).slice(0, 8).join(', ')}\n`;
    if (byLevel.MEDIUM.length) matrix += `• 🟡 Medium (${byLevel.MEDIUM.length}): ${byLevel.MEDIUM.map(m => m.moduleName).slice(0, 8).join(', ')}\n`;
    recs.push({ title: '📊 Impact Risk Matrix', description: matrix, priority: 'HIGH' });
  }

  // General recommendations
  if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
    recs.push({ title: '🚨 Require Senior Review + Full E2E Tests', description: `${impacted.length} modules impacted. Get senior review before merging.`, priority: 'HIGH' });
  }
  if (impacted.length > 5) {
    recs.push({ title: '✂️ Consider splitting into smaller PRs', description: `${impacted.length} modules affected. Separate shared changes from feature changes.`, priority: 'MEDIUM' });
  }

  if (recs.length === 0) {
    recs.push({ title: '✅ Low Risk - Safe to Merge', description: 'Changes are isolated with minimal blast radius.', priority: 'LOW' });
  }
  return recs;
}

function buildTestImpact(changes, impacted) {
  const tests = [];
  const added = new Set();
  for (const c of changes) {
    if (c.filePath.includes('.spec.') || c.filePath.includes('.test.')) {
      const name = c.filePath.includes('/') ? c.filePath.substring(c.filePath.lastIndexOf('/') + 1) : c.filePath;
      if (!added.has(name)) { added.add(name); tests.push({ file: name, status: 'CHANGED', reason: 'Directly modified in this PR' }); }
    }
  }
  for (const m of impacted) {
    if (m.impactLevel !== 'CRITICAL' && m.impactLevel !== 'HIGH') continue;
    if (!m.filePath.endsWith('.ts') && !m.filePath.endsWith('.js')) continue;
    if (m.filePath.includes('.spec.') || m.filePath.includes('.test.')) continue;
    const specName = m.moduleName + '.spec.ts';
    if (!added.has(specName)) { added.add(specName); tests.push({ file: specName, status: 'AT_RISK', reason: `Tests may fail due to ${m.dependsOn} changes` }); }
  }
  return tests.slice(0, 15);
}

function buildModuleRollup(impacted) {
  const byModule = {};
  for (const m of impacted) {
    const mod = inferModule(m.filePath, m.moduleName);
    if (!byModule[mod]) byModule[mod] = [];
    byModule[mod].push(m);
  }
  const rollup = [];
  for (const [mod, items] of Object.entries(byModule)) {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    const highest = items.reduce((h, i) => (order[i.impactLevel] || 3) < (order[h] || 3) ? i.impactLevel : h, 'MEDIUM');
    rollup.push({ module: mod, componentsAffected: items.length, highestImpact: highest, label: `${items.length} component(s)` });
  }
  rollup.sort((a, b) => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2 }[a.highestImpact] || 3) - ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2 }[b.highestImpact] || 3));
  return rollup;
}

function inferModule(filePath, moduleName) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  let feature = null;
  for (const p of parts.slice(0, -1)) {
    if (['src', 'app', 'lib', 'main', 'java', 'com'].includes(p)) continue;
    feature = p; break;
  }
  if (!feature || moduleName.startsWith('app.')) return 'Root (AppModule)';
  if (['shared', 'common', 'core', 'utils', 'directives', 'pipes'].includes(feature)) return 'Shared Module';
  return feature.split('-').map(w => w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ' Module';
}

function buildOwnershipMap(owners, impacted) {
  const map = {};
  for (const m of impacted) {
    for (const [file, authors] of Object.entries(owners)) {
      if (file.includes(m.moduleName) || m.filePath === file) {
        for (const author of authors) {
          if (!map[author]) map[author] = [];
          if (!map[author].includes(m.moduleName)) map[author].push(m.moduleName);
        }
      }
    }
  }
  for (const k of Object.keys(map)) map[k] = map[k].slice(0, 5);
  return map;
}

module.exports = { calculateRiskScore, getRiskLevel, buildVerdict, generateRecommendations, buildTestImpact, buildModuleRollup, buildOwnershipMap };
