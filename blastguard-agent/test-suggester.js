'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules','dist','build','target','.angular','.git','coverage']);

/**
 * Smart Test Suggester: Finds which test files should be run based on changes.
 * - Direct spec files for changed files
 * - Spec files that import changed modules
 * - Integration/e2e tests that cover changed routes/features
 */
function suggestTests(repoPath, changedFiles, impactedModules) {
  const suggestions = [];
  const added = new Set();

  // 1. Direct spec/test files for changed files
  for (const file of changedFiles) {
    const specVariants = getSpecVariants(file);
    for (const spec of specVariants) {
      const fullPath = path.join(repoPath, spec);
      if (fs.existsSync(fullPath) && !added.has(spec)) {
        added.add(spec);
        suggestions.push({ file: spec, reason: `Direct test for ${path.basename(file)}`, priority: 'MUST_RUN', command: buildTestCommand(spec, repoPath) });
      }
    }
  }

  // 2. Spec files for CRITICAL impacted modules
  for (const m of (impactedModules || []).filter(m => m.impactLevel === 'CRITICAL')) {
    const specVariants = getSpecVariants(m.filePath);
    for (const spec of specVariants) {
      const fullPath = path.join(repoPath, spec);
      if (fs.existsSync(fullPath) && !added.has(spec)) {
        added.add(spec);
        suggestions.push({ file: spec, reason: `${m.moduleName} calls modified function from ${m.dependsOn}`, priority: 'SHOULD_RUN', command: buildTestCommand(spec, repoPath) });
      }
    }
  }

  // 3. Scan for test files that import changed modules
  const changedModules = changedFiles.map(f => path.basename(f).replace(/\.(ts|js|java|tsx|jsx)$/, ''));
  const testFiles = findTestFiles(repoPath);
  for (const testFile of testFiles) {
    const rel = path.relative(repoPath, testFile).replace(/\\/g, '/');
    if (added.has(rel)) continue;

    try {
      const content = fs.readFileSync(testFile, 'utf8');
      for (const mod of changedModules) {
        if (mod.length < 3) continue;
        if (content.includes(mod)) {
          added.add(rel);
          suggestions.push({ file: rel, reason: `Imports/references ${mod}`, priority: 'SHOULD_RUN', command: buildTestCommand(rel, repoPath) });
          break;
        }
      }
    } catch {}
  }

  // 4. Generate combined run command
  const mustRun = suggestions.filter(s => s.priority === 'MUST_RUN');
  const shouldRun = suggestions.filter(s => s.priority === 'SHOULD_RUN');

  return {
    suggestions: suggestions.slice(0, 20),
    summary: { mustRun: mustRun.length, shouldRun: shouldRun.length, total: suggestions.length },
    combinedCommand: buildCombinedCommand(suggestions.slice(0, 10), repoPath)
  };
}

function getSpecVariants(filePath) {
  const variants = [];
  const ext = path.extname(filePath);
  const base = filePath.replace(ext, '');

  // .spec.ts, .test.ts, .spec.js, .test.js
  variants.push(base + '.spec' + ext);
  variants.push(base + '.test' + ext);
  variants.push(base + '.spec.ts');
  variants.push(base + '.test.ts');
  variants.push(base + '.spec.js');

  // Java: src/test mirror
  if (filePath.includes('src/main/')) {
    variants.push(filePath.replace('src/main/', 'src/test/').replace('.java', 'Test.java'));
  }

  return [...new Set(variants)];
}

function findTestFiles(repoPath, files = [], depth = 0) {
  if (depth > 8 || files.length >= 200) return files;
  try {
    const entries = fs.readdirSync(repoPath, { withFileTypes: true });
    for (const e of entries) {
      if (files.length >= 200) break;
      const full = path.join(repoPath, e.name);
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
        findTestFiles(full, files, depth + 1);
      } else if (e.isFile() && (/\.spec\.(ts|js|tsx|jsx)$/.test(e.name) || /\.test\.(ts|js|tsx|jsx)$/.test(e.name) || /Test\.java$/.test(e.name))) {
        files.push(full);
      }
    }
  } catch {}
  return files;
}

function buildTestCommand(specFile, repoPath) {
  if (specFile.endsWith('.java') || specFile.includes('Test.java')) {
    const className = path.basename(specFile, '.java');
    return `mvn test -Dtest=${className}`;
  }
  const name = path.basename(specFile).replace(/\.(spec|test)\.(ts|js|tsx|jsx)$/, '');
  if (fs.existsSync(path.join(repoPath, 'angular.json'))) {
    return `ng test --include=**/${path.basename(specFile)}`;
  }
  if (fs.existsSync(path.join(repoPath, 'jest.config.js')) || fs.existsSync(path.join(repoPath, 'jest.config.ts'))) {
    return `npx jest --testPathPattern="${name}"`;
  }
  return `npx jest "${name}"`;
}

function buildCombinedCommand(suggestions, repoPath) {
  if (!suggestions.length) return 'No tests to run';
  if (fs.existsSync(path.join(repoPath, 'angular.json'))) {
    const patterns = suggestions.map(s => path.basename(s.file)).join(' ');
    return `ng test --include=${patterns}`;
  }
  const names = suggestions.map(s => path.basename(s.file).replace(/\.(spec|test)\.(ts|js|tsx|jsx)$/, '')).join('|');
  return `npx jest --testPathPattern="(${names})"`;
}

module.exports = { suggestTests };
