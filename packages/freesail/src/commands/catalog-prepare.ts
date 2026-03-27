/**
 * @fileoverview freesail prepare catalog
 *
 * Generates a resolved catalog JSON by merging schemas from included npm packages
 * and local custom schema files. Also generates a TypeScript bridge file
 * (generated-includes.ts) that maps component/function names to their React
 * implementations from the upstream packages.
 *
 * A directory is treated as a catalog if it contains src/catalog.include.json.
 *
 * Inclusion-based model:
 *   catalog.include.json  → declares which components/functions to pull from packages
 *   components.json       → custom component schemas (optional, overrides imports)
 *   functions.json        → custom function schemas (optional, overrides imports)
 *
 * Catalog metadata is read from package.json:
 *   { "freesail": { "catalogId": "...", "title": "...", "description": "..." } }
 * or for multi-catalog packages:
 *   { "freesail": { "catalogs": { "{prefix}": { ... } } } }
 *
 * Usage:
 *   freesail prepare catalog [--dir <path>]
 *
 * Options:
 *   --dir, -d <path>   Catalog root directory (default: CWD)
 *
 * Output:
 *   {folder-name}.json   — merged schema bundle
 *   generated-includes.ts   — TS bridge for React implementations
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

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
}

interface IncludeEntry {
  /** Required: relative path within the package root to the catalog JSON file.
   *  e.g. "dist/standard_catalog.json" */
  catalogPath: string;
  components?: string[];
  functions?: string[];
  /** Explicit $defs to copy from the upstream catalog (transitive deps included). */
  defs?: string[];
}

