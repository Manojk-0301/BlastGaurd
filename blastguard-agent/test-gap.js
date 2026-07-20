'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules','dist','build','target','.angular','.git','coverage','__pycache__','.idea','.vscode','e2e','.nx']);
const LIFECYCLE_HOOKS = new Set(['ngOnInit','ngOnDestroy','ngAfterViewInit','ngOnChanges','ngDoCheck','ngAfterContentInit','ngAfterContentChecked','ngAfterViewChecked','constructor']);

function analyzeTestGaps(repoPath, changedFiles, impactedModules) {
  const gaps = [];

  // Get all source files to check (changed + impacted)
  const filesToCheck = new Set(changedFiles);
  for (const m of (impactedModules || [])) {
    if (m.filePath) filesToCheck.add(m.filePath);
  }

  // Find all spec files
  const specFiles = findSpecFiles(repoPath);
  const specContents = {};
  for (const spec of specFiles) {
    try { specContents[spec] = fs.readFileSync(spec, 'utf8'); } catch {}
  }
  const allSpecContent = Object.values(specContents).join('\n');

  for (const file of filesToCheck) {
    if (file.includes('.spec.') || file.includes('.test.')) continue;
    if (!/\.(ts|js|tsx|jsx)$/.test(file)) continue;

    const fullPath = path.join(repoPath, file);
    if (!fs.existsSync(fullPath)) continue;

    const functions = extractFunctions(fullPath);
    if (!functions.length) continue;

    // Find corresponding spec file
    const specFile = findMatchingSpec(fullPath, specFiles);
    const specContent = specFile ? (specContents[specFile] || '') : '';

    const untestedFuncs = [];
    const testedFuncs = [];

    for (const func of functions) {
      if (LIFECYCLE_HOOKS.has(func.name)) continue;
      if (func.name.length < 3) continue;

      const regex = new RegExp('\\b' + func.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      const testedInOwnSpec = specContent && regex.test(specContent);
      const testedAnywhere = regex.test(allSpecContent);

      if (!testedInOwnSpec && !testedAnywhere) {
        untestedFuncs.push(func);
      } else {
        testedFuncs.push(func);
      }
    }

    if (untestedFuncs.length > 0) {
      gaps.push({
        file,
        specExists: !!specFile,
        totalFunctions: functions.length,
        testedCount: testedFuncs.length,
        untestedCount: untestedFuncs.length,
        coveragePercent: Math.round((testedFuncs.length / functions.length) * 100),
        untestedFunctions: untestedFuncs.slice(0, 10)
      });
    }
  }

  // Sort by most untested first
  gaps.sort((a, b) => b.untestedCount - a.untestedCount);

  return {
    totalFilesAnalyzed: filesToCheck.size,
    filesWithGaps: gaps.length,
    totalUntested: gaps.reduce((s, g) => s + g.untestedCount, 0),
    gaps: gaps.slice(0, 15)
  };
}

function extractFunctions(filePath) {
  const functions = [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const KEYWORDS = new Set(['if','else','for','while','switch','return','new','class','interface','import','export','from','const','let','var','function','super','this']);

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      let m;
      m = /^(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/.exec(t);
      if (m && !KEYWORDS.has(m[1])) { functions.push({ name: m[1], line: i + 1 }); continue; }
      m = /^export\s+(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/.exec(t);
      if (m) { functions.push({ name: m[1], line: i + 1 }); continue; }
    }
  } catch {}
  return [...new Map(functions.map(f => [f.name, f])).values()];
}

function findSpecFiles(repoPath, files = [], depth = 0) {
  const srcPath = path.join(repoPath, 'src');
  const searchPath = fs.existsSync(srcPath) ? srcPath : repoPath;
  return _findSpecs(searchPath, files, depth);
}

function _findSpecs(dir, files, depth) {
  if (depth > 10 || files.length >= 300) return files;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (files.length >= 300) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) _findSpecs(full, files, depth + 1);
      else if (e.isFile() && (/\.spec\.(ts|js)$/.test(e.name) || /\.test\.(ts|js)$/.test(e.name))) files.push(full);
    }
  } catch {}
  return files;
}

function findMatchingSpec(filePath, specFiles) {
  const baseName = path.basename(filePath).replace(/\.(ts|js|tsx|jsx)$/, '');
  return specFiles.find(s => path.basename(s).includes(baseName));
}

module.exports = { analyzeTestGaps };
