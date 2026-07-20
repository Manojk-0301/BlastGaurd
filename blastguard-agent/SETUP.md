# BlastGuard Agent — Setup & Usage Guide

## What is BlastGuard?

BlastGuard is an offline, zero-dependency code impact analysis tool that runs locally before you merge. It tells you:
- What modules will break from your changes
- Which tests will fail
- Who to notify before merging
- Whether it's safe to merge or not

No AI tokens, no API calls (except optional Jira), no data leaves your machine.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 20.x or higher |
| Git | Any recent version |
| OS | Windows / macOS / Linux |

---

## Installation

### Step 1: Clone BlastGuard into your project

Open Git Bash (or any terminal) in your project root and run:

```bash
git clone https://github.disney.com/WDPR-RA/blastguard-agent.git
```

Your project structure should look like:

```
your-project/
├── src/
├── blastguard-agent/    ← cloned repo
├── package.json
└── ...
```

> **Tip:** If you want a specific version, use `git clone --branch v1.0.0 https://github.disney.com/WDPR-RA/blastguard-agent.git`

### Step 2: Add to .gitignore

Add these lines to your project's `.gitignore`:

```
blastguard-agent/
blastguard-reports/
```

This prevents the cloned agent and its output from being committed to your project repo.

### Step 3: Install (no dependencies needed)

BlastGuard has zero external dependencies — no `npm install` required. Just clone and run.

### Step 3: (Optional) Jira Integration

Add these lines to your `.env` file for Jira ticket validation:

```env
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_TOKEN=your-api-token
```

To get an API token: https://id.atlassian.com/manage-profile/security/api-tokens

If you don't configure Jira, the agent will ask for a ticket ID in the terminal (or you can skip it).

---

## Usage

### Basic Command

```bash
node blastguard-agent/index.js --repo . --branch origin/develop
```

### Command Options

| Flag | Description | Default |
|------|-------------|---------|
| `--repo` | Path to your repository | Current directory |
| `--branch` | Base branch to compare against | `origin/develop` |
| `--output` | Output directory for reports | `./blastguard-reports` |
| `--jira` | Jira ticket ID (optional) | Auto-detected |

### Examples

```bash
# Compare against develop
node blastguard-agent/index.js --repo . --branch origin/develop

# Compare against main
node blastguard-agent/index.js --repo . --branch origin/main

# Specify Jira ticket manually
node blastguard-agent/index.js --repo . --branch origin/develop --jira PROJ-123

# Custom output directory
node blastguard-agent/index.js --repo . --branch origin/develop --output ./my-reports
```

---

## What It Analyzes (14 Steps)

| Step | Analysis | What it does |
|------|----------|--------------|
| 1 | Project Detection | Detects Angular, React, Node, Spring Boot, etc. |
| 2 | Changed Files | Scans git diff for modified files |
| 3 | Module Discovery | Finds all modules/components in the project |
| 4 | Impact Analysis | Identifies which modules depend on your changed code |
| 5 | Team Ownership | Finds who last worked on affected files |
| 6 | File Health | Checks churn rate, bug-fix history |
| 7 | Anti-Patterns | Detects secrets, god functions, console.logs, any types |
| 8 | Test Mapping | Suggests which test files to run |
| 9 | Spec Analysis | Predicts which specific tests will fail |
| 10 | Dead Code | Finds unused functions in changed files |
| 11 | Test Gaps | Finds functions with no test coverage |
| 12 | Risk Calculation | Scores risk 0-100 with verdict |
| 13 | Fix Suggestions | Generates auto-fix recommendations |
| 14 | Jira Validation | Validates code against ticket acceptance criteria |

---

## Output Files

After running, you'll find these in `blastguard-reports/`:

| File | Description |
|------|-------------|
| `BlastGuard_Report-YYYY-MM-DD_HH-MM-SS.html` | Full HTML dashboard with all analysis |
| `PR_Summary-YYYY-MM-DD_HH-MM-SS.md` | Ready-to-paste PR description |
| `Test_Summary-YYYY-MM-DD_HH-MM-SS.md` | Test predictions, gaps, and suggested commands |
| `Risk_Trend-YYYY-MM-DD_HH-MM-SS.html` | Risk score history over time (sprint view) |
| `checklist_branch-name.json` | Pre-merge checklist (JSON for IDE integration) |
| `risk-history.json` | Historical risk data across runs |

