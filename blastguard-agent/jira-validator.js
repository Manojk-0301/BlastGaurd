'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Jira Ticket Validator
 * - Extracts ticket ID from branch name
 * - Fetches ticket details (caches locally)
 * - Compares acceptance criteria against actual code changes
 * - Flags gaps
 * 
 * Config: Set JIRA_BASE_URL and JIRA_TOKEN in .env or pass via CLI
 */

function validateJiraTicket(repoPath, result, outputDir) {
  const ticketId = extractTicketId(result.currentBranch, repoPath);
  if (!ticketId) {
    return { status: 'NO_TICKET', message: 'No Jira ticket ID found. Use --jira PROJ-123 flag, add to commit message, or create a .blastguard config file.', ticketId: null };
  }

  return runValidation(ticketId, repoPath, result, outputDir);
}

function validateJiraTicketInteractive(repoPath, result, outputDir) {
  return new Promise((resolve) => {
    let ticketId = extractTicketId(result.currentBranch, repoPath);

    if (ticketId) {
      resolve(runValidation(ticketId, repoPath, result, outputDir));
      return;
    }

    // Ask user for Jira ticket
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.question('   \x1b[36m? Enter Jira ticket ID (or press Enter to skip): \x1b[0m', (answer) => {
      rl.close();
      const input = (answer || '').trim().toUpperCase();
      if (!input || !/^[A-Z][A-Z0-9]+-\d+$/.test(input)) {
        resolve({ status: 'SKIPPED', message: 'Jira validation skipped', ticketId: null });
        return;
      }
      resolve(runValidation(input, repoPath, result, outputDir));
    });
  });
}

