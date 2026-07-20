'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules','dist','build','target','.angular','.git','coverage','__pycache__','.idea','.vscode','e2e','.nx']);
const MAX_FILES = 500;

function detectProjectType(repoPath) {
  if (fs.existsSync(path.join(repoPath, 'angular.json'))) return 'angular';
  if (fs.existsSync(path.join(repoPath, 'pom.xml'))) return 'springboot';
  const pkgPath = path.join(repoPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const c = fs.readFileSync(pkgPath, 'utf8');
      if (c.includes('@angular')) return 'angular';
      if (c.includes('react')) return 'react';
    } catch {}
    return 'node';
  }
  return 'unknown';
}

function getSourceFiles(dir, files = [], depth = 0) {
  if (depth > 10 || files.length >= MAX_FILES) return files;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (files.length >= MAX_FILES) break;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) getSourceFiles(path.join(dir, e.name), files, depth + 1);
      } else if (/\.(ts|js|tsx|jsx|java|py|go|kt)$/.test(e.name) && !e.name.includes('.spec.') && !e.name.includes('.test.')) {
        files.push(path.join(dir, e.name));
      }
    }
  } catch {}
  return files;
}

function discoverModules(repoPath, projectType) {
  const modules = [];
  const srcPath = path.join(repoPath, 'src');
  const searchPath = fs.existsSync(srcPath) ? srcPath : repoPath;
  const files = getSourceFiles(searchPath);
  for (const f of files.slice(0, 200)) {
    const rel = path.relative(repoPath, f).replace(/\\/g, '/');
    const name = path.basename(f).replace(/\.(ts|js|java|tsx|jsx|py)$/, '');
    let type = 'FILE';
    if (name.includes('service') || name.includes('Service')) type = 'SERVICE';
    else if (name.includes('component')) type = 'COMPONENT';
    else if (name.includes('module')) type = 'MODULE';
    else if (name.includes('Controller')) type = 'CONTROLLER';
    modules.push({ name, filePath: rel, type });
  }
  return modules;
}

function getModuleName(filePath) {
  const name = path.basename(filePath);
  return name.replace(/\.(ts|js|java|tsx|jsx|py)$/, '');
}

function toClassName(moduleName) {
  if (!moduleName) return null;
  return moduleName.split(/[-.]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function contentCallsFunction(content, funcName) {
  if (!funcName || funcName.length < 3) return false;
  const regex = new RegExp('\\b' + funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
  return regex.test(content);
}

function importsModule(content, moduleName) {
  if (!content.includes(moduleName)) return false;
  const importRegex = new RegExp(`(?:import|from)\\s*.*['"].*${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*['"]`);
  if (importRegex.test(content)) return true;
  const className = toClassName(moduleName);
  if (className && content.includes(className)) return true;
  return false;
}

function extractExportedMethods(filePath) {
  const methods = [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const KEYWORDS = new Set(['if','else','for','while','switch','return','new','class','interface','import','export','from','const','let','var','function','constructor','super','this']);
    for (const line of lines) {
      const t = line.trim();
      let m;
      if (/\.(ts|js|tsx|jsx)$/.test(filePath)) {
        m = /^(?:public\s+|protected\s+)?(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/.exec(t);
        if (m && !KEYWORDS.has(m[1])) { methods.push(m[1]); continue; }
        m = /^export\s+(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/.exec(t);
        if (m) { methods.push(m[1]); continue; }
        m = /^export\s+(?:const|let)\s+([a-zA-Z_$][\w$]*)\s*=/.exec(t);
        if (m) { methods.push(m[1]); continue; }
      } else if (filePath.endsWith('.java')) {
        m = /^(?:public|protected)\s+(?:static\s+)?[\w<>\[\]]+\s+(\w+)\s*\(/.exec(t);
        if (m) methods.push(m[1]);
      }
    }
  } catch {}
  return [...new Set(methods)];
}

function findImpactedModules(repoPath, changedFiles, detailedChanges) {
  const impacted = [];
  const added = new Set();

  // Build map: file -> changed functions
  const changedFuncsByFile = {};
  for (const change of detailedChanges) {
    const funcs = change.functionsChanged.map(f => f.functionName).filter(f => f && f.length > 2);
    if (funcs.length) changedFuncsByFile[change.filePath] = funcs;
  }

  // Get all exported methods from changed files
  const exportedByFile = {};
  for (const file of changedFiles) {
    const fullPath = path.join(repoPath, file);
    if (fs.existsSync(fullPath) && /\.(ts|js|tsx|jsx|java|py)$/.test(file)) {
      const methods = extractExportedMethods(fullPath);
      if (methods.length) exportedByFile[file] = methods;
    }
  }

  // Scan all source files for imports
  const allFiles = getSourceFiles(repoPath);
  for (const srcFile of allFiles) {
    const rel = path.relative(repoPath, srcFile).replace(/\\/g, '/');
    if (changedFiles.includes(rel)) continue;

    let content;
    try { content = fs.readFileSync(srcFile, 'utf8'); } catch { continue; }

    for (const changedFile of changedFiles) {
      const changedModule = getModuleName(changedFile);
      if (changedModule.length < 3) continue;
      if (!importsModule(content, changedModule)) continue;

      const key = rel + '|' + changedModule;
      if (added.has(key)) continue;
      added.add(key);

      const changedFuncs = changedFuncsByFile[changedFile] || [];
      const allMethods = exportedByFile[changedFile] || [];

      // Find which changed functions are called
      const usedFunctions = changedFuncs.filter(f => contentCallsFunction(content, f));
      const allUsedMethods = allMethods.filter(f => contentCallsFunction(content, f));

      let impactLevel;
      if (usedFunctions.length > 0) impactLevel = 'CRITICAL';
      else if (allUsedMethods.length > 0 && changedFuncs.length > 0) impactLevel = 'HIGH';
      else impactLevel = 'MEDIUM';

      // Detect usage context
      let usageContext = 'IMPORT_USAGE';
      const className = toClassName(changedModule);
      if (className && content.includes('private') && content.includes(className)) usageContext = 'INJECTED_SERVICE';
      else if (rel.endsWith('.component.ts') && content.includes('template')) usageContext = 'TEMPLATE_BINDING';

      impacted.push({
        filePath: rel,
        moduleName: getModuleName(rel),
        dependsOn: changedModule,
        impactLevel,
        usedFunctions: usedFunctions.length ? usedFunctions : allUsedMethods,
        usageContext
      });
    }
  }

  // Sort: CRITICAL > HIGH > MEDIUM
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
  impacted.sort((a, b) => (order[a.impactLevel] || 3) - (order[b.impactLevel] || 3));
  return impacted;
}

module.exports = { detectProjectType, discoverModules, findImpactedModules, getModuleName };
