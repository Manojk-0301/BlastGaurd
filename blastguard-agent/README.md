# 🛡️ BlastGuard Agent - Universal Change Impact Analyzer

A **zero-dependency** standalone agent that analyzes your git changes and generates a rich HTML blast radius report — directly in your workspace.

## ✅ Works Everywhere
- **VS Code** (Amazon Q / Kiro)
- **Eclipse**
- **IntelliJ / WebStorm**
- **Terminal / CI/CD**
- Any environment with **Node.js 16+** and **Git**

## 🚀 Quick Start

```bash
# Navigate to any git repo
cd /path/to/your/project

# Run the agent (from this folder)
node /path/to/blastguard-agent/index.js

# Or with options
node /path/to/blastguard-agent/index.js --branch origin/main --output ./reports
```

## 📦 Install in Your Workspace

Copy the `blastguard-agent` folder into your project, then:

```bash
node blastguard-agent/index.js
```

Or install globally:
```bash
cd blastguard-agent
npm link
# Now use from anywhere:
blastguard --repo /path/to/repo --branch origin/develop
```

## ⚙️ Options

| Flag | Default | Description |
|------|---------|-------------|
| `--repo` | Current directory | Path to git repository |
| `--branch` | `origin/develop` | Base branch to compare against |
| `--output` | `./blastguard-reports` | Directory for HTML report output |

## 📊 What It Analyzes

- **Git diff parsing** — files, functions, properties changed
- **Dependency graph** — who imports/uses your changed files
- **Function-level impact** — which modules call your modified functions
- **Risk scoring** — 0-100 score with CRITICAL/HIGH/MEDIUM/LOW levels
- **Merge verdict** — SAFE / REVIEW NEEDED / NOT SAFE TO MERGE
- **Test impact** — which spec files are at risk
- **Team ownership** — who to notify before merge
- **Module rollup** — grouped impact by feature module
- **Recommendations** — actionable steps based on blast radius

## 📄 Output

Generates a self-contained HTML report at:
```
<repo>/blastguard-reports/blastguard_report_<branch>_<id>.html
```

Open in any browser — no server needed.

## 🔧 Supported Project Types

- Angular
- React
- Spring Boot (Java)
- Node.js
- Python
- Go / Kotlin / Rust (basic support)

## 📋 Requirements

- Node.js >= 16
- Git CLI available in PATH
- Must be run inside a git repository (or use `--repo`)