function runValidation(ticketId, repoPath, result, outputDir) {
  // Check cache first
  const cacheDir = path.join(outputDir, '.jira-cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `${ticketId}.json`);

  let ticket = loadFromCache(cacheFile);

  if (!ticket) {
    const config = loadJiraConfig(repoPath);
    if (!config.baseUrl || !config.token) {
      return {
        status: 'NO_CONFIG',
        message: `Ticket ${ticketId} detected but Jira not configured. Add JIRA_BASE_URL and JIRA_TOKEN to .env file, or create ${ticketId}.json in ${cacheDir}`,
        ticketId,
        configHelp: buildConfigHelp(ticketId, cacheFile)
      };
    }
    ticket = fetchTicket(config, ticketId);
    if (ticket) saveToCache(cacheFile, ticket);
  }

  if (!ticket) {
    return { status: 'FETCH_FAILED', message: `Could not fetch ticket ${ticketId}`, ticketId };
  }

  const validation = validateChangesAgainstTicket(ticket, result);

  return {
    status: validation.gaps.length > 0 ? 'GAPS_FOUND' : 'VALIDATED',
    ticketId,
    ticketTitle: ticket.title || ticket.summary,
    acceptanceCriteria: ticket.acceptanceCriteria || [],
    validation
  };
}

function extractTicketId(branchName, repoPath) {
  // Method 1: CLI argument --jira PROJ-123
  const args = process.argv.slice(2);
  const jiraIdx = args.indexOf('--jira');
  if (jiraIdx >= 0 && args[jiraIdx + 1]) {
    return args[jiraIdx + 1].toUpperCase();
  }

  // Method 2: .blastguard config file in repo root
  if (repoPath) {
    const configFile = path.join(repoPath, '.blastguard');
    if (fs.existsSync(configFile)) {
      try {
        const content = fs.readFileSync(configFile, 'utf8');
        const match = content.match(/jira\s*[=:]\s*([A-Z][A-Z0-9]+-\d+)/i);
        if (match) return match[1].toUpperCase();
      } catch {}
    }
  }

  // Method 3: Branch name (ft-PROJ-123, feature/PROJ-123, etc.)
  if (branchName) {
    const match = branchName.match(/([A-Z][A-Z0-9]+-\d+)/i);
    if (match) return match[1].toUpperCase();
  }

  // Method 4: Recent commit messages
  if (repoPath) {
    const { execSync } = require('child_process');
    try {
      const commits = execSync('git log -5 --format="%s"', { cwd: repoPath, encoding: 'utf8', timeout: 5000 });
      const match = commits.match(/([A-Z][A-Z0-9]+-\d+)/i);
      if (match) return match[1].toUpperCase();
    } catch {}
  }

  // Method 5: PR description file (if exists)
  if (repoPath) {
    const prFile = path.join(repoPath, '.github', 'pull_request_template.md');
    if (fs.existsSync(prFile)) {
      try {
        const content = fs.readFileSync(prFile, 'utf8');
        const match = content.match(/([A-Z][A-Z0-9]+-\d+)/i);
        if (match) return match[1].toUpperCase();
      } catch {}
    }
  }

  return null;
}

function loadJiraConfig(repoPath) {
  const config = { baseUrl: '', token: '', email: '', authMethod: 'basic' };

  // Check .env file
  const envFile = path.join(repoPath, '.env');
  if (fs.existsSync(envFile)) {
    try {
      const content = fs.readFileSync(envFile, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const [key, ...vals] = line.split('=');
        const val = vals.join('=').trim().replace(/^['"]|['"]$/g, '');
        if (key.trim() === 'JIRA_BASE_URL') config.baseUrl = val;
        if (key.trim() === 'JIRA_TOKEN') config.token = val;
        if (key.trim() === 'JIRA_EMAIL') config.email = val;
        if (key.trim() === 'JIRA_AUTH_METHOD') config.authMethod = val;
        if (key.trim() === 'JIRA_OAUTH_TOKEN') { config.token = val; config.authMethod = 'bearer'; }
      }
    } catch {}
  }

  // Also check environment variables
  config.baseUrl = config.baseUrl || process.env.JIRA_BASE_URL || '';
  config.token = config.token || process.env.JIRA_TOKEN || '';
  config.email = config.email || process.env.JIRA_EMAIL || '';
  if (process.env.JIRA_OAUTH_TOKEN) { config.token = process.env.JIRA_OAUTH_TOKEN; config.authMethod = 'bearer'; }

  return config;
}

function fetchTicket(config, ticketId) {
  const { execSync } = require('child_process');
  const url = `${config.baseUrl}/rest/api/2/issue/${ticketId}?fields=summary,description,customfield_10016,acceptance_criteria,labels,status,issuetype`;

  try {
    let authHeader;
    if (config.authMethod === 'bearer') {
      // OAuth 2.0 / PAT bearer token
      authHeader = `Authorization: Bearer ${config.token}`;
    } else {
      // Basic auth (email:token)
      const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');
      authHeader = `Authorization: Basic ${auth}`;
    }

    const response = execSync(`curl -s -H "${authHeader}" -H "Content-Type: application/json" "${url}"`, {
      encoding: 'utf8', timeout: 10000
    });
    const data = JSON.parse(response);
    if (!data.fields) return null;

    return {
      id: ticketId,
      title: data.fields.summary || '',
      description: data.fields.description || '',
      acceptanceCriteria: extractAcceptanceCriteria(data.fields),
      labels: data.fields.labels || [],
      status: data.fields.status?.name || '',
      type: data.fields.issuetype?.name || ''
    };
  } catch {
    return null;
  }
}

function extractAcceptanceCriteria(fields) {
  const criteria = [];

  // Try common AC fields
  const acText = fields.customfield_10016 || fields.acceptance_criteria || '';
  const description = fields.description || '';

  // Parse from description (look for "Acceptance Criteria" section)
  const combined = acText + '\n' + description;
  const acSection = combined.match(/(?:acceptance\s*criteria|AC|given.*when.*then)[\s:]*\n?([\s\S]*?)(?:\n\n|\n(?=[A-Z])|\n---|\z)/i);

  if (acSection) {
    const lines = acSection[1].split('\n').filter(l => l.trim());
    for (const line of lines) {
      const clean = line.replace(/^[-*•\d.)\]]\s*/, '').trim();
      if (clean.length > 5) criteria.push(clean);
    }
  }

  // Fallback: extract bullet points from description
  if (!criteria.length) {
    const bullets = description.match(/^[-*•]\s+.+$/gm);
    if (bullets) {
      for (const b of bullets.slice(0, 10)) {
        criteria.push(b.replace(/^[-*•]\s+/, '').trim());
      }
    }
  }

  return criteria;
}

function validateChangesAgainstTicket(ticket, result) {
  const { changedFiles, impactedModules, specAnalysis } = result;
  const matched = [];
  const gaps = [];

  // Build a keyword set from code changes
  const codeKeywords = new Set();
  for (const change of (changedFiles || [])) {
    const fileName = path.basename(change.filePath || '').toLowerCase();
    codeKeywords.add(fileName);
    for (const func of (change.functionsChanged || [])) {
      if (func.functionName) {
        codeKeywords.add(func.functionName.toLowerCase());
        // Split camelCase
        func.functionName.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/).forEach(w => {
          if (w.length > 3) codeKeywords.add(w);
        });
      }
    }
    for (const diff of (change.diffSummaries || [])) {
      const words = ((diff.removed || '') + ' ' + (diff.added || '')).toLowerCase().match(/[a-z]{4,}/g);
      if (words) words.forEach(w => codeKeywords.add(w));
    }
  }

  // Check each acceptance criteria against code changes
  for (const ac of (ticket.acceptanceCriteria || [])) {
    const acWords = ac.toLowerCase().match(/[a-z]{4,}/g) || [];
    const matchCount = acWords.filter(w => codeKeywords.has(w)).length;
    const matchRatio = acWords.length > 0 ? matchCount / acWords.length : 0;

    if (matchRatio >= 0.3) {
      matched.push({ criteria: ac, confidence: Math.round(matchRatio * 100), matchedKeywords: acWords.filter(w => codeKeywords.has(w)).slice(0, 5) });
    } else {
      gaps.push({ criteria: ac, confidence: Math.round(matchRatio * 100), reason: 'No matching code changes found for this requirement' });
    }
  }

  // Check if tests cover the changes
  const hasTests = specAnalysis?.totalTests > 0;
  const testsCovering = specAnalysis?.totalSafe || 0;

  return {
    matched,
    gaps,
    totalCriteria: ticket.acceptanceCriteria?.length || 0,
    matchedCount: matched.length,
    gapCount: gaps.length,
    completionPercent: ticket.acceptanceCriteria?.length ? Math.round((matched.length / ticket.acceptanceCriteria.length) * 100) : 100,
    hasTestCoverage: hasTests,
    testsCovering
  };
}

function loadFromCache(cacheFile) {
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const stat = fs.statSync(cacheFile);
    // Cache valid for 24 hours
    if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) return null;
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch { return null; }
}

function saveToCache(cacheFile, ticket) {
  try { fs.writeFileSync(cacheFile, JSON.stringify(ticket, null, 2), 'utf8'); } catch {}
}

function buildConfigHelp(ticketId, cacheFile) {
  return {
    option1: `Add to .env file:\nJIRA_BASE_URL=https://your-org.atlassian.net\nJIRA_TOKEN=your-api-token\nJIRA_EMAIL=your-email@company.com`,
    option2: `Manually create cache file at:\n${cacheFile}\n\nWith format:\n{\n  "id": "${ticketId}",\n  "title": "Ticket title",\n  "description": "Full description",\n  "acceptanceCriteria": [\n    "Criteria 1",\n    "Criteria 2"\n  ]\n}`
  };
}

module.exports = { validateJiraTicket, validateJiraTicketInteractive, extractTicketId };
