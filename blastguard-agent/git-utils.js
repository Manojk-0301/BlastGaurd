#!/usr/bin/env node
'use strict';
const { execSync } = require('child_process');
const path = require('path');

const SKIP_EXTENSIONS = ['.png','.jpg','.jpeg','.gif','.svg','.ico','.woff','.woff2','.ttf','.lock','.map','.zip','.tar','.gz','.pdf'];
const SKIP_PATHS = ['node_modules','dist','build','target','.angular','.git','coverage','__pycache__','.idea','.vscode'];

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 10*1024*1024 }).split('\n');
  } catch { return []; }
}

function isAnalyzable(f) {
  const lower = f.toLowerCase();
  if (SKIP_EXTENSIONS.some(e => lower.endsWith(e))) return false;
  if (SKIP_PATHS.some(s => lower.includes(s + '/') || lower.includes(s + '\\'))) return false;
  return true;
}

function isSource(f) {
  return /\.(ts|js|tsx|jsx|java|py|go|rs|kt)$/i.test(f);
}

function getCurrentBranch(repoPath) {
  const lines = run('git branch --show-current', repoPath);
  return lines[0]?.trim() || 'unknown';
}

function getChangedFiles(repoPath, baseBranch) {
  const lines = run(`git diff --name-only ${baseBranch}`, repoPath);
  return lines.filter(l => l.trim() && !l.startsWith('warning:') && !l.includes('CRLF')).filter(isAnalyzable);
}

function getNumStat(repoPath, baseBranch) {
  const lines = run(`git diff --numstat ${baseBranch}`, repoPath);
  const stats = {};
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length === 3) {
      const add = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
      const del = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
      stats[parts[2]] = { additions: add, deletions: del };
    }
  }
  return stats;
}

