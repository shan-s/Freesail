/**
 * @fileoverview freesail new catalog
 *
 * Scaffolds a new Freesail catalog package using the inclusion model.
 *
 * Instead of copying a common/ directory, the developer declares which
 * components and functions they want to include from existing catalog packages
 * via catalog.include.json. `freesail prepare catalog` then bundles the
 * schema and generates generated-includes.ts for the target framework's
 * implementations (React or Lit, chosen via --framework).
 *
 * After scaffolding, `freesail prepare catalog` is run to generate the
 * resolved catalog JSON and the generated-includes.ts bridge file.
 */

import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { prepareCatalog, buildCatalogConfig } from './catalog-prepare.js';
import readmeTemplate from './catalog-readme.md';
import licensePlaceholder from './catalog-license-placeholder.txt';
import thirdPartyLicenses from './catalog-3rdpartylicenses.txt';
import newDefaults from './catalog-new-defaults.json';

type Framework = 'react' | 'lit';

// ---------------------------------------------------------------------------
// Catalog domain generation
// ---------------------------------------------------------------------------

const BOAT_TYPES = ['dinghy', 'cruiser', 'racer', 'catamaran', 'trimaran', 'sloop', 'cutter', 'ketch', 'yawl'];

function generateCatalogDomain(): string {
  const boat = BOAT_TYPES[Math.floor(Math.random() * BOAT_TYPES.length)]!;
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `${boat}${hex}`;
}

/**
 * Derive a .local domain from a package name.
 * @scope/name  → scope.local
 * name (no scope) → falls back to the provided fallback domain
 */
