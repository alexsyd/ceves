#!/usr/bin/env node
/**
 * ceves-discover - Auto-discovery CLI for the Ceves framework
 *
 * Reads `discover` glob patterns from createRouter() in the entry file,
 * finds matching .ts files containing @Route or @EventHandler decorators,
 * and generates a _discover.generated.ts file with side-effect imports.
 *
 * Usage:
 *   npx ceves-discover
 *   npx ceves-discover --entry src/index.ts
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let entryOverride = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--entry' && args[i + 1]) {
    entryOverride = args[i + 1];
    i++;
  }
}

const cwd = process.cwd();

// Resolve entry file
let entryFile;
if (entryOverride) {
  entryFile = path.resolve(cwd, entryOverride);
} else {
  entryFile = path.resolve(cwd, 'src/index.ts');
}

if (!fs.existsSync(entryFile)) {
  console.error(`[ceves-discover] Entry file not found: ${entryFile}`);
  console.error('  Use --entry <path> to specify a custom entry file.');
  process.exit(1);
}

const entryDir = path.dirname(entryFile);
console.log(`[ceves-discover] Entry file: ${entryFile}`);

// ---------------------------------------------------------------------------
// Extract discover patterns from createRouter() call
// ---------------------------------------------------------------------------

const entryContent = fs.readFileSync(entryFile, 'utf8');

/**
 * Extract the string array literal from `discover: [...]` inside createRouter().
 * Uses a simple regex that handles multi-line arrays.
 */