Each run overwrites the previous report (only 1 file per type exists at a time).

---

## Understanding the Output

### Verdict

| Verdict | Meaning | Action |
|---------|---------|--------|
| SAFE TO MERGE | Changes are isolated, low risk | Standard code review |
| REVIEW NEEDED | Some modules impacted | Get 1 senior approval |
| NOT SAFE TO MERGE | Shared code breaking change | Coordinate with affected teams |

### Risk Score

| Score | Level | Meaning |
|-------|-------|---------|
| 0-25 | LOW | Isolated change, minimal blast radius |
| 26-50 | MEDIUM | Some dependencies affected |
| 51-75 | HIGH | Multiple modules impacted |
| 76-100 | CRITICAL | Shared service change, many consumers affected |

### Test Predictions

| Status | Meaning |
|--------|---------|
| LIKELY_FAIL | Test directly asserts values you changed — will almost certainly fail |
| AT_RISK | Test uses modified functions but may still pass |
| SAFE | Test is unrelated to your changes |

---

## Jira Ticket Validation

BlastGuard finds the Jira ticket ID from (in priority order):

1. `--jira` CLI flag
2. `.blastguard` config file in repo root (format: `jira=PROJ-123`)
3. Branch name (e.g., `ft-PROJ-123-feature-name`)
4. Recent commit messages containing ticket ID
5. Interactive prompt (asks you in terminal)

If Jira API is configured, it fetches the ticket and validates your code changes against the acceptance criteria. If not configured, you can manually create a cache file:

```
blastguard-reports/.jira-cache/PROJ-123.json
```

```json
{
  "id": "PROJ-123",
  "title": "Ticket title",
  "description": "Full description",
  "acceptanceCriteria": [
    "First acceptance criteria",
    "Second acceptance criteria",
    "Third acceptance criteria"
  ]
}
```

---

## Adding to npm scripts (Optional)

Add to your `package.json`:

```json
{
  "scripts": {
    "blastguard": "node blastguard-agent/index.js --repo . --branch origin/develop",
    "blastguard:main": "node blastguard-agent/index.js --repo . --branch origin/main"
  }
}
```

Then run:

```bash
npm run blastguard
```

---

## Supported Project Types

| Type | Detection |
|------|-----------|
| Angular | `angular.json` present |
| React | `react` in package.json |
| Node.js | `package.json` present |
| Spring Boot | `pom.xml` present |
| Generic | Any git repository |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No changes detected" | Make sure you have uncommitted changes or your branch differs from the base branch |
| "Jira not configured" | Add JIRA_BASE_URL, JIRA_EMAIL, JIRA_TOKEN to `.env` file |
| Report not opening | Open the HTML file directly in browser |
| Wrong base branch | Use `--branch origin/main` or whatever your team's base branch is |
| Permission denied | Make sure you have git access to the repo |

---

## Project Structure

```
blastguard-agent/
├── index.js              # Main entry point (14-step pipeline)
├── git-utils.js          # Git operations (diff, branch, owners)
├── analyzer.js           # Module discovery & impact analysis
├── risk-engine.js        # Risk scoring & verdict
├── spec-analyzer.js      # Test failure predictions
├── report-generator.js   # HTML report generation
├── pr-summary.js         # PR description generation
├── test-summary.js       # Test summary generation
├── checklist.js          # Pre-merge checklist & review time
├── file-health.js        # File churn & health analysis
├── pattern-detector.js   # Anti-pattern scanning
├── test-suggester.js     # Smart test suggestions
├── dead-code.js          # Unused function detection
├── fix-suggester.js      # Auto-fix recommendations
├── risk-history.js       # Sprint risk tracking
├── test-gap.js           # Test coverage gap analysis
├── jira-validator.js     # Jira ticket validation
└── package.json          # Agent metadata
```

---

## FAQ

**Q: Does it modify my code?**
A: No. BlastGuard is read-only. It only analyzes and generates reports.

**Q: Does it need internet?**
A: No (except optional Jira API call which is cached for 24 hours).

**Q: Does it send data anywhere?**
A: No. Everything runs locally on your machine.

**Q: How long does it take?**
A: 10-30 seconds depending on project size.

**Q: Can I use it in CI/CD?**
A: Yes. Run the same command in your pipeline and fail the build if risk score > threshold.

**Q: Does it work with monorepos?**
A: Yes. Point `--repo` to the specific project folder.
