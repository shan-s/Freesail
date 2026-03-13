/**
 * @fileoverview freesail prepare catalog
 *
 * Generates a resolved catalog JSON by merging common and custom schema files.
 *
 * Convention-based file discovery:
 *   common/common_components.json  → shared component schemas + $defs
 *   common/common_functions.json   → shared function schemas (object-keyed)
 *   components.json               → custom component schemas (optional)
 *   functions.json                → custom function schemas (optional)
 *
 * Catalog metadata is read from package.json:
 *   { "freesail": { "catalogId": "...", "title": "...", "description": "..." } }
 * or for multi-catalog packages:
 *   { "freesail": { "catalogs": { "{prefix}": { ... } } } }
 *
 * Output: {prefix}_catalog.json written to the catalog's source directory.
 */

import fs from 'fs';
import path from 'path';

// When running as an npm lifecycle script (e.g. prebuild), npm sets
// process.cwd() to the package root — INIT_CWD would incorrectly point
// to the workspace root during workspace builds.
const CWD = process.env['npm_lifecycle_event']
  ? process.cwd()
  : (process.env['INIT_CWD'] || process.cwd());

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CatalogConfig {
  name: string;
  packagePath: string;
  srcPath: string;
  prefix: string;
}

interface CatalogMeta {
  catalogId: string;
  title: string;
  description: string;
  includeCommon: boolean;
}

// ---------------------------------------------------------------------------
// Discovery (same pattern as catalog-validate)
// ---------------------------------------------------------------------------

function getCatalogConfig(dir: string, nameOverride?: string): CatalogConfig | null {
  const folderName = nameOverride ?? path.basename(dir);
  const match = folderName.match(/^(.+)_catalog(?:_(v\d+))?$/);
  if (!match) return null;

  const prefix = match[1] as string;

  // Check for src/ first (standalone), then dir itself (monorepo sub-catalog)
  for (const probe of [path.join(dir, 'src'), dir]) {
    if (!fs.existsSync(probe)) continue;
    if (!fs.existsSync(path.join(probe, 'index.ts'))) continue;
    return { name: folderName, packagePath: dir, srcPath: probe, prefix };
  }

  return null;
}

