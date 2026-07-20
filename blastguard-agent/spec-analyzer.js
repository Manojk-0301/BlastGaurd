'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules','dist','build','target','.angular','.git','coverage']);

/**
 * Spec File Analyzer v2: Reads actual test files, extracts test cases,
 * and predicts which will FAIL based on your code changes.
 * 
 * Enhanced detection:
 * - Function-level changes (calls, spies, mocks)
 * - Property/value changes (arrays, constants, config values)
 * - Hardcoded assertion values that match old diff values
 * - Test name keyword matching (e.g., "paginated" matches pagination changes)
 * - Return value shape changes
 */
function analyzeSpecs(repoPath, changedFiles, detailedChanges, impactedModules) {
  // Build comprehensive change context
  const changedFunctions = new Set();
  const changedProperties = new Set();
  const changedModules = new Set();
  const diffContext = []; // { removed, added, context } from diffs
  const removedValues = new Set(); // specific old values from diffs
  const addedValues = new Set();

  for (const change of detailedChanges) {
    const modName = path.basename(change.filePath).replace(/\.(ts|js|java|tsx|jsx)$/, '');
    changedModules.add(modName);

    for (const f of change.functionsChanged) {
      if (f.functionName) changedFunctions.add(f.functionName);
    }

    // Only add actual property names detected from the diff (not extracted keywords)
    for (const p of (change.propertiesChanged || [])) {
      if (p && p.length > 5) changedProperties.add(p);
    }

    // Extract values from diff summaries (the key insight for your case)
    for (const diff of (change.diffSummaries || [])) {
      diffContext.push(diff);

      // Extract numbers, strings, array values from removed/added lines
      if (diff.removed) {
        extractValues(diff.removed).forEach(v => removedValues.add(v));
      }
      if (diff.added) {
        extractValues(diff.added).forEach(v => addedValues.add(v));
      }
    }
  }

  // Also add from impacted CRITICAL modules
  for (const m of (impactedModules || []).filter(m => m.impactLevel === 'CRITICAL')) {
    changedModules.add(m.moduleName);
    for (const f of (m.usedFunctions || [])) changedFunctions.add(f);
  }

  // Build change fingerprint for smarter matching
  const changeFingerprint = {
    changedFunctions,
    changedProperties,
    changedModules,
    diffContext,
    removedValues,
    addedValues
  };

  // Find all relevant spec files
  const specFiles = findRelevantSpecs(repoPath, changedFiles, changedModules);
  const results = [];

  for (const specFile of specFiles) {
    let content;
    try { content = fs.readFileSync(specFile, 'utf8'); } catch { continue; }

    const relPath = path.relative(repoPath, specFile).replace(/\\/g, '/');
    const testCases = parseTestCases(content);
    const specImports = parseImports(content);
    const mockedFunctions = parseMocks(content);
    const spiedFunctions = parseSpies(content);

    // Determine which changed module this spec tests
    const testedModule = detectTestedModule(specImports, changedModules);

    // Is this a DIRECT spec for a changed file?
    const isDirectSpec = changedFiles.some(f => {
      const base = path.basename(f).replace(/\.(ts|js|java|tsx|jsx)$/, '');
      return relPath.includes(base + '.spec') || relPath.includes(base + '.test');
    });

    // Analyze each test case
    const analyzedCases = [];
    for (const tc of testCases) {
      const prediction = predictTestOutcome(tc, changeFingerprint, mockedFunctions, spiedFunctions, isDirectSpec);
      analyzedCases.push({
        describe: tc.describe,
        testName: tc.name,
        line: tc.line,
        prediction: prediction.status,
        reason: prediction.reason,
        affectedBy: prediction.affectedBy
      });
    }

    const failCount = analyzedCases.filter(t => t.prediction === 'LIKELY_FAIL').length;
    const riskCount = analyzedCases.filter(t => t.prediction === 'AT_RISK').length;
    const safeCount = analyzedCases.filter(t => t.prediction === 'PROBABLY_SAFE').length;

    results.push({
      specFile: relPath,
      testedModule,
      totalTests: testCases.length,
      summary: { likelyFail: failCount, atRisk: riskCount, safe: safeCount },
      overallStatus: failCount > 0 ? 'FAILING' : riskCount > 0 ? 'AT_RISK' : 'SAFE',
      testCases: analyzedCases,
      mockedFunctions: [...mockedFunctions],
      spiedFunctions: [...spiedFunctions]
    });
  }

  // Sort: FAILING first
  const order = { FAILING: 0, AT_RISK: 1, SAFE: 2 };
  results.sort((a, b) => (order[a.overallStatus] || 2) - (order[b.overallStatus] || 2));

  return {
    specResults: results,
    totalSpecs: results.length,
    totalTests: results.reduce((s, r) => s + r.totalTests, 0),
    totalLikelyFail: results.reduce((s, r) => s + r.summary.likelyFail, 0),
    totalAtRisk: results.reduce((s, r) => s + r.summary.atRisk, 0),
    totalSafe: results.reduce((s, r) => s + r.summary.safe, 0)
  };
}

