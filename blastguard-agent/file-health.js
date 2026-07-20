'use strict';
const { execSync } = require('child_process');

function run(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 5*1024*1024 }).split('\n').filter(Boolean); }
  catch { return []; }
}

/**
 * Analyze file health based on git history:
 * - Churn rate (how often a file changes)
 * - Number of authors (ownership diffusion)
 * - Recent bug-fix commits touching the file
 */
function analyzeFileHealth(repoPath, changedFiles) {
  const health = [];

  for (const file of changedFiles.slice(0, 20)) {
    // Commit count in last 90 days
    const commits = run(`git log --oneline --since="90 days ago" -- "${file}"`, repoPath);
    const commitCount = commits.length;

    // Unique authors
    const authors = run(`git log --format="%an" --since="90 days ago" -- "${file}"`, repoPath);
    const uniqueAuthors = [...new Set(authors)].length;

    // Bug-fix commits (messages containing fix/bug/hotfix)
    const bugFixes = commits.filter(c => /fix|bug|hotfix|patch|revert/i.test(c)).length;

    // Calculate health score (0-100, lower = unhealthy)
    let score = 100;
    if (commitCount > 20) score -= 30;
    else if (commitCount > 10) score -= 15;
    else if (commitCount > 5) score -= 5;

    if (uniqueAuthors > 5) score -= 20;
    else if (uniqueAuthors > 3) score -= 10;

    if (bugFixes > 3) score -= 25;
    else if (bugFixes > 1) score -= 10;

    score = Math.max(score, 0);

    let status;
    if (score >= 80) status = 'HEALTHY';
    else if (score >= 50) status = 'WARN';
    else status = 'CRITICAL';

    health.push({
      file,
      score,
      status,
      commitCount,
      uniqueAuthors,
      bugFixes,
      reason: buildReason(commitCount, uniqueAuthors, bugFixes)
    });
  }

  // Sort worst first
  health.sort((a, b) => a.score - b.score);
  return health;
}

function buildReason(commits, authors, bugs) {
  const reasons = [];
  if (commits > 10) reasons.push(`${commits} changes in 90 days (high churn)`);
  if (authors > 3) reasons.push(`${authors} different authors (ownership diffusion)`);
  if (bugs > 1) reasons.push(`${bugs} bug-fix commits (error-prone)`);
  if (!reasons.length) reasons.push('Stable file with low churn');
  return reasons.join('; ');
}

module.exports = { analyzeFileHealth };