function domainFromPackageName(packageName: string, fallback: string): string {
  const match = packageName.match(/^@([^/]+)\//);
  return match ? `${match[1]}.local` : fallback;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Try to load a catalog JSON from an installed package.
 * Returns the parsed JSON if successful, or null if the package is not installed.
 * Resolution is anchored to CWD so workspace-linked packages are found.
 */
function tryLoadPackageCatalog(
  packageName: string,
  catalogPath: string,
): Record<string, unknown> | null {
  try {
    const require = createRequire(pathToFileURL(path.join(process.cwd(), '_')).href);
    const pkgJsonPath = require.resolve(`${packageName}/package.json`);
    const pkgRoot = path.dirname(pkgJsonPath);
    const fullPath = path.join(pkgRoot, catalogPath);
    if (!fs.existsSync(fullPath)) return null;
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scaffold file generators
// ---------------------------------------------------------------------------

function generateComponentsSource(prefix: string, framework: Framework): string {
  const camelPrefix = prefix.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const pascalPrefix = camelPrefix.charAt(0).toUpperCase() + camelPrefix.slice(1);

  if (framework === 'lit') {
    return `/**
 * @fileoverview ${pascalPrefix} Catalog Components
 *
 * Extends included components with catalog-specific custom components.
 * Edit catalog.include.json to add or remove included packages/components,
 * then run \`freesail prepare catalog\` to regenerate generated-includes.ts.
 */

import { html } from 'lit';
import type { FreesailComponentProps, FreesailComponent } from '@freesail/lit';
import { includedComponents } from '../includes/generated-includes.js';

// Add custom components here, for example:
//
// const MyWidget: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
//   return html\`<div>\${children}</div>\`;
// };

export const ${camelPrefix}CatalogComponents: Record<string, FreesailComponent> = {
  ...includedComponents,
  // MyWidget,
};
`;
  }

  return `/**
 * @fileoverview ${pascalPrefix} Catalog Components
 *
 * Extends included components with catalog-specific custom components.
 * Edit catalog.include.json to add or remove included packages/components,
 * then run \`freesail prepare catalog\` to regenerate generated-includes.ts.
 */

import React, { type CSSProperties } from 'react';
import type { FreesailComponentProps } from '@freesail/react';
import { includedComponents } from '../includes/generated-includes.js';

// Add custom components here, for example:
//
// export function MyWidget({ component, children }: FreesailComponentProps) {
//   const style: CSSProperties = {};
//   return <div style={style}>{children}</div>;
// }

export const ${camelPrefix}CatalogComponents: Record<string, React.ComponentType<FreesailComponentProps>> = {
  ...includedComponents,
  // MyWidget,
};
`;
}

function generateFunctionsTs(prefix: string): string {
  const camelPrefix = prefix.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  return `/**
 * @fileoverview ${camelPrefix} Catalog Functions
 *
 * Extends included functions with catalog-specific custom functions.
 * Edit catalog.include.json to add or remove included packages/functions,
 * then run \`freesail prepare catalog\` to regenerate generated-includes.ts.
 */

import type { FunctionImplementation } from '@freesail/core';
import { includedFunctions } from '../includes/generated-includes.js';

// Add custom functions here, for example:
//
// const myCustomFn: FunctionImplementation = (value: unknown) => {
//   return String(value).toUpperCase();
// };

export const ${camelPrefix}CatalogFunctions: Record<string, FunctionImplementation> = {
  ...includedFunctions,
  // myCustomFn,
};
`;
}

function generateIndexTs(prefix: string, catalogName: string, framework: Framework): string {
  const camelPrefix = prefix.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const pascalPrefix = camelPrefix.charAt(0).toUpperCase() + camelPrefix.slice(1);
  const constName = `${pascalPrefix}Catalog`;
  const catalogDefinitionSource = framework === 'lit' ? '@freesail/lit' : '@freesail/react';

  return `/**
 * @fileoverview ${pascalPrefix} Catalog
 */

import type { CatalogDefinition } from '${catalogDefinitionSource}';
import { ${camelPrefix}CatalogComponents } from './components/components.js';
import { ${camelPrefix}CatalogFunctions } from './functions/functions.js';
import catalogSchema from './${catalogName}.json';

export const ${constName}: CatalogDefinition = {
  namespace: catalogSchema.catalogId,
  schema: catalogSchema,
  components: ${camelPrefix}CatalogComponents,
  functions: ${camelPrefix}CatalogFunctions,
};
`;
}

function generatePackageJson(packageName: string, description: string, catalogName: string, framework: Framework): string {
  const frameworkDefaults = newDefaults.frameworks[framework];
  const pkg = {
    name: packageName,
    description,
    ...frameworkDefaults.packageJson,
    scripts: {
      ...frameworkDefaults.packageJson.scripts,
      postbuild: `cp src/freesailconfig.json dist/ && cp src/${catalogName}.json dist/`,
    },
  };
  return JSON.stringify(pkg, null, 2);
}

function generateFreesailConfig(
  catalogName: string,
  catalogId: string,
  title: string,
  description: string,
  framework: Framework,
): string {
  return JSON.stringify(
    { catalog: { catalogFile: `${catalogName}.json`, catalogId, title, description, framework } },
    null,
    2,
  ) + '\n';
}

function generateTsconfig(framework: Framework): string {
  return JSON.stringify(newDefaults.frameworks[framework].tsconfig, null, 2);
}

function generateReadme(prefix: string, title: string, description: string): string {
  const camelPrefix = prefix.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const pascalPrefix = camelPrefix.charAt(0).toUpperCase() + camelPrefix.slice(1);

  return readmeTemplate
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{description\}\}/g, description)
    .replace(/\{\{prefix\}\}/g, prefix)
    .replace(/\{\{pascalPrefix\}\}/g, pascalPrefix);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseDirArg(): string | undefined {
  const args = process.argv.slice(4);
  const idx = args.findIndex((a) => a === '--dir' || a === '-d');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

function parseFrameworkArg(): Framework | undefined {
  const args = process.argv.slice(4);
  const idx = args.findIndex((a) => a === '--framework' || a === '-f');
  const value = idx !== -1 ? args[idx + 1] : undefined;
  if (value === 'react' || value === 'lit') return value;
  return undefined;
}

export async function run(): Promise<void> {
  console.log('--- Freesail New Catalog ---\n');
  console.log('This will scaffold a new Freesail catalog package.\n');

  const dirArg = parseDirArg();
  const frameworkArg = parseFrameworkArg();

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const prefix = await ask(rl, 'Catalog prefix (e.g. "weather", "finance")', '');
    if (!prefix) {
      console.error('Prefix is required.');
      process.exit(1);
    }

    if (!/^[a-z][a-z0-9_]*$/.test(prefix)) {
      console.error('Prefix must start with a lowercase letter and contain only [a-z0-9_].');
      process.exit(1);
    }

    let framework = frameworkArg;
    if (!framework) {
      const answer = await ask(rl, 'Framework (react/lit)', 'react');
      framework = answer === 'lit' ? 'lit' : 'react';
    }

    const domain = generateCatalogDomain();

    const title = await ask(rl, 'Catalog title', `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} Catalog`);
    const description = await ask(rl, 'Catalog description', `A custom Freesail catalog for ${prefix}`);
    const packageName = await ask(rl, 'npm package name', `@${domain}/${prefix}-catalog`);
    const outputDir = dirArg ?? await ask(rl, 'Output directory', `./${prefix}-catalog`);
    if (dirArg) console.log(`Output directory: ${outputDir}`);

    rl.close();

    const standardCatalog = newDefaults.standardCatalogPackages[framework];
    const standardCatalogInstalled =
      tryLoadPackageCatalog(standardCatalog.package, standardCatalog.catalogPath) !== null;

    // Resolve output path
    const outPath = path.resolve(process.cwd(), outputDir);
    const srcPath = path.join(outPath, 'src');

    // Derive catalogId from the actual folder name and package org scope
    const catalogName = path.basename(outPath);
    const catalogDomain = domainFromPackageName(packageName, domain);
    const catalogId = `https://${catalogDomain}/catalogs/${catalogName}.json`;

    if (fs.existsSync(outPath) && fs.readdirSync(outPath).length > 0) {
      console.error(`\n❌ Directory already exists and is not empty: ${outPath}`);
      process.exit(1);
    }

    console.log(`\n📦 Scaffolding ${framework} catalog...\n`);

    // Create src/ subdirectories
    fs.mkdirSync(path.join(srcPath, 'includes'), { recursive: true });
    fs.mkdirSync(path.join(srcPath, 'components'), { recursive: true });
    fs.mkdirSync(path.join(srcPath, 'functions'), { recursive: true });

    // Generate src/includes/catalog.include.json
    const includeJson = {
      includes: {
        [standardCatalog.package]: {
          catalogPath: standardCatalog.catalogPath,
          components: standardCatalog.components,
          functions: standardCatalog.functions,
          defs: standardCatalog.defs,
        },
      },
    };
    if (!standardCatalogInstalled) {
      console.warn(`   ⚠  ${standardCatalog.package} is not installed.`);
      console.warn(`      Run: npm install ${standardCatalog.package}`);
      console.warn('      Then: freesail prepare catalog');
    }

    fs.writeFileSync(
      path.join(srcPath, 'includes', 'catalog.include.json'),
      JSON.stringify(includeJson, null, 2) + '\n',
    );
    console.log('   📄 src/includes/catalog.include.json');

    // Generate component schema and implementation stubs
    fs.writeFileSync(
      path.join(srcPath, 'components', 'components.json'),
      JSON.stringify({ components: {} }, null, 2) + '\n',
    );
    console.log('   📄 src/components/components.json');

    const componentsFileName = framework === 'lit' ? 'components.ts' : 'components.tsx';
    fs.writeFileSync(path.join(srcPath, 'components', componentsFileName), generateComponentsSource(prefix, framework));
    console.log(`   📄 src/components/${componentsFileName}`);

    // Generate function schema and implementation stubs
    fs.writeFileSync(
      path.join(srcPath, 'functions', 'functions.json'),
      JSON.stringify({ functions: {} }, null, 2) + '\n',
    );
    console.log('   📄 src/functions/functions.json');

    fs.writeFileSync(path.join(srcPath, 'functions', 'functions.ts'), generateFunctionsTs(prefix));
    console.log('   📄 src/functions/functions.ts');

    fs.writeFileSync(path.join(srcPath, 'index.ts'), generateIndexTs(prefix, catalogName, framework));
    console.log('   📄 src/index.ts');

    // Generate package files
    fs.writeFileSync(
      path.join(outPath, 'package.json'),
      generatePackageJson(packageName, description, catalogName, framework),
    );
    console.log('   📄 package.json');

    fs.writeFileSync(
      path.join(outPath, 'src', 'freesailconfig.json'),
      generateFreesailConfig(catalogName, catalogId, title, description, framework),
    );
    console.log('   📄 src/freesailconfig.json');

    fs.writeFileSync(path.join(outPath, 'tsconfig.json'), generateTsconfig(framework));
    console.log('   📄 tsconfig.json');

    fs.writeFileSync(path.join(outPath, 'README.md'), generateReadme(prefix, title, description));
    console.log('   📄 README.md');

    fs.writeFileSync(path.join(outPath, 'LICENSE'), licensePlaceholder);
    console.log('   📄 LICENSE');

    fs.writeFileSync(path.join(outPath, '3rdpartylicenses.txt'), thirdPartyLicenses);
    console.log('   📄 3rdpartylicenses.txt');

    // Run catalog-prepare to generate the initial catalog JSON and generated-includes.ts.
    // Skip if the standard catalog package is not yet installed — prepare would fail.
    const canPrepare = standardCatalogInstalled;
    if (canPrepare) {
      console.log('');
      prepareCatalog(buildCatalogConfig(outPath, srcPath, framework));
    }

    console.log(`\n✅ Catalog scaffolded at: ${outPath}`);
    console.log('\nNext steps:');
    console.log(`  cd ${outputDir}`);
    if (!canPrepare) {
      console.log(`  npm install ${standardCatalog.package}`);
      console.log('  npx freesail prepare catalog');
    } else {
      console.log('  npm install');
    }
    console.log('  npm run build');
    console.log(`\nAdd custom components in src/components/${componentsFileName}`);
    console.log('  and define their schemas in src/components/components.json');
    console.log('Add custom functions in src/functions/functions.ts');
    console.log('  and define their schemas in src/functions/functions.json');
    console.log('\nTo import components/functions from a catalog package, run:');
    console.log('  npx freesail include catalog --package <name>');
    console.log('\n⚠  Update the package scope (e.g. @myorg) before publishing.');
  } finally {
    rl.close();
  }
}
