'use strict';
const fs = require('fs');
const path = require('path');

function trackRiskHistory(outputDir, result) {
  const historyFile = path.join(outputDir, 'risk-history.json');
  let history = [];

  if (fs.existsSync(historyFile)) {
    try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch { history = []; }
  }

  const now = new Date();
  const entry = {
    date: now.toISOString().replace('T', ' ').substring(0, 19),
    branch: result.currentBranch,
    riskScore: result.riskScore?.score || 0,
    riskLevel: result.riskScore?.level || 'LOW',
    verdict: result.verdict?.status || 'UNKNOWN',
    filesChanged: result.stats?.totalFilesChanged || 0,
    modulesImpacted: result.stats?.totalImpactedModules || 0,
    testsFailing: result.specAnalysis?.totalLikelyFail || 0
  };

  history.push(entry);

  // Keep last 50 entries
  if (history.length > 50) history = history.slice(-50);

  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');

  // Generate HTML trend report
  generateRiskTrendReport(outputDir, history);

  return {
    history,
    trend: calculateTrend(history),
    summary: buildSprintSummary(history)
  };
}

function calculateTrend(history) {
  if (history.length < 2) return { direction: 'STABLE', change: 0 };

  const recent = history.slice(-5);
  const older = history.slice(-10, -5);

  if (!older.length) return { direction: 'STABLE', change: 0 };

  const recentAvg = recent.reduce((s, e) => s + e.riskScore, 0) / recent.length;
  const olderAvg = older.reduce((s, e) => s + e.riskScore, 0) / older.length;
  const change = Math.round(recentAvg - olderAvg);

  let direction;
  if (change > 10) direction = 'INCREASING';
  else if (change < -10) direction = 'DECREASING';
  else direction = 'STABLE';

  return { direction, change, recentAvg: Math.round(recentAvg), olderAvg: Math.round(olderAvg) };
}

function buildSprintSummary(history) {
  // Last 7 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  const thisWeek = history.filter(e => e.date >= weekAgo);

  if (!thisWeek.length) return { runs: 0, avgRisk: 0, maxRisk: 0, safeMerges: 0, blockedMerges: 0 };

  return {
    runs: thisWeek.length,
    avgRisk: Math.round(thisWeek.reduce((s, e) => s + e.riskScore, 0) / thisWeek.length),
    maxRisk: Math.max(...thisWeek.map(e => e.riskScore)),
    safeMerges: thisWeek.filter(e => e.verdict === 'SAFE').length,
    blockedMerges: thisWeek.filter(e => e.verdict === 'NOT_SAFE').length
  };
}