/**
 * Extract numeric and string values from a diff line.
 * e.g., "[10, 20, 30, 40, 50]" → ['10','20','30','40','50']
 * e.g., "label: '10 Items per page'" → ['10 Items per page']
 */
function extractValues(line) {
  const values = new Set();
  // Numbers
  const nums = line.match(/\b\d+\b/g);
  if (nums) nums.forEach(n => values.add(n));
  // String literals
  const strings = line.match(/['"]([^'"]{2,})['"]/g);
  if (strings) strings.forEach(s => values.add(s.replace(/['"]/g, '')));
  // Array contents
  const arrMatch = /\[([^\]]+)\]/.exec(line);
  if (arrMatch) {
    arrMatch[1].split(',').forEach(v => {
      const trimmed = v.trim().replace(/['"]/g, '');
      if (trimmed) values.add(trimmed);
    });
  }
  return values;
}

/**
 * Extract meaningful keywords from a diff context/line
 * e.g., "getPaginatedData" → ['paginated', 'paginat', 'getData']
 * e.g., "pageSizeOptions" → ['pageSize', 'options', 'page', 'size']
 */
function extractKeywords(text) {
  if (!text) return new Set();
  const keywords = new Set();
  // Split camelCase/PascalCase
  const parts = text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[^a-zA-Z]/g, ' ').split(/\s+/).filter(p => p.length > 3);
  parts.forEach(p => keywords.add(p.toLowerCase()));
  // Also add the full name
  const cleaned = text.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (cleaned.length > 3) keywords.add(cleaned);
  return keywords;
}

/**
 * ENHANCED prediction: checks functions, properties, values, and test name keywords
 */
function predictTestOutcome(testCase, fingerprint, fileMocks, fileSpies, isDirectSpec) {
  const { calledFunctions, usedMocks, expects, body, name } = testCase;
  const { changedFunctions, changedProperties, changedModules, diffContext, removedValues, addedValues } = fingerprint;
  const bodyText = body || '';
  const testNameLower = (name || '').toLowerCase();

  // ═══════════════════════════════════════════════════════
  // CHECK 1: Test directly calls a changed function
  // Distinguish between tests asserting specific values (LIKELY_FAIL)
  // vs edge-case tests with empty/boundary assertions (AT_RISK)
  // ═══════════════════════════════════════════════════════
  const directCalls = calledFunctions.filter(f => changedFunctions.has(f));
  if (directCalls.length > 0) {
    // Check if this test asserts specific non-trivial values (likely to break)
    const hasSpecificValueAssertions = expects.some(e => {
      const val = e.expected.replace(/['"]/g, '').trim();
      // Non-trivial: asserts a number > 0, a specific string, or a specific object
      return (val.match(/^\d+$/) && parseInt(val) > 0) ||
             (val.length > 2 && val !== 'true' && val !== 'false' && val !== 'null' && val !== 'undefined');
    });
    // Check if test uses empty arrays or boundary inputs (edge case test)
    const isEdgeCaseTest = bodyText.includes('[]') && expects.some(e =>
      e.expected === '[]' || e.expected === '0' || e.matcher === 'toEqual' && e.expected.trim() === '[]'
    );
    if (hasSpecificValueAssertions && !isEdgeCaseTest) {
      return {
        status: 'LIKELY_FAIL',
        reason: `Directly calls modified function(s): ${directCalls.join(', ')} — asserts specific values that may differ`,
        affectedBy: directCalls
      };
    }
    return {
      status: 'AT_RISK',
      reason: `Calls modified function(s): ${directCalls.join(', ')} — edge case/boundary test, may still pass`,
      affectedBy: directCalls
    };
  }

  // ═══════════════════════════════════════════════════════
  // CHECK 2: Test has spy/mock on a changed function
  // ═══════════════════════════════════════════════════════
  const mockedChanged = usedMocks.filter(f => changedFunctions.has(f));
  if (mockedChanged.length > 0) {
    return {
      status: 'LIKELY_FAIL',
      reason: `Mocks/spies on modified function(s): ${mockedChanged.join(', ')} — mock return value may not match new behavior`,
      affectedBy: mockedChanged
    };
  }

  // ═══════════════════════════════════════════════════════
  // CHECK 3: Test assertions contain OLD values from diff
  // This catches: expect(result.length).toBe(6) when you changed array from 5 items to 3
  // ═══════════════════════════════════════════════════════
  if (removedValues.size > 0 && isDirectSpec) {
    for (const exp of expects) {
      const expectedVal = exp.expected.replace(/['"]/g, '').trim();
      if (removedValues.has(expectedVal)) {
        return {
          status: 'LIKELY_FAIL',
          reason: `Assertion expects '${expectedVal}' which was the OLD value (now changed in your diff)`,
          affectedBy: ['value: ' + expectedVal]
        };
      }
    }
    // Also check hardcoded values in the test body against removed values
    for (const oldVal of removedValues) {
      if (oldVal.length >= 2 && bodyText.includes(oldVal) && !addedValues.has(oldVal)) {
        // Check if it's in an expect or assertion context
        if (bodyText.includes(`toEqual`) || bodyText.includes(`toBe`) || bodyText.includes(`toContain`)) {
          const inExpect = new RegExp(`(?:toEqual|toBe|toContain|toHaveBeenCalledWith)\\s*\\([^)]*${escapeRegex(oldVal)}`).test(bodyText);
          if (inExpect) {
            return {
              status: 'LIKELY_FAIL',
              reason: `Test asserts old value '${oldVal}' which was removed in your change`,
              affectedBy: ['old value: ' + oldVal]
            };
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // CHECK 4: Test name matches changed property/function names (exact or strong partial)
  // e.g., test "should get paginated data" + you changed getPaginatedData
  // e.g., test "should get pagination dropdown options" + you changed pageSizeOptions
  // Only match on meaningful property/function names (>5 chars), not generic keywords
  // ═══════════════════════════════════════════════════════
  if (isDirectSpec) {
    // Check against actual changed function names
    for (const func of changedFunctions) {
      if (func.length < 5) continue;
      // Convert function name to test-friendly form: getPaginatedData -> "paginated data"
      const funcWords = func.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      const funcKeywords = funcWords.split(/\s+/).filter(w => w.length > 4);
      const matchCount = funcKeywords.filter(kw => testNameLower.includes(kw)).length;
      if (matchCount > 0 && matchCount >= Math.ceil(funcKeywords.length / 2)) {
        return {
          status: 'LIKELY_FAIL',
          reason: `Test name matches modified function '${func}' — assertions likely use old behavior`,
          affectedBy: [func]
        };
      }
    }
    // Check against actual changed property names (must be specific, >7 chars)
    for (const prop of changedProperties) {
      if (prop.length < 7) continue;
      const propWords = prop.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      const propKeywords = propWords.split(/\s+/).filter(w => w.length > 4);
      const matchCount = propKeywords.filter(kw => testNameLower.includes(kw)).length;
      if (matchCount > 0 && matchCount >= Math.ceil(propKeywords.length / 2)) {
        return {
          status: 'LIKELY_FAIL',
          reason: `Test name matches changed property '${prop}' — assertions likely use old values`,
          affectedBy: [prop]
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // CHECK 5: Test body ASSERTS ON or DIRECTLY ACCESSES changed property (direct spec)
  // Only flag if the test has expect() that references the property, or calls a getter for it
  // ═══════════════════════════════════════════════════════
  if (isDirectSpec && changedProperties.size > 0) {
    for (const prop of changedProperties) {
      if (prop.length < 5) continue; // Skip short/generic names like 'page', 'size', 'service'
      // Must be a specific property name (e.g., 'pageSizeOptions', 'getPaginatedData')
      // Check if test body has an assertion that directly references this property
      const propAccessPattern = new RegExp(`(?:service|component|this)\\s*\\.\\s*${escapeRegex(prop)}`, 'i');
      const expectPattern = new RegExp(`expect\\s*\\([^)]*${escapeRegex(prop)}`, 'i');
      if (propAccessPattern.test(bodyText) && (expectPattern.test(bodyText) || bodyText.includes('toEqual') || bodyText.includes('toBe'))) {
        return {
          status: 'LIKELY_FAIL',
          reason: `Test directly asserts on changed property '${prop}'`,
          affectedBy: [prop]
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // CHECK 6: Diff context keywords match test name
  // e.g., diff context "getPaginatedData()" + test "should get paginated data"
  // ═══════════════════════════════════════════════════════
  if (isDirectSpec) {
    for (const diff of diffContext) {
      const ctxKeywords = extractKeywords(diff.context);
      for (const kw of ctxKeywords) {
        if (kw.length > 4 && testNameLower.includes(kw)) {
          // Strong match: test name contains a keyword from the changed function/context
          const hasHardcodedValues = expects.some(e => {
            const val = e.expected.replace(/['"]/g, '').trim();
            return removedValues.has(val) || (val.match(/^\d+$/) && removedValues.has(val));
          });
          if (hasHardcodedValues) {
            return {
              status: 'LIKELY_FAIL',
              reason: `Test '${name}' matches diff context '${diff.context}' and has hardcoded assertions with old values`,
              affectedBy: [diff.context]
            };
          }
          return {
            status: 'AT_RISK',
            reason: `Test name matches diff context keyword '${kw}' from '${diff.context}'`,
            affectedBy: [diff.context]
          };
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // CHECK 7: File-level mocks on changed functions
  // ═══════════════════════════════════════════════════════
  const fileLevelMockHit = [...fileMocks].filter(f => changedFunctions.has(f));
  if (fileLevelMockHit.length > 0) {
    return {
      status: 'AT_RISK',
      reason: `File-level mock on '${fileLevelMockHit.join(', ')}' — may mask failures or need mock update`,
      affectedBy: fileLevelMockHit
    };
  }

  // ═══════════════════════════════════════════════════════
  // CHECK 8: Test body references a changed module (non-direct spec)
  // ═══════════════════════════════════════════════════════
  if (!isDirectSpec) {
    for (const mod of changedModules) {
      if (mod.length > 3 && bodyText.includes(mod)) {
        return {
          status: 'AT_RISK',
          reason: `References changed module '${mod}' — behavior may differ`,
          affectedBy: [mod]
        };
      }
    }
  }

  return {
    status: 'PROBABLY_SAFE',
    reason: 'No direct dependency on changed code detected',
    affectedBy: []
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════
// PARSING HELPERS
// ═══════════════════════════════════════════════════════

function parseTestCases(content) {
  const tests = [];
  const lines = content.split('\n');
  let currentDescribe = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const descMatch = /(?:describe|fdescribe|xdescribe)\s*\(\s*['"`](.+?)['"`]/.exec(line);
    if (descMatch) currentDescribe = descMatch[1];

    const itMatch = /(?:it|test|fit|xit)\s*\(\s*['"`](.+?)['"`]/.exec(line);
    if (itMatch) {
      const body = collectTestBody(lines, i);
      tests.push({
        describe: currentDescribe,
        name: itMatch[1],
        line: i + 1,
        body,
        expects: extractExpects(body),
        calledFunctions: extractCalledFunctions(body),
        usedMocks: extractUsedMocks(body)
      });
    }
  }
  return tests;
}

function collectTestBody(lines, startLine) {
  let braceCount = 0, started = false;
  const body = [];
  for (let i = startLine; i < Math.min(startLine + 50, lines.length); i++) {
    const line = lines[i];
    body.push(line);
    braceCount += (line.match(/{/g) || []).length;
    braceCount -= (line.match(/}/g) || []).length;
    if (line.includes('{')) started = true;
    if (started && braceCount <= 0) break;
  }
  return body.join('\n');
}

function extractExpects(body) {
  const expects = [];
  const regex = /expect\s*\(([^)]+)\)\s*\.(\w+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    expects.push({ subject: match[1].trim(), matcher: match[2], expected: match[3].trim() });
  }
  return expects;
}

function extractCalledFunctions(body) {
  const funcs = new Set();
  const regex = /(?:\w+)\.([a-zA-Z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    if (!isTestKeyword(match[1])) funcs.add(match[1]);
  }
  return [...funcs];
}

function extractUsedMocks(body) {
  const mocks = new Set();
  const spyRegex = /spyOn\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*\)/g;
  let match;
  while ((match = spyRegex.exec(body)) !== null) mocks.add(match[1]);
  const jestSpyRegex = /jest\.spyOn\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*\)/g;
  while ((match = jestSpyRegex.exec(body)) !== null) mocks.add(match[1]);
  return [...mocks];
}

function parseImports(content) {
  const imports = new Set();
  const regex = /import\s+.*from\s+['"](.+?)['"]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const imp = match[1];
    if (imp.startsWith('.') || imp.startsWith('@')) {
      imports.add(path.basename(imp).replace(/\.(ts|js)$/, ''));
    }
  }
  return imports;
}

function parseMocks(content) {
  const mocks = new Set();
  const regex = /spyOn\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) mocks.add(match[1]);
  const jestFn = /(\w+)\s*[:=]\s*jest\.fn\(\)/g;
  while ((match = jestFn.exec(content)) !== null) mocks.add(match[1]);
  return mocks;
}

function parseSpies(content) {
  const spies = new Set();
  const regex = /spyOn\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) spies.add(match[1]);
  return spies;
}

function detectTestedModule(specImports, changedModules) {
  for (const imp of specImports) {
    if (changedModules.has(imp)) return imp;
  }
  return null;
}

function findRelevantSpecs(repoPath, changedFiles, changedModules) {
  const specs = new Set();
  for (const file of changedFiles) {
    const ext = path.extname(file);
    const base = file.replace(ext, '');
    for (const v of [base + '.spec' + ext, base + '.test' + ext, base + '.spec.ts', base + '.test.ts']) {
      const full = path.join(repoPath, v);
      if (fs.existsSync(full)) specs.add(full);
    }
  }
  const allSpecs = findAllSpecFiles(repoPath);
  for (const specFile of allSpecs) {
    if (specs.has(specFile)) continue;
    try {
      const content = fs.readFileSync(specFile, 'utf8');
      for (const mod of changedModules) {
        if (mod.length > 3 && content.includes(mod)) { specs.add(specFile); break; }
      }
    } catch {}
  }
  return [...specs].slice(0, 30);
}

function findAllSpecFiles(dir, files = [], depth = 0) {
  if (depth > 8 || files.length >= 300) return files;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (files.length >= 300) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) findAllSpecFiles(full, files, depth + 1);
      else if (e.isFile() && (/\.spec\.(ts|js|tsx|jsx)$/.test(e.name) || /\.test\.(ts|js|tsx|jsx)$/.test(e.name))) files.push(full);
    }
  } catch {}
  return files;
}

function isTestKeyword(name) {
  return ['describe','it','test','expect','beforeEach','afterEach','beforeAll','afterAll','fit','xit','fdescribe','xdescribe','spyOn','jasmine','jest','toBe','toEqual','toContain','toHaveBeenCalled'].includes(name);
}

module.exports = { analyzeSpecs };
