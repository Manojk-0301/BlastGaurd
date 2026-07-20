'use strict';
const fs = require('fs');
const path = require('path');
// Used by PRO features in HTML generation

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function generateReport(result, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  // Remove old report files
  fs.readdirSync(outputDir).filter(f => f.startsWith('BlastGuard_Report-') && f.endsWith('.html')).forEach(f => fs.unlinkSync(path.join(outputDir, f)));
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
  const fileName = `BlastGuard_Report-${timestamp}.html`;
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, buildHtml(result), 'utf8');
  return filePath;
}

function buildHtml(r) {
  const { currentBranch, comparedAgainst, projectType, analyzedAt, riskScore, verdict, stats, moduleRollup, testImpact, ownershipMap, changedFiles, impactedModules, recommendations, userImpact } = r;
  const score = riskScore?.score || 0;
  const level = riskScore?.level || 'LOW';
  const riskColor = { CRITICAL:'#FF4444', HIGH:'#FF8C00', MEDIUM:'#FFD700', LOW:'#4CAF50' }[level] || '#4CAF50';

  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>BlastGuard Report - ${esc(currentBranch)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#0f1923;color:#e0e0e0;padding:24px;line-height:1.5}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding:24px;background:#1a2733;border-radius:12px;border:1px solid #2a3f4f}
.header h1{font-size:22px;color:#00d4ff}
.header .meta{text-align:right;color:#8899aa;font-size:13px}
.card{background:#1a2733;border-radius:12px;padding:20px;border:1px solid #2a3f4f;margin-bottom:16px}
.card h3{color:#00d4ff;margin-bottom:12px;font-size:15px}
.verdict{display:flex;align-items:center;gap:16px;padding:20px;border-radius:12px;border:2px solid;margin-bottom:16px}
.verdict.not_safe{border-color:#ff0000;background:#1a0000}
.verdict.review_needed{border-color:#ffd700;background:#1a1500}
.verdict.safe{border-color:#4caf50;background:#001a00}
.verdict-icon{font-size:40px}
.verdict-title{font-size:18px;font-weight:bold;color:#fff}
.verdict-reason{color:#b0bec5;font-size:13px;margin-top:4px}
.verdict-action{color:#8899aa;font-size:12px;margin-top:4px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
.stat-box{background:#0f1923;border-radius:8px;padding:14px;text-align:center;border:1px solid #2a3f4f}
.stat-box .val{font-size:28px;font-weight:bold}
.stat-box .lbl{color:#8899aa;font-size:11px;margin-top:4px}
.green{color:#4caf50}.red{color:#ff4444}
.rollup-grid{display:flex;flex-wrap:wrap;gap:10px}
.rollup-item{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#0f1923;border-radius:8px;border-left:3px solid}
.rollup-item.critical{border-color:#ff0000}.rollup-item.high{border-color:#ff4444}.rollup-item.medium{border-color:#ffd700}
.badge{padding:3px 8px;border-radius:8px;font-size:10px;font-weight:bold}
.badge.critical{background:#ff0000;color:#fff}.badge.high{background:#ff4444;color:#fff}.badge.medium{background:#ffd700;color:#333}.badge.low{background:#4caf50;color:#fff}
.diff-item{padding:10px;background:#0f1923;border-radius:6px;margin-bottom:8px;font-family:Consolas,monospace;font-size:12px}
.diff-ctx{color:#8899aa;font-size:11px;margin-bottom:4px}
.diff-rem{color:#ff6b6b;background:#2a0000;padding:3px 8px;border-radius:3px;margin-bottom:3px}
.diff-add{color:#69f0ae;background:#002a00;padding:3px 8px;border-radius:3px}
.test-item{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#0f1923;border-radius:6px;margin-bottom:6px;font-size:13px;border-left:3px solid #ff4444}
.test-item.changed{border-color:#ffd700}
.impacted-item{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#0f1923;border-radius:8px;border-left:3px solid;margin-bottom:6px}
.impacted-item.critical{border-color:#ff0000;background:#1a0000}.impacted-item.high{border-color:#ff4444}.impacted-item.medium{border-color:#ffd700}
.mod-name{color:#fff;font-weight:600;font-size:13px}
.mod-dep{color:#8899aa;font-size:11px}
.mod-funcs{color:#ff8c00;font-size:11px}
.owner-item{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#0f1923;border-radius:8px;margin-bottom:6px}
.owner-name{color:#00d4ff;font-weight:600;min-width:120px}
.owner-mods{color:#8899aa;font-size:12px}
.rec-item{padding:14px;border-radius:8px;border-left:4px solid;background:#0f1923;margin-bottom:10px}
.rec-item.critical{border-color:#ff0000;background:#1a0000}.rec-item.high{border-color:#ff4444}.rec-item.medium{border-color:#ffd700}.rec-item.low{border-color:#4caf50}
.rec-item strong{color:#fff;display:block;margin-bottom:6px}
.rec-desc{color:#b0bec5;font-size:13px;white-space:pre-wrap;line-height:1.6}
.file-item{display:flex;align-items:center;gap:8px;padding:5px 12px;font-size:12px}
.file-name{color:#ccc;flex:1}.file-funcs{color:#00d4ff;font-size:11px}
.footer{text-align:center;margin-top:30px;color:#556677;font-size:12px}
</style></head><body>
`;

  // Header
  html += `<div class="header"><div><h1>🛡️ BlastGuard Analysis Report</h1><p style="color:#8899aa;margin-top:4px">Change Impact Intelligence</p></div>
<div class="meta"><div>Branch: <strong style="color:#fff">${esc(currentBranch)}</strong> vs ${esc(comparedAgainst)}</div><div>Project: ${esc(projectType)}</div><div>Analyzed: ${esc(analyzedAt)}</div></div></div>\n`;

  // Verdict
  if (verdict) {
    html += `<div class="verdict ${verdict.status.toLowerCase()}"><div class="verdict-icon">${verdict.icon}</div><div><div class="verdict-title">${esc(verdict.message)}</div><div class="verdict-reason">${esc(verdict.reason)}</div><div class="verdict-action">Action: ${esc(verdict.action)}</div></div></div>\n`;
  }

  // User Impact
  if (userImpact?.length) {
    html += `<div class="card" style="border-color:#ff4444"><h3 style="color:#ff6b6b">🔥 What End-Users Will Experience If You Merge This</h3>\n`;
    for (const u of userImpact) {
      html += `<div style="padding:12px;background:#0f1923;border-radius:8px;border-left:3px solid #ff4444;margin-bottom:8px">`;
      html += `<div style="color:#00d4ff;font-size:12px;font-weight:600">${esc(u.change)}</div>`;
      if (u.before) html += `<div style="color:#ff6b6b;font-size:12px;font-family:monospace">Was: ${esc(u.before)}</div>`;
      if (u.after) html += `<div style="color:#69f0ae;font-size:12px;font-family:monospace">Now: ${esc(u.after)}</div>`;
      html += `<div style="color:#fff;font-size:13px;font-weight:600;margin-top:6px">→ ${esc(u.userEffect)}</div>`;
      html += `</div>\n`;
    }
    html += `</div>\n`;
  }

  // Stats
  html += `<div class="stats-grid">`;
  html += statBox(score, 'Risk Score', riskColor);
  html += statBox(level, 'Risk Level', riskColor);
  html += statBox(stats?.totalFilesChanged || 0, 'Files Changed', '#00d4ff');
  html += statBox(stats?.totalFunctionsChanged || 0, 'Functions Modified', '#00d4ff');
  html += statBox(stats?.totalImpactedModules || 0, 'Impacted Modules', '#ff8c00');
  html += statBox('+' + (stats?.totalAdditions || 0), 'Lines Added', '#4caf50');
  html += statBox('-' + (stats?.totalDeletions || 0), 'Lines Deleted', '#ff4444');
  html += `</div>\n`;

  // Module Rollup
  if (moduleRollup?.length) {
    html += `<div class="card"><h3>📦 Module Rollup</h3><div class="rollup-grid">\n`;
    for (const m of moduleRollup) {
      const imp = (m.highestImpact || 'MEDIUM').toLowerCase();
      html += `<div class="rollup-item ${imp}"><span style="color:#fff;font-weight:600">${esc(m.module)}</span><span style="color:#8899aa;font-size:12px">${m.label || m.componentsAffected + ' component(s)'}</span><span class="badge ${imp}">${imp.toUpperCase()}</span></div>\n`;
    }
    html += `</div></div>\n`;
  }

  // Diff Summary
  const diffs = changedFiles?.flatMap(c => c.diffSummaries || []).filter(d => d.removed || d.added).slice(0, 15) || [];
  if (diffs.length) {
    html += `<div class="card"><h3>📝 Before / After Summary</h3>\n`;
    for (const d of diffs) {
      html += `<div class="diff-item"><div class="diff-ctx">${esc(d.context)}</div>`;
      if (d.removed) html += `<div class="diff-rem">- ${esc(d.removed)}</div>`;
      if (d.added) html += `<div class="diff-add">+ ${esc(d.added)}</div>`;
      html += `</div>\n`;
    }
    html += `</div>\n`;
  }

  // Impacted Modules
  if (impactedModules?.length) {
    html += `<div class="card"><h3>⚡ Impacted Modules (${impactedModules.length})</h3><p style="color:#8899aa;font-size:12px;margin-bottom:12px">CRITICAL = directly calls modified functions</p>\n`;
    for (const m of impactedModules) {
      const imp = (m.impactLevel || 'MEDIUM').toLowerCase();
      html += `<div class="impacted-item ${imp}"><div><span class="mod-name">${esc(m.moduleName)}</span><br><span class="mod-dep">depends on → ${esc(m.dependsOn)}</span>`;
      if (m.usedFunctions?.length) html += `<br><span class="mod-funcs">🔴 Calls: ${esc(m.usedFunctions.join(', '))}</span>`;
      html += `</div><span class="badge ${imp}">${(m.impactLevel||'MEDIUM')}</span></div>\n`;
    }
    html += `</div>\n`;
  }

  // Ownership
  if (ownershipMap && Object.keys(ownershipMap).length) {
    html += `<div class="card"><h3>👥 Team Members Affected — Notify Before Merge</h3>\n`;
    for (const [owner, mods] of Object.entries(ownershipMap)) {
      html += `<div class="owner-item"><span class="owner-name">${esc(owner)}</span><span class="owner-mods">→ ${esc(mods.join(', '))}</span></div>\n`;
    }
    html += `</div>\n`;
  }

  // Changed Files
  if (changedFiles?.length) {
    html += `<div class="card"><h3>📂 Changed Files (${changedFiles.length})</h3>\n`;
    for (const c of changedFiles) {
      const funcs = (c.functionsChanged || []).map(f => f.functionName).filter(Boolean).join(', ');
      html += `<div class="file-item"><span class="file-name">${esc(c.filePath)}</span><span class="green">+${c.additions}</span><span class="red">-${c.deletions}</span>`;
      if (funcs) html += `<span class="file-funcs">ƒ ${esc(funcs)}</span>`;
      html += `</div>\n`;
    }
    html += `</div>\n`;
  }

  // Review Time Estimate
  if (r.reviewTime) {
    html += `<div class="card"><h3>⏱️ Estimated Review Time: ${esc(r.reviewTime.label)}</h3><p style="color:#8899aa;font-size:12px">${esc(r.reviewTime.breakdown)}</p></div>\n`;
  }

  // File Health
  if (r.fileHealth?.length) {
    const unhealthy = r.fileHealth.filter(f => f.status !== 'HEALTHY');
    if (unhealthy.length) {
      html += `<div class="card"><h3>🏥 File Health (${unhealthy.length} warning${unhealthy.length>1?'s':''})</h3>\n`;
      for (const f of unhealthy) {
        const color = f.status === 'CRITICAL' ? '#ff4444' : '#ffd700';
        html += `<div style="padding:10px;background:#0f1923;border-radius:6px;border-left:3px solid ${color};margin-bottom:6px;display:flex;justify-content:space-between;align-items:center"><div><span style="color:#fff;font-weight:600">${esc(path.basename(f.file))}</span><br><span style="color:#8899aa;font-size:11px">${esc(f.reason)}</span></div><span class="badge ${f.status.toLowerCase()}" style="background:${color};color:#fff;padding:4px 10px;border-radius:12px;font-size:11px">${f.score}/100</span></div>\n`;
      }
      html += `</div>\n`;
    }
  }

  // Pattern Detection
  if (r.patterns?.length) {
    html += `<div class="card"><h3>🔍 Anti-Patterns Detected (${r.patterns.length})</h3>\n`;
    for (const p of r.patterns) {
      const color = { CRITICAL:'#ff0000', HIGH:'#ff4444', MEDIUM:'#ffd700', LOW:'#8899aa' }[p.severity] || '#8899aa';
      html += `<div style="padding:12px;background:#0f1923;border-radius:8px;border-left:3px solid ${color};margin-bottom:8px"><div style="color:#fff;font-weight:600;font-size:13px">${esc(p.title)}</div><div style="color:#8899aa;font-size:12px">${esc(p.file)} — ${esc(p.description)}</div>`;
      if (p.findings?.length) {
        html += `<div style="margin-top:6px;font-family:Consolas,monospace;font-size:11px;color:#b0bec5">`;
        for (const f of p.findings.slice(0, 3)) {
          html += `<div>Line ${f.line || '?'}: ${esc(f.snippet || f.function || f.value || '')}</div>`;
        }
        html += `</div>`;
      }
      html += `</div>\n`;
    }
    html += `</div>\n`;
  }

  // Test Suggestions
  if (r.testSuggestions?.suggestions?.length) {
    const ts = r.testSuggestions;
    html += `<div class="card"><h3>🧪 Test Impact Analysis (${ts.summary.total})</h3>\n`;
    html += `<div style="padding:10px;background:#0f1923;border-radius:6px;margin-bottom:10px;font-family:Consolas,monospace;font-size:12px;color:#69f0ae">$ ${esc(ts.combinedCommand)}</div>\n`;
    for (const s of ts.suggestions.slice(0, 10)) {
      const icon = s.priority === 'MUST_RUN' ? '🔴' : '🟡';
      html += `<div style="padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:8px"><span>${icon}</span><span style="color:#fff;min-width:200px">${esc(path.basename(s.file))}</span><span style="color:#8899aa;font-size:11px">${esc(s.reason)}</span></div>\n`;
    }
    html += `</div>\n`;
  }

  // Spec Analysis - Test Failure Predictions
  if (r.specAnalysis?.specResults?.length) {
    const sa = r.specAnalysis;
    const borderColor = sa.totalLikelyFail > 0 ? '#ff4444' : '#ffd700';
    html += `<div class="card" style="border-color:${borderColor}"><h3 style="color:${borderColor}">📋 Spec File Analysis — ${sa.totalTests} Test Cases Analyzed</h3>\n`;
    html += `<div style="display:flex;gap:20px;margin-bottom:14px;padding:10px;background:#0f1923;border-radius:8px"><span style="color:#ff4444;font-weight:600">❌ Likely Fail: ${sa.totalLikelyFail}</span><span style="color:#ffd700;font-weight:600">⚠️ At Risk: ${sa.totalAtRisk}</span><span style="color:#4caf50;font-weight:600">✅ Safe: ${sa.totalSafe}</span></div>\n`;

    for (const spec of sa.specResults.filter(s => s.overallStatus !== 'SAFE').slice(0, 10)) {
      const statusColor = spec.overallStatus === 'FAILING' ? '#ff4444' : '#ffd700';
      html += `<div style="margin-bottom:12px;padding:14px;background:#0f1923;border-radius:8px;border-left:3px solid ${statusColor}">\n`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="color:#fff;font-weight:600;font-size:13px">${esc(path.basename(spec.specFile))}</span><span class="badge" style="background:${statusColor};color:#fff;padding:3px 10px;border-radius:12px;font-size:10px">${spec.summary.likelyFail} FAIL / ${spec.totalTests} tests</span></div>\n`;
      if (spec.testedModule) html += `<div style="color:#8899aa;font-size:11px;margin-bottom:8px">Tests module: ${esc(spec.testedModule)}</div>\n`;
      for (const tc of spec.testCases.filter(t => t.prediction === 'LIKELY_FAIL').slice(0, 5)) {
        html += `<div style="padding:6px 10px;margin-bottom:4px;background:#1a0000;border-radius:4px;font-size:12px"><span style="color:#ff6b6b">❌</span> <span style="color:#fff">${esc(tc.testName)}</span><br><span style="color:#ff8c00;font-size:11px;margin-left:20px">→ ${esc(tc.reason)}</span></div>\n`;
      }
      for (const tc of spec.testCases.filter(t => t.prediction === 'AT_RISK').slice(0, 3)) {
        html += `<div style="padding:6px 10px;margin-bottom:4px;background:#1a1500;border-radius:4px;font-size:12px"><span style="color:#ffd700">⚠️</span> <span style="color:#ccc">${esc(tc.testName)}</span><br><span style="color:#8899aa;font-size:11px;margin-left:20px">→ ${esc(tc.reason)}</span></div>\n`;
      }
      html += `</div>\n`;
    }
    const safeSpecs = sa.specResults.filter(s => s.overallStatus === 'SAFE');
    if (safeSpecs.length) {
      html += `<div style="padding:8px 12px;color:#4caf50;font-size:12px">✅ ${safeSpecs.length} spec file(s) with ${safeSpecs.reduce((s,x) => s + x.totalTests, 0)} tests are unaffected</div>\n`;
    }
    html += `</div>\n`;
  }

  // Auto-Fix Suggestions
  if (r.fixSuggestions?.length) {
    html += `<div class="card" style="border-color:#69f0ae"><h3 style="color:#69f0ae">🔧 Auto-Fix Suggestions (${r.fixSuggestions.length})</h3>\n`;
    for (const fix of r.fixSuggestions) {
      const color = { CRITICAL:'#ff4444', HIGH:'#ff8c00', MEDIUM:'#ffd700', LOW:'#8899aa' }[fix.severity] || '#ffd700';
      html += `<div style="padding:12px;background:#0f1923;border-radius:8px;border-left:3px solid ${color};margin-bottom:8px">`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center"><span style="color:#fff;font-weight:600;font-size:13px">${esc(fix.title)}</span><span class="badge" style="background:${color};color:#fff;padding:3px 8px;border-radius:8px;font-size:10px">${fix.severity}</span></div>`;
      html += `<div style="color:#8899aa;font-size:12px;margin-top:4px">${esc(fix.module)} — ${esc(fix.description)}</div>`;
      html += `<div style="color:#69f0ae;font-size:12px;margin-top:6px;font-family:Consolas,monospace;background:#002a00;padding:6px 10px;border-radius:4px">→ ${esc(fix.fix)}</div>`;
      html += `</div>\n`;
    }
    html += `</div>\n`;
  }

  // Dead Code
  if (r.deadCode?.length) {
    html += `<div class="card"><h3>💀 Dead Code — Unused Functions (${r.deadCode.length})</h3>\n`;
    for (const d of r.deadCode) {
      html += `<div style="padding:8px 12px;background:#0f1923;border-radius:6px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">`;
      html += `<div><span style="color:#fff;font-weight:600">${esc(d.functionName)}</span><span style="color:#8899aa;font-size:11px;margin-left:10px">in ${esc(path.basename(d.file))} (line ${d.line})</span></div>`;
      html += `<span style="color:#8899aa;font-size:11px">${esc(d.reason)}</span>`;
      html += `</div>\n`;
    }
    html += `</div>\n`;
  }

  // Jira Ticket Validation
  if (r.jiraValidation && r.jiraValidation.status !== 'NO_TICKET') {
    const jv = r.jiraValidation;
    const jiraColor = jv.status === 'VALIDATED' ? '#4caf50' : jv.status === 'GAPS_FOUND' ? '#ff8c00' : '#8899aa';
    html += `<div class="card" style="border-color:${jiraColor}"><h3 style="color:${jiraColor}">🎫 Jira Ticket Validation — ${esc(jv.ticketId || 'N/A')}</h3>\n`;
    if (jv.ticketTitle) html += `<div style="color:#fff;font-size:13px;margin-bottom:10px">${esc(jv.ticketTitle)}</div>\n`;
    if (jv.status === 'NO_CONFIG') {
      html += `<div style="padding:10px;background:#0f1923;border-radius:6px;color:#ffd700;font-size:12px">⚠️ Jira not configured. Add JIRA_BASE_URL and JIRA_TOKEN to .env file, or manually create a cache file.</div>\n`;
    } else if (jv.validation) {
      html += `<div style="display:flex;gap:20px;margin-bottom:12px;padding:10px;background:#0f1923;border-radius:8px"><span style="color:#4caf50;font-weight:600">✅ Matched: ${jv.validation.matchedCount}</span><span style="color:#ff8c00;font-weight:600">❌ Gaps: ${jv.validation.gapCount}</span><span style="color:#00d4ff;font-weight:600">Completion: ${jv.validation.completionPercent}%</span></div>\n`;
      if (jv.validation.matched?.length) {
        for (const m of jv.validation.matched.slice(0, 5)) {
          html += `<div style="padding:6px 10px;margin-bottom:4px;background:#001a00;border-radius:4px;font-size:12px"><span style="color:#4caf50">✅</span> <span style="color:#ccc">${esc(m.criteria)}</span> <span style="color:#8899aa;font-size:10px">(${m.confidence}% match)</span></div>\n`;
        }
      }
      if (jv.validation.gaps?.length) {
        for (const g of jv.validation.gaps.slice(0, 5)) {
          html += `<div style="padding:6px 10px;margin-bottom:4px;background:#1a0000;border-radius:4px;font-size:12px"><span style="color:#ff6b6b">❌</span> <span style="color:#ccc">${esc(g.criteria)}</span> <span style="color:#8899aa;font-size:10px">${esc(g.reason)}</span></div>\n`;
        }
      }
    }
    html += `</div>\n`;
  }

  // Recommendations
  if (recommendations?.length) {
    html += `<div class="card"><h3>💡 Impact Analysis & Recommendations</h3>\n`;
    for (const rec of recommendations) {
      const p = (rec.priority || 'MEDIUM').toLowerCase();
      html += `<div class="rec-item ${p}"><strong>${esc(rec.title)}</strong><div class="rec-desc">${esc(rec.description)}</div></div>\n`;
    }
    html += `</div>\n`;
  }

  html += `<div class="footer">Generated by BlastGuard Agent (PRO) • ${esc(analyzedAt)}</div>\n</body></html>`;
  return html;
}

function statBox(val, label, color) {
  return `<div class="stat-box"><div class="val" style="color:${color}">${esc(String(val))}</div><div class="lbl">${label}</div></div>`;
}

module.exports = { generateReport };