function extractDiscoverPatterns(source) {
  // Match `discover:` followed by an array literal (possibly multiline)
  // Strategy: find "discover:" then collect characters until balanced ']'
  const discoverIdx = source.indexOf('discover:');
  if (discoverIdx === -1) return null;

  const afterDiscover = source.slice(discoverIdx + 'discover:'.length);

  // Find opening bracket
  const bracketStart = afterDiscover.indexOf('[');
  if (bracketStart === -1) return null;

  // Walk forward to find matching closing bracket
  let depth = 0;
  let end = -1;
  for (let i = bracketStart; i < afterDiscover.length; i++) {
    if (afterDiscover[i] === '[') depth++;
    else if (afterDiscover[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return null;

  const arrayStr = afterDiscover.slice(bracketStart, end + 1);

  // Extract quoted strings from the array literal
  const patterns = [];
  const strRegex = /['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = strRegex.exec(arrayStr)) !== null) {
    patterns.push(match[1]);
  }

  return patterns;
}

const patterns = extractDiscoverPatterns(entryContent);

if (!patterns || patterns.length === 0) {
  console.error('[ceves-discover] No `discover` patterns found in createRouter() call.');
  console.error('  Add `discover: ["./routes/**/*.ts", "./events/**/*.ts"]` to your createRouter() options.');
  process.exit(1);
}

console.log(`[ceves-discover] Discover patterns: ${patterns.join(', ')}`);

// ---------------------------------------------------------------------------
// Glob resolution using built-in Node.js fs (no external deps)
// ---------------------------------------------------------------------------

/**
 * Convert a glob pattern segment to a RegExp.
 * Supports:
 *   **  - matches any number of path segments (including zero)
 *   *   - matches anything within a single path segment (no slashes)
 *   ?   - matches exactly one non-slash character
 *   .   - literal dot
 */
function globToRegex(pattern) {
  // Normalize slashes
  const normalized = pattern.replace(/\\/g, '/');

  let regexStr = '^';
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];

    if (ch === '*' && normalized[i + 1] === '*') {
      // ** - match zero or more path segments
      // Could be /**/  or **/ at start or /** at end
      if (normalized[i + 2] === '/') {
        // **/ matches zero or more directories
        regexStr += '(?:.+/)?';
        i += 3;
      } else {
        // ** at end
        regexStr += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      // Single * - match anything except slash
      regexStr += '[^/]*';
      i++;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      // Escape regex special chars
      regexStr += '\\' + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  regexStr += '$';
  return new RegExp(regexStr);
}

/**
 * Recursively walk a directory and return all file paths.
 */
function walkDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Resolve a glob pattern relative to a base directory.
 * Returns an array of absolute file paths that match.
 */
function resolveGlob(baseDir, pattern) {
  // Normalize pattern to forward slashes
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Determine the "fixed" prefix (the part before the first glob character)
  // to use as the root directory for the walk
  const parts = normalizedPattern.split('/');
  let fixedParts = [];
  let hasGlob = false;

  for (const part of parts) {
    if (part.includes('*') || part.includes('?')) {
      hasGlob = true;
      break;
    }
    fixedParts.push(part);
  }

  // Handle patterns starting with './'
  const searchRoot = path.resolve(baseDir, fixedParts.join('/') || '.');

  // Get the relative part of the pattern that still needs matching (from baseDir)
  const regex = globToRegex(normalizedPattern);

  // Walk the search root and collect all files
  const allFiles = walkDir(searchRoot);

  // Filter files by the glob pattern
  const matched = [];
  for (const absPath of allFiles) {
    // Get path relative to baseDir, using forward slashes
    const relPath = path.relative(baseDir, absPath).replace(/\\/g, '/');
    // Strip leading './' from pattern for comparison
    const patternForMatch = normalizedPattern.replace(/^\.\//, '');
    const relPathForMatch = relPath.replace(/^\.\//, '');

    const testRegex = globToRegex(patternForMatch);
    if (testRegex.test(relPathForMatch)) {
      matched.push(absPath);
    }
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Find files matching patterns that contain @Route or @EventHandler
// ---------------------------------------------------------------------------

const DECORATOR_PATTERN = /@Route\b|@EventHandler\b/;

const generatedFile = path.join(entryDir, '_discover.generated.ts');

const matchedFiles = new Set();

for (const pattern of patterns) {
  const files = resolveGlob(entryDir, pattern);
  for (const file of files) {
    // Skip the generated file itself
    if (path.resolve(file) === path.resolve(generatedFile)) continue;

    const content = fs.readFileSync(file, 'utf8');
    if (DECORATOR_PATTERN.test(content)) {
      matchedFiles.add(file);
    }
  }
}

if (matchedFiles.size === 0) {
  console.warn('[ceves-discover] Warning: No files with @Route or @EventHandler decorators found.');
}

// Sort for deterministic output
const sortedFiles = Array.from(matchedFiles).sort();

console.log(`[ceves-discover] Found ${sortedFiles.length} file(s) with decorators:`);
for (const f of sortedFiles) {
  console.log(`  ${path.relative(cwd, f)}`);
}

// ---------------------------------------------------------------------------
// Generate import paths relative to the generated file location
// ---------------------------------------------------------------------------

function toImportPath(absFilePath) {
  // Import path relative to the generated file's directory (same as entry dir)
  let rel = path.relative(entryDir, absFilePath).replace(/\\/g, '/');

  // Remove .ts extension
  rel = rel.replace(/\.ts$/, '');

  // Ensure it starts with './'
  if (!rel.startsWith('.')) {
    rel = './' + rel;
  }

  return rel;
}

const importLines = sortedFiles.map(f => `import '${toImportPath(f)}';`);

// ---------------------------------------------------------------------------
// Write _discover.generated.ts
// ---------------------------------------------------------------------------

const generatedContent = [
  '// Auto-generated by @sydorenkoalex/ceves - DO NOT EDIT',
  '// Run "npx ceves-discover" to regenerate',
  '',
  ...importLines,
  '',
].join('\n');

// Only write if content has changed to avoid triggering unnecessary rebuild loops
const existingContent = fs.existsSync(generatedFile) ? fs.readFileSync(generatedFile, 'utf8') : null;
if (existingContent !== generatedContent) {
  fs.writeFileSync(generatedFile, generatedContent, 'utf8');
  console.log(`[ceves-discover] Generated: ${path.relative(cwd, generatedFile)}`);
} else {
  console.log(`[ceves-discover] No changes to: ${path.relative(cwd, generatedFile)}`);
}

// ---------------------------------------------------------------------------
// Ensure entry file imports the generated file
// ---------------------------------------------------------------------------

const generatedImportStatement = `import './_discover.generated';`;

if (!entryContent.includes(generatedImportStatement)) {
  // Find the right place to insert: after leading comments/blank lines, before first code
  const lines = entryContent.split('\n');
  let insertAt = 0;

  // Skip leading comment blocks (/** ... */ or // ...) and blank lines
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inBlockComment) {
      if (trimmed.endsWith('*/')) {
        inBlockComment = false;
        insertAt = i + 1;
      }
      continue;
    }

    if (trimmed.startsWith('/*')) {
      inBlockComment = true;
      continue;
    }

    if (trimmed === '' || trimmed.startsWith('//')) {
      insertAt = i + 1;
      continue;
    }

    // First non-comment, non-blank line
    break;
  }

  lines.splice(insertAt, 0, generatedImportStatement);
  const updatedContent = lines.join('\n');
  fs.writeFileSync(entryFile, updatedContent, 'utf8');
  console.log(`[ceves-discover] Added import to: ${path.relative(cwd, entryFile)}`);
} else {
  console.log(`[ceves-discover] Entry file already imports _discover.generated (no changes needed).`);
}

console.log('[ceves-discover] Done.');