function getDetailedChanges(repoPath, baseBranch) {
  const files = getChangedFiles(repoPath, baseBranch);
  const stats = getNumStat(repoPath, baseBranch);
  const changes = [];

  const TS_METHOD = /^[+-]\s*(?:export\s+)?(?:async\s+)?(?:public|private|protected)?\s*(?:static\s+)?([a-zA-Z_$][\w$]*)\s*\(/;
  const TS_ARROW = /^[+-]\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s+)?\(/;
  const JAVA_METHOD = /^[+-]\s*(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\(/;
  const HUNK = /@@\s*-\d+(?:,\d+)?\s*\+\d+(?:,\d+)?\s*@@\s*(.*)/;
  const KEYWORDS = new Set(['if','else','for','while','switch','case','return','new','class','interface','import','export','from','const','let','var','function','constructor','super','this']);

  for (const file of files) {
    const stat = stats[file] || { additions: 0, deletions: 0 };
    const functionsChanged = [];
    const propertiesChanged = [];
    const diffSummaries = [];
    const foundFuncs = new Set();

    if (isSource(file)) {
      const diffLines = run(`git diff ${baseBranch} -- "${file}"`, repoPath);
      let ctx = '';
      let removed = [], added = [];
      let contextLines = [];

      for (const line of diffLines.slice(0, 1000)) {
        const hm = HUNK.exec(line);
        if (hm) {
          processDiff(ctx, removed, added, diffSummaries);
          extractFuncsFromLines(removed.concat(added), file, functionsChanged, foundFuncs);
          extractPropertiesFromLines(removed.concat(added), propertiesChanged);
          // If previous hunk had changes, try to attribute them to the context function
          if ((removed.length > 0 || added.length > 0) && ctx) {
            const hunkFuncName = extractFuncFromContext(ctx, file);
            if (hunkFuncName && !KEYWORDS.has(hunkFuncName) && !foundFuncs.has(hunkFuncName)) {
              foundFuncs.add(hunkFuncName);
              functionsChanged.push({ functionName: hunkFuncName, changeSnippet: ctx });
            }
          }
          ctx = hm[1]?.trim() || '';
          removed = []; added = [];
          contextLines = [];
          continue;
        }
        if (line.startsWith('+') && !line.startsWith('+++')) added.push(line);
        else if (line.startsWith('-') && !line.startsWith('---')) removed.push(line);
        else if (!line.startsWith('\\')) {
          // Context line (unchanged) — check if it's a function declaration
          const funcInContext = extractFuncName('+' + line.trim(), file);
          if (funcInContext && !KEYWORDS.has(funcInContext)) {
            ctx = line.trim(); // Update context to nearest function
          }
        }
      }
      processDiff(ctx, removed, added, diffSummaries);
      extractFuncsFromLines(removed.concat(added), file, functionsChanged, foundFuncs);
      extractPropertiesFromLines(removed.concat(added), propertiesChanged);

      // Fallback: extract from hunk context
      if (functionsChanged.length === 0 && ctx) {
        const name = extractFuncFromContext(ctx, file);
        if (name && !KEYWORDS.has(name)) functionsChanged.push({ functionName: name, changeSnippet: ctx });
      }
    }

    // Get author
    const logLines = run(`git log -1 --format="%an|%s" -- "${file}"`, repoPath);
    let author = 'Unknown', commitMsg = '';
    if (logLines[0]?.includes('|')) {
      const [a, m] = logLines[0].split('|', 2);
      author = a; commitMsg = m || '';
    }

    changes.push({ filePath: file, additions: stat.additions, deletions: stat.deletions, functionsChanged, propertiesChanged, diffSummaries, author, lastCommitMessage: commitMsg });
  }
  return changes;

  function extractFuncName(line, file) {
    if (/\.(ts|js|tsx|jsx)$/.test(file)) {
      let m = TS_METHOD.exec(line);
      if (m && !KEYWORDS.has(m[1])) return m[1];
      m = TS_ARROW.exec(line);
      if (m) return m[1];
    } else if (file.endsWith('.java')) {
      const m = JAVA_METHOD.exec(line);
      if (m) return m[1];
    }
    return null;
  }

  function extractFuncsFromLines(lines, file, funcs, found) {
    for (const line of lines) {
      const name = extractFuncName(line, file);
      if (name && !found.has(name)) {
        found.add(name);
        funcs.push({ functionName: name, changeSnippet: line.substring(1).trim() });
      }
    }
  }

  function extractFuncFromContext(ctx, file) {
    if (ctx.includes('class ') || ctx.includes('interface ')) return null;
    const m = /(?:(?:public|private|protected|async|static|export|function)\s+)*(\w+)\s*\(/.exec(ctx);
    if (m && !KEYWORDS.has(m[1])) return m[1];
    return null;
  }

  function extractPropertiesFromLines(lines, props) {
    const foundProps = new Set();
    const PROP_REGEX = /^[+-]\s*(?:this\.)?([a-zA-Z_$][\w$]*)\s*(?:=|\[|\.)/ ;
    const MEMBER_ASSIGN = /^[+-].*(?:this\.)?([a-zA-Z_$][\w$]*)\s*=/ ;
    for (const line of lines) {
      const clean = line.substring(1).trim();
      // Match: this.pageSizeOptions = ... or pageSizeOptions = ...
      let m = PROP_REGEX.exec(line);
      if (m && m[1] && !KEYWORDS.has(m[1]) && m[1].length > 3) {
        if (!foundProps.has(m[1])) { foundProps.add(m[1]); props.push(m[1]); }
        continue;
      }
      // Match property access in assignments: this.something = 
      m = MEMBER_ASSIGN.exec(line);
      if (m && m[1] && !KEYWORDS.has(m[1]) && m[1].length > 3) {
        if (!foundProps.has(m[1])) { foundProps.add(m[1]); props.push(m[1]); }
      }
    }
  }

  function processDiff(ctx, removed, added, summaries) {
    if (!removed.length && !added.length) return;
    const rem = removed.map(l => l.substring(1).trim()).find(l => l && l !== '{' && l !== '}');
    const add = added.map(l => l.substring(1).trim()).find(l => l && l !== '{' && l !== '}');
    if (rem || add) {
      summaries.push({ context: ctx || '(top-level)', removed: (rem||'').substring(0,100), added: (add||'').substring(0,100) });
    }
  }
}

function getAffectedOwners(repoPath, files) {
  const owners = {};
  for (const file of files.slice(0, 30)) {
    const lines = run(`git log -5 --format="%an" -- "${file}"`, repoPath);
    owners[file] = [...new Set(lines.filter(l => l.trim()))];
  }
  return owners;
}

module.exports = { getCurrentBranch, getChangedFiles, getDetailedChanges, getAffectedOwners, isSource };
