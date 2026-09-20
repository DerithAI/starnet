#!/usr/bin/env node
/**
 * brief.js
 * Generates a BRIEF.md for a GitHub repository by combining:
 * - Repo tree extraction (structure, files, critical paths)
 * - Documentation analysis (README, package.json, contributing guides)
 * - Automated brief synthesis (purpose, structure, setup instructions)
 *
 * Usage: node brief.js <github-url-or-owner/repo>
 * Output: ./BRIEF.md in current directory
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

// ============================================================================
// UTILITIES
// ============================================================================

function log(msg) {
  console.error(`[brief.js] ${msg}`);
}

function fetchHTTPS(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'brief.js' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function parseGitHubUrl(input) {
  // Handle: https://github.com/owner/repo, owner/repo, etc.
  let match = input.match(/github\.com[\/:]([\w-]+)\/([\w.-]+)/);
  if (match) return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
  
  match = input.match(/^([\w-]+)\/([\w.-]+)$/);
  if (match) return { owner: match[1], repo: match[2] };
  
  throw new Error(`Invalid GitHub URL or owner/repo: ${input}`);
}

function extractTreeSync(dir, maxDepth = 3, currentDepth = 0, ignore = new Set()) {
  if (currentDepth >= maxDepth) return {};
  
  const tree = {};
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (ignore.has(entry)) continue;
      
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        tree[entry] = extractTreeSync(fullPath, maxDepth, currentDepth + 1, ignore);
      } else {
        tree[entry] = { size: stat.size };
      }
    }
  } catch (e) {
    // Permission denied or other error
  }
  return tree;
}

function treeToMarkdown(tree, indent = '') {
  const lines = [];
  const entries = Object.entries(tree);
  
  for (const [name, info] of entries) {
    if (typeof info === 'object' && info.size !== undefined) {
      lines.push(`${indent}├── ${name} (${info.size} bytes)`);
    } else if (typeof info === 'object') {
      lines.push(`${indent}├── ${name}/`);
      lines.push(treeToMarkdown(info, indent + '│   '));
    }
  }
  
  return lines.join('\n');
}

function sanitizeMarkdown(text) {
  if (!text) return '';
  return text.replace(/\r\n/g, '\n').trim();
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node brief.js <github-url-or-owner/repo>');
    console.log('Example: node brief.js facebook/react');
    process.exit(1);
  }
  
  const input = args[0];
  let owner, repo;
  
  try {
    ({ owner, repo } = parseGitHubUrl(input));
  } catch (e) {
    log(`Error parsing GitHub URL: ${e.message}`);
    process.exit(1);
  }
  
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const clonePath = path.join('/tmp', `${owner}_${repo}`);
  
  log(`Target: ${owner}/${repo}`);
  log(`URL: ${repoUrl}`);
  
  // ========================================================================
  // STEP 1: Clone or Fallback to HTTPS Download
  // ========================================================================
  
  let repoData = {
    owner,
    repo,
    url: repoUrl,
    readme: '',
    packageJson: {},
    contributing: '',
    license: '',
    tree: {}
  };
  
  log('Attempting to clone repository...');
  try {
    // Clean up old clone
    if (fs.existsSync(clonePath)) {
      execSync(`rm -rf "${clonePath}"`);
    }
    
    execSync(`git clone --depth 1 "${repoUrl}" "${clonePath}"`, {
      stdio: 'pipe'
    });
    log('Clone successful.');
    
    // Read files from cloned repo
    const readmeFile = path.join(clonePath, 'README.md');
    const pkgFile = path.join(clonePath, 'package.json');
    const contribFile = path.join(clonePath, 'CONTRIBUTING.md');
    const licenseFile = path.join(clonePath, 'LICENSE');
    
    if (fs.existsSync(readmeFile)) {
      repoData.readme = fs.readFileSync(readmeFile, 'utf8');
    }
    if (fs.existsSync(pkgFile)) {
      try {
        repoData.packageJson = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      } catch (e) {
        log(`Warning: Could not parse package.json: ${e.message}`);
      }
    }
    if (fs.existsSync(contribFile)) {
      repoData.contributing = fs.readFileSync(contribFile, 'utf8');
    }
    if (fs.existsSync(licenseFile)) {
      repoData.license = fs.readFileSync(licenseFile, 'utf8').substring(0, 200);
    }
    
    // Extract tree
    repoData.tree = extractTreeSync(clonePath, 2);
    
    // Cleanup
    execSync(`rm -rf "${clonePath}"`);
  } catch (e) {
    log(`Clone failed, falling back to HTTPS download of README and package.json...`);
    
    try {
      const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
      const pkgUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/package.json`;
      
      try {
        repoData.readme = await fetchHTTPS(readmeUrl);
        log('Downloaded README.md via HTTPS');
      } catch (e) {
        log(`Could not fetch README.md: ${e.message}`);
      }
      
      try {
        const pkgText = await fetchHTTPS(pkgUrl);
        repoData.packageJson = JSON.parse(pkgText);
        log('Downloaded package.json via HTTPS');
      } catch (e) {
        log(`Could not fetch package.json: ${e.message}`);
      }
    } catch (e) {
      log(`HTTPS fallback error: ${e.message}`);
    }
  }
  
  // ========================================================================
  // STEP 2: Synthesize BRIEF.md
  // ========================================================================
  
  log('Synthesizing brief...');
  
  const pkg = repoData.packageJson;
  const description = pkg.description || 'No description available';
  const keywords = pkg.keywords ? pkg.keywords.join(', ') : 'N/A';
  const mainFile = pkg.main || 'Not specified';
  const scripts = pkg.scripts ? Object.keys(pkg.scripts).join(', ') : 'None';
  
  // Extract purpose from README or package.json
  let purpose = description;
  const readmeLines = repoData.readme.split('\n');
  for (const line of readmeLines) {
    if (line.trim() && !line.startsWith('#')) {
      purpose = line.substring(0, 150);
      break;
    }
  }
  
  // Build tree markdown
  const treeMarkdown = Object.keys(repoData.tree).length > 0 
    ? treeToMarkdown(repoData.tree)
    : '(Tree extraction unavailable)';
  
  const brief = `# BRIEF: ${owner}/${repo}

## Purpose
${purpose}

## Repository
- **URL**: ${repoUrl}
- **Owner**: ${owner}
- **Repository**: ${repo}

## Package Information
${pkg.name ? `- **Name**: ${pkg.name}` : ''}
${pkg.version ? `- **Version**: ${pkg.version}` : ''}
${pkg.description ? `- **Description**: ${pkg.description}` : ''}
${keywords !== 'N/A' ? `- **Keywords**: ${keywords}` : ''}
${mainFile !== 'Not specified' ? `- **Main Entry**: ${mainFile}` : ''}
${scripts !== 'None' ? `- **Available Scripts**: ${scripts}` : ''}

## Repository Structure
\`\`\`
${treeMarkdown}
\`\`\`

## Setup Instructions
1. Clone the repository: \`git clone ${repoUrl}\`
2. Navigate to directory: \`cd ${repo}\`
${pkg.scripts && pkg.scripts.install ? '3. Install dependencies: \`npm install\`' : ''}

## Additional Resources
${repoData.contributing ? '- **Contributing Guide**: See CONTRIBUTING.md for contribution guidelines' : ''}
${repoData.license ? '- **License**: Project includes LICENSE file' : ''}

## Generated By
Brief.js — Repository brief generator
Generated: ${new Date().toISOString()}
`;
  
  // ========================================================================
  // STEP 3: Write BRIEF.md
  // ========================================================================
  
  const outputPath = path.resolve(process.cwd(), 'BRIEF.md');
  
  try {
    fs.writeFileSync(outputPath, brief, 'utf8');
    log(`Brief written to: ${outputPath}`);
    console.log(`\n✓ BRIEF.md generated successfully at: ${outputPath}`);
    process.exit(0);
  } catch (e) {
    log(`Error writing BRIEF.md: ${e.message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  log(`Fatal error: ${e.message}`);
  process.exit(1);
});