'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules','dist','build','target','.angular','.git','coverage','__pycache__','.idea','.vscode','e2e','.nx']);

function getSourceFiles(dir, files = [], depth = 0) {
  if (depth > 10 || files.length >= 500) return files;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (files.length >= 500) break;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) getSourceFiles(path.join(dir, e.name), files, depth + 1);
      } else if (/\.(ts|js|tsx|jsx)$/.test(e.name) && !e.name.includes('.spec.') && !e.name.includes('.test.')) {
        files.push(path.join(dir, e.name));
      }
    }
  } catch {}
  return files;
}

function extractExports(filePath) {
  const exports = [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const KEYWORDS = new Set(['if','else','for','while','switch','return','new','class','interface','import','export','from','const','let','var','function','constructor','super','this','ngOnInit','ngOnDestroy','ngAfterViewInit']);
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      let m;
      // public methods in classes
      m = /^(?:public\s+)?(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/.exec(t);
      if (m && !KEYWORDS.has(m[1]) && !t.startsWith('//') && !t.startsWith('*')) {
        exports.push({ name: m[1], line: i + 1 });
        continue;
      }
      // exported functions
      m = /^export\s+(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/.exec(t);
      if (m) { exports.push({ name: m[1], line: i + 1 }); continue; }
      // exported const/let
      m = /^export\s+(?:const|let)\s+([a-zA-Z_$][\w$]*)\s*=/.exec(t);
      if (m) { exports.push({ name: m[1], line: i + 1 }); continue; }
    }
  } catch {}
  return exports;
}

function findDeadCode(repoPath, changedFiles) {
  const srcPath = path.join(repoPath, 'src');
  const searchPath = fs.existsSync(srcPath) ? srcPath : repoPath;
  const allFiles = getSourceFiles(searchPath);

  // Only analyze changed files for dead code (scope it to what's relevant)
  const deadCode = [];

  for (const file of changedFiles) {
    const fullPath = path.join(repoPath, file);
    if (!fs.existsSync(fullPath) || !/\.(ts|js|tsx|jsx)$/.test(file)) continue;
    if (file.includes('.spec.') || file.includes('.test.')) continue;

    const exports = extractExports(fullPath);
    if (!exports.length) continue;

    for (const exp of exports) {
      if (exp.name.length < 3) continue;
      // Skip Angular lifecycle hooks and common patterns
      if (/^(ng|on|handle|get|set|is|has|can|should)/.test(exp.name) && exp.name.length < 6) continue;

      let usedElsewhere = false;
      const regex = new RegExp('\\b' + exp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');

      for (const otherFile of allFiles) {
        if (otherFile === fullPath) continue;
        try {
          const content = fs.readFileSync(otherFile, 'utf8');
          if (regex.test(content)) { usedElsewhere = true; break; }
        } catch {}
      }

      if (!usedElsewhere) {
        // Check if used within same file (private helper)
        try {
          const selfContent = fs.readFileSync(fullPath, 'utf8');
          const occurrences = (selfContent.match(regex) || []).length;
          if (occurrences <= 1) {
            deadCode.push({ file, functionName: exp.name, line: exp.line, reason: 'Not imported or called by any other file' });
          }
        } catch {}
      }
    }
  }

  return deadCode.slice(0, 20);
}

module.exports = { findDeadCode };