function discoverCatalogs(): CatalogConfig[] {
  // 1. CWD is the catalog package root (named {prefix}_catalog)
  const config = getCatalogConfig(CWD);
  if (config) return [config];

  // 2. CWD contains a src/ with catalog files (package name = {prefix}_catalog)
  const fromSrc = getCatalogConfig(CWD, path.basename(CWD));
  if (fromSrc) return [fromSrc];

  // 3. Scan src/ subdirectories (monorepo: multiple catalogs in one package)
  const srcPath = path.join(CWD, 'src');
  if (fs.existsSync(srcPath)) {
    const catalogs: CatalogConfig[] = [];
    for (const entry of fs.readdirSync(srcPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = getCatalogConfig(path.join(srcPath, entry.name));
      if (sub) catalogs.push(sub);
    }
    if (catalogs.length > 0) return catalogs;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Common file location
// ---------------------------------------------------------------------------

/**
 * Find the common/ directory relative to the catalog source path.
 * Probes: {srcPath}/common/ (standalone) then {srcPath}/../common/ (monorepo).
 * Returns the path and the $ref prefix to use in the output catalog.
 */
function findCommonDir(srcPath: string): { dir: string; refPrefix: string } | null {
  // Standalone: src/common/
  const standalone = path.join(srcPath, 'common');
  if (fs.existsSync(standalone)) {
    return { dir: standalone, refPrefix: './common' };
  }

  // Monorepo: src/standard_catalog/../common/ → src/common/
  const monorepo = path.join(srcPath, '..', 'common');
  if (fs.existsSync(monorepo)) {
    return { dir: monorepo, refPrefix: '../common' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// $ref rewriting
// ---------------------------------------------------------------------------

/**
 * Recursively rewrite $ref values in a JSON structure.
 * Replaces `./common_types.json` with the correct relative path based on
 * where the common directory sits relative to the output catalog.
 */
function rewriteRefs(obj: unknown, refPrefix: string): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => rewriteRefs(item, refPrefix));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      // Rewrite ./common_types.json → {refPrefix}/common_types.json
      result[key] = value.replace(/^\.\/common_types\.json/, `${refPrefix}/common_types.json`);
    } else {
      result[key] = rewriteRefs(value, refPrefix);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Metadata from package.json
// ---------------------------------------------------------------------------

function readCatalogMeta(packagePath: string, prefix: string): CatalogMeta {
  const fallback: CatalogMeta = {
    catalogId: `https://freesail.local/catalogs/${prefix}_catalog_v1.json`,
    title: `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} Catalog`,
    description: `A Freesail catalog for ${prefix}`,
    includeCommon: true,
  };

  // Walk up to find the nearest package.json
  let dir = packagePath;
  let pkgPath: string | null = null;
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      pkgPath = candidate;
      break;
    }
    dir = path.dirname(dir);
  }
  if (!pkgPath) return fallback;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return fallback;
  }

  const freesail = pkg['freesail'] as Record<string, unknown> | undefined;
  if (!freesail) return fallback;

  // Multi-catalog: freesail.catalogs.{prefix}
  const catalogs = freesail['catalogs'] as Record<string, Record<string, string>> | undefined;
  if (catalogs?.[prefix]) {
    const meta = catalogs[prefix]!;
    return {
      catalogId: meta['catalogId'] ?? fallback.catalogId,
      title: meta['title'] ?? fallback.title,
      description: meta['description'] ?? fallback.description,
      includeCommon: meta['includeCommon'] !== 'false' && meta['includeCommon'] !== false as unknown as string,
    };
  }

  // Single catalog: freesail.catalogId, freesail.title, freesail.description
  return {
    catalogId: (freesail['catalogId'] as string) ?? fallback.catalogId,
    title: (freesail['title'] as string) ?? fallback.title,
    description: (freesail['description'] as string) ?? fallback.description,
    includeCommon: freesail['includeCommon'] !== false,
  };
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    console.error(`   ⚠  Could not parse: ${filePath}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prepare a single catalog
// ---------------------------------------------------------------------------

export function prepareCatalog(config: CatalogConfig): boolean {
  console.log(`📦 Preparing: ${config.name}`);

  // 1. Read catalog metadata (needed early to check includeCommon)
  const meta = readCatalogMeta(config.packagePath, config.prefix);

  // 2. Read common schemas (if includeCommon is true)
  let rewrittenComponents: Record<string, unknown> = {};
  let rewrittenFunctions: Record<string, unknown> = {};
  let rewrittenDefs: Record<string, unknown> = {};

  if (meta.includeCommon) {
    const common = findCommonDir(config.srcPath);
    if (!common) {
      console.error(`   ❌ No common/ directory found for ${config.name}`);
      console.error(`      Expected at: ${path.join(config.srcPath, 'common')} or ${path.join(config.srcPath, '..', 'common')}`);
      return false;
    }

    const commonComponentsJson = readJsonSafe(path.join(common.dir, 'common_components.json'));
    const commonFunctionsJson = readJsonSafe(path.join(common.dir, 'common_functions.json'));

    const commonComponents = (commonComponentsJson?.['components'] ?? {}) as Record<string, unknown>;
    const commonFunctions = (commonFunctionsJson?.['functions'] ?? {}) as Record<string, unknown>;
    const commonDefs = (commonComponentsJson?.['$defs'] ?? {}) as Record<string, unknown>;

    rewrittenComponents = rewriteRefs(commonComponents, common.refPrefix) as Record<string, unknown>;
    rewrittenFunctions = rewriteRefs(commonFunctions, common.refPrefix) as Record<string, unknown>;
    rewrittenDefs = rewriteRefs(commonDefs, common.refPrefix) as Record<string, unknown>;
  }

  // 3. Read custom schemas (optional)
  const customComponentsJson = readJsonSafe(path.join(config.srcPath, 'components.json'));
  const customFunctionsJson = readJsonSafe(path.join(config.srcPath, 'functions.json'));

  const customComponents = (customComponentsJson?.['components'] ?? {}) as Record<string, unknown>;
  const customFunctions = (customFunctionsJson?.['functions'] ?? {}) as Record<string, unknown>;
  const customDefs = (customComponentsJson?.['$defs'] ?? {}) as Record<string, unknown>;

  // 4. Determine $schema path (try to find catalog-schema.json under src/schemas/)
  let schemaPath: string | undefined;
  for (const candidate of [
    path.join(config.srcPath, '..', 'schemas', 'catalog-schema.json'),
    path.join(config.srcPath, 'schemas', 'catalog-schema.json'),
  ]) {
    if (fs.existsSync(candidate)) {
      const rel = path.relative(config.srcPath, candidate).replace(/\\/g, '/');
      schemaPath = rel.startsWith('.') ? rel : `./${rel}`;
      break;
    }
  }
  // Fallback: resolve via node_modules (standalone catalogs)
  if (!schemaPath) {
    try {
      const pkgJson = require.resolve('@freesail/catalogs/package.json');
      const candidate = path.join(path.dirname(pkgJson), 'src', 'schemas', 'catalog-schema.json');
      if (fs.existsSync(candidate)) {
        const rel = path.relative(config.srcPath, candidate).replace(/\\/g, '/');
        schemaPath = rel.startsWith('.') ? rel : `./${rel}`;
      }
    } catch { /* @freesail/catalogs not installed */ }
  }

  // 5. Merge everything
  const mergedComponents = { ...rewrittenComponents, ...customComponents };
  const mergedFunctions = { ...rewrittenFunctions, ...customFunctions };
  const mergedDefs = { ...rewrittenDefs, ...customDefs };

  const catalog: Record<string, unknown> = {};
  if (schemaPath) catalog['$schema'] = schemaPath;
  catalog['$id'] = meta.catalogId;
  catalog['title'] = meta.title;
  catalog['description'] = meta.description;
  catalog['catalogId'] = meta.catalogId;
  catalog['components'] = mergedComponents;

  if (Object.keys(mergedFunctions).length > 0) {
    catalog['functions'] = mergedFunctions;
  }

  if (Object.keys(mergedDefs).length > 0) {
    catalog['$defs'] = mergedDefs;
  }

  // 8. Write output
  const outputFile = `${config.prefix}_catalog.json`;
  const outputPath = path.join(config.srcPath, outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + '\n');

  const componentCount = Object.keys(mergedComponents).length;
  const functionCount = Object.keys(mergedFunctions).length;
  console.log(`   ✅ Prepared ${componentCount} component(s) and ${functionCount} function(s) → ${outputFile}`);

  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function run(): void {
  console.log('--- Freesail Prepare Catalog ---');
  const catalogs = discoverCatalogs();

  if (catalogs.length === 0) {
    console.error(
      '❌ No catalogs found. Run this command from a catalog package directory\n' +
      '   (folder must be named {prefix}_catalog or contain src/{prefix}_catalog/).'
    );
    process.exit(1);
  }

  let allPassed = true;
  for (const config of catalogs) {
    if (!prepareCatalog(config)) allPassed = false;
  }

  if (!allPassed) {
    console.error('\n💥 Prepare failed. Fix the errors above.');
    process.exit(1);
  }

  console.log('\n✅ All catalogs prepared successfully.');
}
