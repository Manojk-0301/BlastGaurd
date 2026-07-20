'use strict';
const fs = require('fs');
const path = require('path');

const PATTERNS = [
  {
    id: 'GOD_FUNCTION',
    title: '🚨 God Function Detected',
    description: 'Function exceeds 50 lines — hard to test, review, and maintain',
    severity: 'HIGH',
    check: (content, filePath) => {
      const findings = [];
      const lines = content.split('\n');
      let funcStart = -1, funcName = '', braceCount = 0, inFunc = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const funcMatch = /(?:public|private|protected|async|static|\s)*\s+([a-zA-Z_$][\w$]*)\s*\(/.exec(line);
        if (funcMatch && !inFunc && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
          funcStart = i; funcName = funcMatch[1]; braceCount = 0; inFunc = true;
        }
        if (inFunc) {
          braceCount += (line.match(/{/g) || []).length;
          braceCount -= (line.match(/}/g) || []).length;
          if (braceCount <= 0 && i > funcStart) {
            const length = i - funcStart;
            if (length > 50) findings.push({ function: funcName, lines: length, line: funcStart + 1 });
            inFunc = false;
          }
        }
      }
      return findings;
    }
  },
  {
    id: 'HARDCODED_SECRET',
    title: '🔑 Potential Hardcoded Secret',
    description: 'Possible API key, password, or token found in code',
    severity: 'CRITICAL',
    check: (content, filePath) => {
      if (filePath.includes('.spec.') || filePath.includes('.test.') || filePath.includes('mock')) return [];
      const findings = [];
      const lines = content.split('\n');
      const patterns = [
        /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/i,
        /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i,
        /(?:secret|token)\s*[:=]\s*['"][A-Za-z0-9+/=]{16,}['"]/i,
        /(?:AKIA|ASIA)[A-Z0-9]{16}/
      ];
      for (let i = 0; i < lines.length; i++) {
        for (const p of patterns) {
          if (p.test(lines[i]) && !lines[i].trim().startsWith('//') && !lines[i].includes('example') && !lines[i].includes('placeholder')) {
            findings.push({ line: i + 1, snippet: lines[i].trim().substring(0, 80) });
            break;
          }
        }
      }
      return findings;
    }
  },
  {
    id: 'CIRCULAR_IMPORT',
    title: '🔄 Potential Circular Import',
    description: 'File imports a module that likely imports it back — causes runtime issues',
    severity: 'MEDIUM',
    check: (content, filePath, allChangedFiles) => {
      const findings = [];
      const thisModule = path.basename(filePath).replace(/\.(ts|js|java|tsx|jsx)$/, '');
      const importRegex = /import\s+.*from\s+['"]\.\/([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const imported = match[1].replace(/\.(ts|js)$/, '');
        // Check if the imported file also imports this file
        if (allChangedFiles?.some(f => f.includes(imported))) {
          findings.push({ imports: imported, from: thisModule });
        }
      }
      return findings;
    }
  },
  {
    id: 'CONSOLE_LOG',
    title: '🖨️ Console.log Left in Code',
    description: 'Debug logging should be removed before merge',
    severity: 'LOW',
    check: (content, filePath) => {
      if (filePath.includes('.spec.') || filePath.includes('.test.')) return [];
      const findings = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/console\.(log|debug|warn|error)\s*\(/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
          findings.push({ line: i + 1, snippet: lines[i].trim().substring(0, 60) });
        }
      }
      return findings;
    }
  },
  {
    id: 'ANY_TYPE',
    title: '⚠️ TypeScript `any` Type Usage',
    description: 'Using `any` defeats TypeScript type safety — use proper types',
    severity: 'MEDIUM',
    check: (content, filePath) => {
      if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return [];
      const findings = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/:\s*any\b/.test(lines[i]) && !lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*')) {
          findings.push({ line: i + 1, snippet: lines[i].trim().substring(0, 60) });
        }
      }
      return findings;
    }
  },
  {
    id: 'MAGIC_NUMBER',
    title: '🔢 Magic Number Detected',
    description: 'Unexplained numeric literals — use named constants for readability',
    severity: 'LOW',
    check: (content, filePath) => {
      const findings = [];
      const lines = content.split('\n');
      const ignore = new Set([0, 1, 2, -1, 100, 200, 404, 500]);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.includes('const') || line.includes('enum')) continue;
        const nums = line.match(/(?<![a-zA-Z_$])\d{3,}(?![a-zA-Z_$\d])/g);
        if (nums) {
          for (const n of nums) {
            if (!ignore.has(parseInt(n)) && !line.includes('timeout') && !line.includes('port')) {
              findings.push({ line: i + 1, value: n });
              break;
            }
          }
        }
      }
      return findings.slice(0, 5);
    }
  }
];

/**
 * Scan changed files for anti-patterns
 */
function detectPatterns(repoPath, changedFiles) {
  const results = [];

  for (const file of changedFiles.slice(0, 30)) {
    const fullPath = path.join(repoPath, file);
    if (!fs.existsSync(fullPath)) continue;
    if (!/\.(ts|js|tsx|jsx|java|py)$/.test(file)) continue;

    let content;
    try { content = fs.readFileSync(fullPath, 'utf8'); } catch { continue; }

    for (const pattern of PATTERNS) {
      const findings = pattern.check(content, file, changedFiles);
      if (findings.length > 0) {
        results.push({
          file,
          patternId: pattern.id,
          title: pattern.title,
          description: pattern.description,
          severity: pattern.severity,
          findings: findings.slice(0, 5),
          count: findings.length
        });
      }
    }
  }

  // Sort by severity
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  results.sort((a, b) => (order[a.severity] || 3) - (order[b.severity] || 3));
  return results;
}

module.exports = { detectPatterns };