function generateRiskTrendReport(outputDir, history) {
  // Remove old risk trend reports
  fs.readdirSync(outputDir).filter(f => f.startsWith('Risk_Trend-') && f.endsWith('.html')).forEach(f => fs.unlinkSync(path.join(outputDir, f)));

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
  const fileName = `Risk_Trend-${timestamp}.html`;
  const filePath = path.join(outputDir, fileName);

  const trend = calculateTrend(history);
  const summary = buildSprintSummary(history);

  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>BlastGuard - Risk Trend</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#0f1923;color:#e0e0e0;padding:24px;line-height:1.5}
.header{padding:24px;background:#1a2733;border-radius:12px;border:1px solid #2a3f4f;margin-bottom:20px}
.header h1{font-size:20px;color:#00d4ff}
.card{background:#1a2733;border-radius:12px;padding:20px;border:1px solid #2a3f4f;margin-bottom:16px}
.card h3{color:#00d4ff;margin-bottom:12px;font-size:15px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
.stat-box{background:#0f1923;border-radius:8px;padding:14px;text-align:center;border:1px solid #2a3f4f}
.stat-box .val{font-size:24px;font-weight:bold}
.stat-box .lbl{color:#8899aa;font-size:11px;margin-top:4px}
.chart{width:100%;height:200px;display:flex;align-items:flex-end;gap:4px;padding:10px;background:#0f1923;border-radius:8px}
.bar{flex:1;border-radius:4px 4px 0 0;min-width:8px;position:relative;transition:all 0.3s}
.bar:hover::after{content:attr(data-label);position:absolute;top:-24px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap}
.history-row{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#0f1923;border-radius:6px;margin-bottom:4px;font-size:12px;border-left:3px solid}
.footer{text-align:center;margin-top:20px;color:#556677;font-size:12px}
</style></head><body>\n`;

  html += `<div class="header"><h1>\ud83d\udcc8 BlastGuard — Regression Risk Trend</h1><p style="color:#8899aa;margin-top:4px">Sprint-level risk tracking across runs</p></div>\n`;

  // Summary stats
  const trendIcon = trend.direction === 'INCREASING' ? '\ud83d\udcc8' : trend.direction === 'DECREASING' ? '\ud83d\udcc9' : '\u27a1\ufe0f';
  const trendColor = trend.direction === 'INCREASING' ? '#ff4444' : trend.direction === 'DECREASING' ? '#4caf50' : '#ffd700';
  html += `<div class="stats-grid">`;
  html += `<div class="stat-box"><div class="val" style="color:${trendColor}">${trendIcon} ${trend.direction}</div><div class="lbl">Trend</div></div>`;
  html += `<div class="stat-box"><div class="val" style="color:#00d4ff">${history.length}</div><div class="lbl">Total Runs</div></div>`;
  html += `<div class="stat-box"><div class="val" style="color:#ff8c00">${summary.avgRisk}/100</div><div class="lbl">Avg Risk (7 days)</div></div>`;
  html += `<div class="stat-box"><div class="val" style="color:#ff4444">${summary.maxRisk}/100</div><div class="lbl">Max Risk (7 days)</div></div>`;
  html += `<div class="stat-box"><div class="val" style="color:#4caf50">${summary.safeMerges}</div><div class="lbl">Safe Merges</div></div>`;
  html += `<div class="stat-box"><div class="val" style="color:#ff4444">${summary.blockedMerges}</div><div class="lbl">Blocked Merges</div></div>`;
  html += `</div>\n`;

  // Bar chart
  html += `<div class="card"><h3>Risk Score Over Time</h3><div class="chart">\n`;
  const recent = history.slice(-30);
  for (const entry of recent) {
    const height = Math.max(entry.riskScore, 2);
    const color = entry.riskScore > 75 ? '#ff4444' : entry.riskScore > 50 ? '#ff8c00' : entry.riskScore > 25 ? '#ffd700' : '#4caf50';
    html += `<div class="bar" style="height:${height}%;background:${color}" data-label="${entry.riskScore} - ${entry.date.substring(5, 16)}"></div>\n`;
  }
  html += `</div></div>\n`;

  // History table
  html += `<div class="card"><h3>Run History (last ${recent.length})</h3>\n`;
  for (const entry of [...recent].reverse()) {
    const color = entry.riskScore > 75 ? '#ff4444' : entry.riskScore > 50 ? '#ff8c00' : entry.riskScore > 25 ? '#ffd700' : '#4caf50';
    const verdictIcon = entry.verdict === 'NOT_SAFE' ? '\u274c' : entry.verdict === 'SAFE' ? '\u2705' : '\u26a0\ufe0f';
    html += `<div class="history-row" style="border-color:${color}">`;
    html += `<span style="color:#8899aa;min-width:130px">${entry.date}</span>`;
    html += `<span style="color:${color};font-weight:600;min-width:40px">${entry.riskScore}</span>`;
    html += `<span style="min-width:20px">${verdictIcon}</span>`;
    html += `<span style="color:#fff;min-width:80px">${entry.branch}</span>`;
    html += `<span style="color:#8899aa">${entry.filesChanged} files, ${entry.modulesImpacted} modules, ${entry.testsFailing} failing</span>`;
    html += `</div>\n`;
  }
  html += `</div>\n`;

  html += `<div class="footer">Generated by BlastGuard Agent (PRO)</div>\n</body></html>`;

  fs.writeFileSync(filePath, html, 'utf8');
  return filePath;
}

module.exports = { trackRiskHistory };