interface CatalogInclude {
  includes: Record<string, IncludeEntry>;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Build a CatalogConfig for a directory that is known to be a catalog
 * (i.e. srcPath/catalog.include.json already verified to exist).
 *
 * name   = folder basename of packagePath (e.g. "standard-catalog")
 * prefix = snake_case catalog name derived from folder (e.g. "standard")
 */
export function buildCatalogConfig(packagePath: string, srcPath: string): CatalogConfig {
  const name = path.basename(packagePath);
  const prefix = name.replace(/[-_]catalog$/, '').replace(/-/g, '_');
  return { name, packagePath, srcPath, prefix };
}

function parseDirArg(): string | undefined {
  const args = process.argv.slice(4);
  const idx = args.findIndex(a => a === '--dir' || a === '-d');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

function discoverCatalogs(dir: string): CatalogConfig[] {
  const srcPath = path.join(dir, 'src');

  // Primary: dir itself contains src/includes/catalog.include.json
  if (fs.existsSync(path.join(srcPath, 'includes', 'catalog.include.json'))) {
    return [buildCatalogConfig(dir, srcPath)];
  }

  // Monorepo: scan src/ subdirectories for sub-catalogs each with includes/catalog.include.json
  if (fs.existsSync(srcPath)) {
    const catalogs: CatalogConfig[] = [];
    for (const entry of fs.readdirSync(srcPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(srcPath, entry.name);
      if (fs.existsSync(path.join(subDir, 'includes', 'catalog.include.json'))) {
        catalogs.push(buildCatalogConfig(subDir, subDir));
      }
    }
    if (catalogs.length > 0) return catalogs;
  }

  return [];
}

// ---------------------------------------------------------------------------
// $ref rewriting (for local schema files that may use relative file refs)
// ---------------------------------------------------------------------------

/**
 * Recursively rewrite $ref values in local schema files.
 * Local components.json / functions.json may use file-relative refs
 * (e.g. `./common_types.json#/$defs/Foo`) that need to become `#/$defs/Foo`.
 * Imported schemas from catalog packages already use internal refs and don't
 * need rewriting.
 */
function rewriteRefs(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => rewriteRefs(item));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      result[key] = value.replace(
        /^(?:(?:\.\.\/common\/|\.\/common\/|\.\/)?common(?:_types|_components)|catalog)\.json(#.*)$/,
        '$1',
      );
    } else {
      result[key] = rewriteRefs(value);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Catalog ID derivation from package name
// ---------------------------------------------------------------------------

/**
 * Derive a .local domain from a scoped package name.
 * @scope/name → scope.local
 * Falls back to freesail.local if unscoped.
 */
function domainFromPackageName(packageName: string): string {
  const match = packageName.match(/^@([^/]+)\//);
  return match ? `${match[1]}.local` : 'freesail.local';
}

// ---------------------------------------------------------------------------
// Metadata from package.json
// ---------------------------------------------------------------------------

function readCatalogMeta(packagePath: string, prefix: string): CatalogMeta {
  const fallback: CatalogMeta = {
    catalogId: `https://freesail.local/catalogs/${prefix.replace(/_/g, '-')}-catalog.json`,
    title: `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} Catalog`,
    description: `A Freesail catalog for ${prefix}`,
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

  // Derive catalogId from package name org scope
  const pkgName = (pkg['name'] as string) ?? '';
  const domain = domainFromPackageName(pkgName);
  const derivedCatalogId = `https://${domain}/catalogs/${prefix.replace(/_/g, '-')}-catalog.json`;

  const freesail = pkg['freesail'] as Record<string, unknown> | undefined;
  if (!freesail) {
    return { ...fallback, catalogId: derivedCatalogId };
  }

  // Multi-catalog: freesail.catalogs.{prefix}
  const catalogs = freesail['catalogs'] as Record<string, Record<string, string>> | undefined;
  if (catalogs?.[prefix]) {
    const meta = catalogs[prefix]!;
    return {
      catalogId: meta['catalogId'] ?? derivedCatalogId,
      title: meta['title'] ?? fallback.title,
      description: meta['description'] ?? fallback.description,
    };
  }

  // Single catalog: optional overrides from freesail block
  return {
    catalogId: (freesail['catalogId'] as string) ?? derivedCatalogId,
    title: (freesail['title'] as string) ?? fallback.title,
    description: (freesail['description'] as string) ?? fallback.description,
  };
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`   ❌ Failed to parse: ${filePath}\n      ${message}`);
    throw new Error(`Invalid JSON in ${path.basename(filePath)}`);
  }
}

// ---------------------------------------------------------------------------
// Package name utilities
// ---------------------------------------------------------------------------

/**
 * Derive a snake_case prefix from an npm package name.
 * Used to construct the conventional TS export names for a catalog package.
 *
 * Examples:
 *   @freesail/standard-catalog  →  standard
 *   @freesail/weather-catalog   →  weather
 *   my-custom-catalog           →  my_custom
 */
export function derivePackagePrefix(packageName: string): string {
  const withoutScope = packageName.replace(/^@[^/]+\//, '');
  const withoutSuffix = withoutScope.replace(/-catalog$/, '');
  return withoutSuffix.replace(/-/g, '_');
}

// ---------------------------------------------------------------------------
// Package resolution
// ---------------------------------------------------------------------------

/**
 * Resolve and read a catalog JSON file from an installed npm package.
 *
 * Uses Node's createRequire() anchored to `fromDir` so that workspace-linked
 * packages are found relative to the catalog being prepared rather than the
 * CLI's own install location.
 *
 * @param packageName  npm package (e.g. "@freesail/standard-catalog")
 * @param catalogPath  path within package root to the catalog JSON
 *                     (e.g. "dist/standard_catalog.json") — must be provided
 *                     by the developer in catalog.include.json
 * @param fromDir      directory from which to resolve (config.srcPath)
 */
export function resolvePackageCatalogJson(
  packageName: string,
  catalogPath: string,
  fromDir: string,
): Record<string, unknown> {
  // Anchor resolution to `fromDir` so workspace symlinks resolve correctly
  const require = createRequire(pathToFileURL(path.join(fromDir, '_')).href);

  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(
      `Package "${packageName}" not found.\n` +
      `   Run: npm install ${packageName}`,
    );
  }

  const pkgRoot = path.dirname(pkgJsonPath);
  const catalogJsonPath = path.join(pkgRoot, catalogPath);

  const catalog = readJsonSafe(catalogJsonPath);
  if (!catalog) {
    throw new Error(
      `catalogPath "${catalogPath}" not found in "${packageName}".\n` +
      `   Full path checked: ${catalogJsonPath}\n` +
      `   Check the "catalogPath" field in your catalog.include.json.`,
    );
  }

  return catalog;
}

// ---------------------------------------------------------------------------
// $def crawler
// ---------------------------------------------------------------------------

/**
 * Recursively collect all $defs transitively referenced by `schema`.
 *
 * When a component or function schema uses `{ "$ref": "#/$defs/SomeType" }`,
 * that type must be pulled from the upstream catalog's $defs and included in
 * the merged output — otherwise the bundled schema would contain dangling refs.
 *
 * This function walks the schema tree, finds every `#/$defs/{name}` reference,
 * copies the definition into `collected`, then recurses into that definition
 * to find any further refs it transitively depends on.
 *
 * @param schema      the schema node to walk
 * @param sourceDefs  all $defs from the upstream catalog JSON
 * @param collected   accumulator: defs to include in the final merged output
 * @param visited     guards against infinite loops from circular $def references
 */
function collectReferencedDefs(
  schema: unknown,
  sourceDefs: Record<string, unknown>,
  collected: Record<string, unknown>,
  visited: Set<string>,
): void {
  if (schema === null || typeof schema !== 'object') return;

  if (Array.isArray(schema)) {
    for (const item of schema) {
      collectReferencedDefs(item, sourceDefs, collected, visited);
    }
    return;
  }

  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      // Match internal $defs references: "#/$defs/SomeName"
      const match = value.match(/^#\/\$defs\/(.+)$/);
      if (match) {
        const defName = match[1] as string;
        if (!visited.has(defName)) {
          visited.add(defName);
          if (defName in sourceDefs) {
            collected[defName] = sourceDefs[defName];
            // Recurse: this def may itself reference other defs
            collectReferencedDefs(sourceDefs[defName], sourceDefs, collected, visited);
          } else {
            console.warn(`   ⚠  $def "${defName}" is referenced but not found in source catalog`);
          }
        }
      }
    } else {
      collectReferencedDefs(value, sourceDefs, collected, visited);
    }
  }
}

// ---------------------------------------------------------------------------
// TypeScript code generation
// ---------------------------------------------------------------------------

/**
 * Generate `generated-includes.ts` — the TypeScript bridge that wires catalog
 * component and function names to their React implementations from the upstream
 * npm packages declared in catalog.include.json.
 *
 * Uses string-based generation (no AST tooling required).
 * Always emits both `includedComponents` and `includedFunctions` exports
 * (possibly empty objects) so that imports in components.tsx / functions.ts
 * never break regardless of what is included.
 *
 * Example output:
 *
 *   import { standardCatalogComponents, standardCatalogFunctions } from '@freesail/standard-catalog';
 *   import { weatherCatalogComponents } from '@freesail/weather-catalog';
 *
 *   export const includedComponents = {
 *     Button: standardCatalogComponents.Button,
 *     StatCard: weatherCatalogComponents.StatCard,
 *   };
 *
 *   export const includedFunctions = {
 *     formatString: standardCatalogFunctions.formatString,
 *   };
 */
function generateIncludesTs(includes: CatalogInclude, srcPath: string): void {
  const lines: string[] = [
    '// AUTO-GENERATED BY FREESAIL CLI - DO NOT EDIT',
    '// Re-run `freesail prepare catalog` to regenerate this file.',
    '',
  ];

  interface PkgExports {
    camelPrefix: string;
    components: string[];
    functions: string[];
  }
  // Preserve insertion order for deterministic output
  const pkgMap = new Map<string, PkgExports>();

  for (const [pkgName, entry] of Object.entries(includes.includes)) {
    const snakePrefix = derivePackagePrefix(pkgName);
    // snake_case → camelCase: standard → standard, my_custom → myCustom
    const camelPrefix = snakePrefix.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    pkgMap.set(pkgName, {
      camelPrefix,
      components: entry.components ?? [],
      functions: entry.functions ?? [],
    });
  }

  // Import lines — only import what is actually used
  for (const [pkgName, exports] of pkgMap) {
    const named: string[] = [];
    if (exports.components.length > 0) named.push(`${exports.camelPrefix}CatalogComponents`);
    if (exports.functions.length > 0) named.push(`${exports.camelPrefix}CatalogFunctions`);
    if (named.length > 0) {
      lines.push(`import { ${named.join(', ')} } from '${pkgName}';`);
    }
  }

  if (pkgMap.size > 0) lines.push('');

  // includedComponents export
  const componentEntries: string[] = [];
  for (const [, exports] of pkgMap) {
    for (const name of exports.components) {
      componentEntries.push(`  ${name}: ${exports.camelPrefix}CatalogComponents['${name}']!`);
    }
  }
  lines.push('export const includedComponents = {');
  if (componentEntries.length > 0) {
    lines.push(componentEntries.join(',\n') + ',');
  }
  lines.push('};');

  // includedFunctions export — always emitted so the import never breaks
  const functionEntries: string[] = [];
  for (const [, exports] of pkgMap) {
    for (const name of exports.functions) {
      functionEntries.push(`  ${name}: ${exports.camelPrefix}CatalogFunctions['${name}']!`);
    }
  }
  lines.push('');
  lines.push('export const includedFunctions = {');
  if (functionEntries.length > 0) {
    lines.push(functionEntries.join(',\n') + ',');
  }
  lines.push('};');
  lines.push('');

  const includesDir = path.join(srcPath, 'includes');
  fs.mkdirSync(includesDir, { recursive: true });
  const outputPath = path.join(includesDir, 'generated-includes.ts');
  fs.writeFileSync(outputPath, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Prepare a single catalog
// ---------------------------------------------------------------------------

export function prepareCatalog(config: CatalogConfig): boolean {
  console.log(`📦 Preparing: ${config.name}`);

  // 1. Read catalog metadata
  const meta = readCatalogMeta(config.packagePath, config.prefix);

  // 2. Resolve schemas from catalog.include.json (opt-in inclusions)
  let importedComponents: Record<string, unknown> = {};
  let importedFunctions: Record<string, unknown> = {};
  let importedDefs: Record<string, unknown> = {};

  const includeJson = readJsonSafe(
    path.join(config.srcPath, 'includes', 'catalog.include.json'),
  ) as CatalogInclude | null;

  if (includeJson) {
    const entries = Object.entries(includeJson.includes ?? {});
    if (entries.length === 0) {
      console.log('   ℹ  catalog.include.json has no includes — skipping package imports');
    }

    for (const [packageName, entry] of entries) {
      console.log(`   📥 Importing from: ${packageName}`);

      let sourceJson: Record<string, unknown>;
      try {
        sourceJson = resolvePackageCatalogJson(packageName, entry.catalogPath, config.srcPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`   ❌ ${message}`);
        throw new Error(`Failed to resolve package "${packageName}"`);
      }

      const sourceComponents = (sourceJson['components'] ?? {}) as Record<string, unknown>;
      const sourceFunctions = (sourceJson['functions'] ?? {}) as Record<string, unknown>;
      const sourceDefs = (sourceJson['$defs'] ?? {}) as Record<string, unknown>;

      // Extract requested components + all transitively referenced $defs
      for (const name of (entry.components ?? [])) {
        if (!(name in sourceComponents)) {
          console.warn(`   ⚠  Component "${name}" not found in "${packageName}" — skipping`);
          continue;
        }
        importedComponents[name] = sourceComponents[name];
        collectReferencedDefs(sourceComponents[name], sourceDefs, importedDefs, new Set());
      }

      // Extract requested functions + all transitively referenced $defs
      for (const name of (entry.functions ?? [])) {
        if (!(name in sourceFunctions)) {
          console.warn(`   ⚠  Function "${name}" not found in "${packageName}" — skipping`);
          continue;
        }
        importedFunctions[name] = sourceFunctions[name];
        collectReferencedDefs(sourceFunctions[name], sourceDefs, importedDefs, new Set());
      }

      // Explicitly copy listed $defs (plus their transitive deps) from the source catalog
      for (const name of (entry.defs ?? [])) {
        if (!(name in sourceDefs)) {
          console.warn(`   ⚠  $def "${name}" not found in "${packageName}" — skipping`);
          continue;
        }
        if (!(name in importedDefs)) {
          importedDefs[name] = sourceDefs[name];
          collectReferencedDefs(sourceDefs[name], sourceDefs, importedDefs, new Set([name]));
        }
      }
    }
  }

  // 3. Read local custom schemas (optional) — local definitions override imports
  const customComponentsJson = readJsonSafe(path.join(config.srcPath, 'components', 'components.json'));
  const customFunctionsJson = readJsonSafe(path.join(config.srcPath, 'functions', 'functions.json'));

  const localComponents = rewriteRefs(
    customComponentsJson?.['components'] ?? {},
  ) as Record<string, unknown>;
  const localFunctions = rewriteRefs(
    customFunctionsJson?.['functions'] ?? {},
  ) as Record<string, unknown>;
  const localDefs = rewriteRefs(
    customComponentsJson?.['$defs'] ?? {},
  ) as Record<string, unknown>;

  // 4. Merge: imported has lower precedence; local overrides on collision
  const mergedComponents: Record<string, unknown> = { ...importedComponents, ...localComponents };
  const mergedFunctions: Record<string, unknown> = { ...importedFunctions, ...localFunctions };
  const mergedDefs: Record<string, unknown> = { ...importedDefs, ...localDefs };

  // 5. Warn if mandatory functions are missing
  const MANDATORY_FUNCTIONS = ['formatString'];
  for (const fn of MANDATORY_FUNCTIONS) {
    if (!(fn in mergedFunctions)) {
      console.warn(`   ⚠  Mandatory function "${fn}" is missing from the catalog.`);
      console.warn(`      This function is required for efficient functioning of Freesail components. Do not remove.`);
    }
  }

  // 6. Generate anyComponent and anyFunction discriminated unions
  const anyComponent: Record<string, unknown> = {
    oneOf: Object.keys(mergedComponents).map(name => ({ $ref: `#/components/${name}` })),
    discriminator: { propertyName: 'component' },
  };
  const finalDefs: Record<string, unknown> = { ...mergedDefs, anyComponent };
  if (Object.keys(mergedFunctions).length > 0) {
    finalDefs['anyFunction'] = {
      oneOf: Object.keys(mergedFunctions).map(name => ({ $ref: `#/functions/${name}` })),
    };
  }

  // 7. Assemble and write the catalog JSON
  const CATALOG_SCHEMA_URL = 'https://freesail.dev/schemas/catalog-schema-v1.json';
  const catalog: Record<string, unknown> = {};
  catalog['$schema'] = CATALOG_SCHEMA_URL;
  catalog['$id'] = meta.catalogId;
  catalog['title'] = meta.title;
  catalog['description'] = meta.description;
  catalog['catalogId'] = meta.catalogId;
  catalog['components'] = mergedComponents;

  if (Object.keys(mergedFunctions).length > 0) {
    catalog['functions'] = mergedFunctions;
  }

  catalog['$defs'] = finalDefs;

  const outputFile = `${config.name}.json`;
  const outputPath = path.join(config.srcPath, outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + '\n');

  const componentCount = Object.keys(mergedComponents).length;
  const functionCount = Object.keys(mergedFunctions).length;
  console.log(`   ✅ Prepared ${componentCount} component(s) and ${functionCount} function(s) → ${outputFile}`);

  // 8. Generate TypeScript bridge file whenever catalog.include.json is present
  //    (even if empty, so that imports in components.tsx / functions.ts always resolve)
  if (includeJson) {
    generateIncludesTs(includeJson, config.srcPath);
    console.log('   ✅ Generated generated-includes.ts');
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function run(): void {
  console.log('--- Freesail Prepare Catalog ---');

  const dirArg = parseDirArg();
  const targetDir = dirArg ? path.resolve(process.cwd(), dirArg) : CWD;

  if (dirArg && !fs.existsSync(path.join(targetDir, 'src', 'includes', 'catalog.include.json'))) {
    console.error(`❌ Not a catalog directory: ${targetDir}`);
    console.error('   Expected src/includes/catalog.include.json to be present.');
    process.exit(1);
  }

  const catalogs = discoverCatalogs(targetDir);

  if (catalogs.length === 0) {
    console.error(
      '❌ No catalog found. Run this command from a catalog directory\n' +
      '   (must contain src/includes/catalog.include.json), or use --dir <path>.',
    );
    process.exit(1);
  }

  let allPassed = true;
  for (const config of catalogs) {
    try {
      if (!prepareCatalog(config)) allPassed = false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`   💥 ${config.name}: ${message}`);
      allPassed = false;
    }
  }

  if (!allPassed) {
    console.error('\n💥 Prepare failed. Fix the errors above.');
    process.exit(1);
  }

  console.log('\n✅ All catalogs prepared successfully.');
}
