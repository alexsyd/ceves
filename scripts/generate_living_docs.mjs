#!/usr/bin/env node
/**
 * Generate/validate living documentation for Ceves.
 *
 * This script is dependency-free so it can run in a fresh checkout after the
 * repository is cloned. It inventories source modules, public exports, tests,
 * example assets, and existing docs, then writes docs/living-documentation.md.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'living-documentation.md');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.wrangler']);

function rel(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    if (entry.isFile()) out.push(full);
  }
  return out.sort((a, b) => rel(a).localeCompare(rel(b)));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function groupByTopLevel(files, rootDir) {
  const counts = new Map();
  for (const file of files) {
    const parts = path.relative(rootDir, file).split(path.sep);
    const key = parts.length > 1 ? parts[0] : '(root)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function extractPublicExports(indexPath) {
  if (!existsSync(indexPath)) return [];
  const text = readFileSync(indexPath, 'utf8');
  const exports = [];
  const exportFrom = /export\s+(?:type\s+)?(?:\{([\s\S]*?)\}|\*|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = exportFrom.exec(text))) {
    const [, namesBlock, from] = match;
    if (!namesBlock) {
      exports.push({ from, names: ['*'] });
      continue;
    }
    const names = namesBlock
      .split(',')
      .map((name) => name.trim().replace(/^type\s+/, ''))
      .filter(Boolean)
      .map((name) => name.replace(/\s+as\s+/g, ' as '));
    exports.push({ from, names });
  }
  return exports;
}

function findDecorators(files) {
  const decorators = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const found = [...text.matchAll(/@(Route|EventHandler|QueryHandler)\b/g)].map((m) => m[1]);
    if (found.length) decorators.push({ file: rel(file), decorators: [...new Set(found)].sort() });
  }
  return decorators.sort((a, b) => a.file.localeCompare(b.file));
}

function bulletList(items, empty = 'None detected') {
  if (!items.length) return `- ${empty}\n`;
  return items.map((item) => `- \`${item}\``).join('\n') + '\n';
}

function renderTable(rows, headers) {
  if (!rows.length) return '| None detected | | |\n';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n') + '\n';
}

function collect() {
  const packageJson = readJson(path.join(ROOT, 'package.json'));
  const allFiles = walk(ROOT);
  const srcFiles = allFiles.filter((file) => rel(file).startsWith('src/') && /\.(ts|tsx)$/.test(file));
  const tests = allFiles.filter((file) => /\.(test|spec)\.(ts|tsx)$/.test(file));
  const docs = allFiles
    .filter((file) => /(^|\/)README\.md$|\.md$/.test(rel(file)) && rel(file) !== 'docs/living-documentation.md')
    .map(rel);
  const configs = allFiles
    .filter((file) => ['package.json', 'tsconfig.json', 'tsup.config.ts', 'vitest.config.ts', 'vitest.workspace.ts'].includes(rel(file)) || rel(file).startsWith('example/') && ['package.json', 'tsconfig.json', 'wrangler.toml', 'wrangler-do.toml'].includes(path.basename(file)))
    .map(rel);
  const exampleFiles = allFiles.filter((file) => rel(file).startsWith('example/') && /\.(ts|tsx|sql|toml|md|json)$/.test(file));

  return {
    packageJson,
    docs,
    configs,
    srcFiles,
    tests,
    srcGroups: groupByTopLevel(srcFiles, path.join(ROOT, 'src')),
    exports: extractPublicExports(path.join(ROOT, 'src', 'index.ts')),
    decorators: findDecorators([...srcFiles, ...exampleFiles.filter((file) => /\.(ts|tsx)$/.test(file))]),
    exampleFiles: exampleFiles.map(rel),
  };
}

function render(data) {
  const generated = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  const scriptNames = Object.entries(data.packageJson.scripts ?? {}).map(([name, command]) => `${name}: ${command}`);
  const exportRows = data.exports.map(({ from, names }) => [
    `\`${from}\``,
    names.slice(0, 8).map((name) => `\`${name}\``).join(', ') + (names.length > 8 ? ', …' : ''),
  ]);
  const sourceRows = data.srcGroups.map(([name, count]) => [`\`${name}\``, String(count)]);
  const decoratorRows = data.decorators.map(({ file, decorators }) => [`\`${file}\``, decorators.map((d) => `\`@${d}\``).join(', ')]);

  return `# Living Documentation: Ceves

Generated by \`scripts/generate_living_docs.mjs\` on ${generated}.

## Documentation ownership decision

Ceves should keep living documentation generated from the package manifest, public
exports, source tree, tests, and examples. Hand-authored docs such as
\`README.md\`, \`GETTING_STARTED.md\`, and \`example/README.md\` should explain
concepts and workflows; this generated file should be refreshed whenever source
modules, public exports, scripts, tests, or examples change.

Refresh and validate with:

\`\`\`sh
npm run docs:living
npm run docs:living:check
\`\`\`

## Repository role

\`${data.packageJson.name}\` is ${data.packageJson.description}. It is a
TypeScript-first event sourcing/CQRS package for Cloudflare Workers and Durable
Objects, with route/decorator support, OpenAPI integration, R2/D1 persistence
adapters, restoration helpers, and a runnable example app.

## Existing documentation inventory

${bulletList(data.docs)}## Source-of-truth inventory

### Package scripts

${bulletList(scriptNames, 'No npm scripts detected')}### Configuration and manifests

${bulletList(data.configs)}### Source modules

${renderTable(sourceRows, ['Source area', 'TypeScript files'])}### Public API exports from \`src/index.ts\`

${renderTable(exportRows, ['Export source', 'Public symbols'])}### Decorator-driven examples/routes/events

${renderTable(decoratorRows, ['File', 'Detected decorators'])}### Test inventory

${bulletList(data.tests.map(rel), 'No test files detected')}### Example assets

${bulletList(data.exampleFiles)}## Repeatable validation

- Run \`npm run docs:living:check\` to fail when this generated file is stale.
- Run \`npm test\` before changing runtime behavior; integration tests may depend
  on Cloudflare Workers/Vitest environment setup.
- Run \`npm run build\` before publishing changes to public exports or package
  entry points.
- Keep generated documentation free of secrets: list file paths, package shape,
  exported symbols, and test/example coverage only.

## SmartphoneKey KB linkage

This generated file is a repo-local source for the SmartphoneKey living-docs
rollout tracked by Jira PA-41. If product KB pages need updates, regenerate this
repository documentation from source first and link to the resulting PR; do not
edit generated KB output directly unless that separate write is approved.

## Maintenance checklist for future agents

1. Pull latest \`main\` and run \`npm run docs:living:check\`.
2. If source, tests, examples, or package scripts changed, run
   \`npm run docs:living\` and commit the refreshed \`docs/living-documentation.md\`.
3. Keep hand-authored conceptual docs focused on explanations; keep inventories
   and source-derived lists in this generated document.
4. Link Jira/PR notes to this file and include validation output.
`;
}

function normalizeTimestamp(text) {
  return text.replace(
    /Generated by `scripts\/generate_living_docs\.mjs` on .*?\./,
    'Generated by `scripts/generate_living_docs.mjs` on <timestamp>.'
  );
}

function main() {
  const check = process.argv.includes('--check');
  const content = render(collect());
  if (check) {
    if (!existsSync(DOC)) {
      console.error(`missing ${rel(DOC)}`);
      process.exit(1);
    }
    const current = readFileSync(DOC, 'utf8');
    if (normalizeTimestamp(current) !== normalizeTimestamp(content)) {
      console.error(`stale ${rel(DOC)}`);
      process.exit(1);
    }
    console.log(`OK: ${rel(DOC)} is current`);
    return;
  }
  mkdirSync(path.dirname(DOC), { recursive: true });
  writeFileSync(DOC, content);
  console.log(`Wrote ${rel(DOC)}`);
}

main();
