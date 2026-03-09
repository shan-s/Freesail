/**
 * @fileoverview freesail catalog new
 *
 * Interactively scaffolds a new Freesail catalog package.
 *
 * Prompts (all have defaults, press Enter to accept):
 *   1. Catalog name        → basename of current working directory
 *   2. Package name        → basename(cwd) + "-catalog"  
 *   3. Catalog ID (URI)    → https://{random-hex}.local/catalogs/{name}_catalog_v1.json
 *   4. Description         → A Freesail UI component catalog for {name}
 *   5. Version             → 1.0.0
 *
 * Generated structure:
 *   ./{name}_catalog/
 *     package.json          prebuild: freesail catalog validate
 *     tsconfig.json
 *     src/
 *       {name}_catalog.json   ← edit catalogId before publishing
 *       components.tsx
 *       functions.ts          ← spreads commonFunctions, do not remove formatString
 *       index.ts              ← sets freesailVersion from installed freesail
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import selfPkg from '../../package.json';

// Read freesail's own version to use in generated devDependencies
function getFreesailVersion(): string {
  return `^${(selfPkg as { version: string }).version}`;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// Capitalise first letter of each word: weather_catalog → WeatherCatalog
function toPascalCase(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

// weather → WEATHER
function toUpperSnake(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}

// ──────────────────────────────────────────────────────────────────────────────
// Templates
// ──────────────────────────────────────────────────────────────────────────────

function genPackageJson(opts: {
  packageName: string;
  version: string;
  description: string;
  freesailVersion: string;
}): string {
  return JSON.stringify(
    {
      name: opts.packageName,
      version: opts.version,
      description: opts.description,
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
        },
      },
      files: ['dist', 'LICENSE'],
      scripts: {
        prebuild: 'freesail catalog validate',
        build: 'tsc',
        clean: 'rm -rf dist *.tsbuildinfo',
      },
      peerDependencies: {
        '@freesail/react': '*',
        react: '^18.0.0 || ^19.0.0',
      },
      devDependencies: {
        '@freesail/catalogs': opts.freesailVersion,
        '@freesail/react': '*',
        '@types/react': '^18.0.0',
        freesail: opts.freesailVersion,
        react: '^18.0.0',
        typescript: '^5.0.0',
      },
    },
    null,
    2
  );
}

function genTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        isolatedModules: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        outDir: './dist',
        rootDir: './src',
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2
  );
}

function genCatalogJson(opts: {
  catalogId: string;
  title: string;
  description: string;
}): string {
  return JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: opts.catalogId,
      catalogId: opts.catalogId,
      title: opts.title,
      description: opts.description,
      _TODO: 'Replace $id and catalogId with your published URL before publishing.',
      components: {},
      functions: [],
    },
    null,
    2
  );
}

function genComponentsTsx(opts: { name: string; pascal: string }): string {
  const exportName = `${opts.name}CatalogComponents`;
  return `import type { ComponentType } from 'react';
import type { FreesailComponentProps } from '@freesail/react';

// Add your custom React components here.
// Each key must match a component name declared in ${opts.name}_catalog.json.
//
// Example:
//   import { MyCard } from './MyCard.js';
//   ${exportName}['MyCard'] = MyCard;

export const ${exportName}: Record<string, ComponentType<FreesailComponentProps>> = {
  // 'MyCard': MyCard,
};
`;
}

function genFunctionsTs(opts: { name: string }): string {
  const exportName = `${opts.name}CatalogFunctions`;
  return `import type { FunctionImplementation } from '@freesail/react';

// Common functions (including the mandatory \`formatString\`) are inherited
// in index.ts via the \`...commonFunctions\` spread.
//
// Add custom functions here to extend the common set.
// You may override a common function by defining it with the same key.
//
// ⚠  Do NOT override \`formatString\` with a no-op — it is required by the
//    system prompt. \`freesail catalog validate\` will error if it is absent.

export const ${exportName}: Record<string, FunctionImplementation> = {
  // myCustomFn: (value, ...args) => { ... },
};
`;
}

function genIndexTs(opts: {
  name: string;
  pascal: string;
  upper: string;
  catalogId: string;
  catalogJsonFile: string;
}): string {
  const catalogVar = `${opts.pascal}Catalog`;
  const idConst = `${opts.upper}_CATALOG_ID`;
  const componentsExport = `${opts.name}CatalogComponents`;
  const functionsExport = `${opts.name}CatalogFunctions`;

  return `// TODO: Update catalogId in ./src/${opts.catalogJsonFile} before publishing.
// Current value is a placeholder: ${opts.catalogId}

import type { CatalogDefinition } from '@freesail/react';
import { commonFunctions } from '@freesail/catalogs/common';
import catalogSchema from './${opts.catalogJsonFile}';
import freesailPkg from 'freesail/package.json';
import { ${componentsExport} } from './components.js';
import { ${functionsExport} } from './functions.js';

export * from './components.js';
export * from './functions.js';
export { ${componentsExport} };
export { ${functionsExport} };

export const ${idConst} = catalogSchema.catalogId;

export const ${catalogVar}: CatalogDefinition = {
  namespace: ${idConst},
  schema: catalogSchema,
  components: ${componentsExport},
  functions: {
    ...commonFunctions,        // Inherits all common functions, including formatString
    ...${functionsExport},     // Custom functions override common ones
  },
  freesailVersion: freesailPkg.version,
};
`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

export async function run(): Promise<void> {
  const cwdBase = path.basename(process.cwd());
  const randomHex = crypto.randomBytes(3).toString('hex');
  const freesailVersion = getFreesailVersion();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🚀 Freesail Catalog Generator\n');

  try {
    // 1. Catalog name
    const nameInput = await ask(rl, `Catalog name [${cwdBase}]: `);
    const name = nameInput || cwdBase;

    // 2. Package name
    const defaultPkg = `${cwdBase}-catalog`;
    const pkgInput = await ask(rl, `Package name [${defaultPkg}]: `);
    const packageName = pkgInput || defaultPkg;

    // 3. Catalog ID
    const defaultId = `https://${randomHex}.local/catalogs/${name}_catalog_v1.json`;
    const idInput = await ask(rl, `Catalog ID [${defaultId}]: `);
    const catalogId = idInput || defaultId;

    // 4. Description
    const defaultDesc = `A Freesail UI component catalog for ${name}`;
    const descInput = await ask(rl, `Description [${defaultDesc}]: `);
    const description = descInput || defaultDesc;

    // 5. Version
    const versionInput = await ask(rl, `Version [1.0.0]: `);
    const version = versionInput || '1.0.0';

    rl.close();

    // Derived values
    const pascal = toPascalCase(name);
    const upper = toUpperSnake(name);
    const outDir = path.join(process.cwd(), `${name}_catalog`);
    const srcDir = path.join(outDir, 'src');
    const catalogJsonFile = `${name}_catalog.json`;
    const title = `${pascal} Catalog`;

    // Create directory structure
    fs.mkdirSync(srcDir, { recursive: true });

    // Write files
    const files: Array<[string, string]> = [
      [path.join(outDir, 'package.json'), genPackageJson({ packageName, version, description, freesailVersion })],
      [path.join(outDir, 'tsconfig.json'), genTsConfig()],
      [path.join(srcDir, catalogJsonFile), genCatalogJson({ catalogId, title, description })],
      [path.join(srcDir, 'components.tsx'), genComponentsTsx({ name, pascal })],
      [path.join(srcDir, 'functions.ts'), genFunctionsTs({ name })],
      [path.join(srcDir, 'index.ts'), genIndexTs({ name, pascal, upper, catalogId, catalogJsonFile })],
    ];

    for (const [filePath, content] of files) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    // Summary
    const rel = path.relative(process.cwd(), outDir);
    console.log(`\n✨ Created ${rel}/`);
    console.log(`   ├── package.json          prebuild: freesail catalog validate`);
    console.log(`   ├── tsconfig.json`);
    console.log(`   └── src/`);
    console.log(`       ├── ${catalogJsonFile}`);
    console.log(`       ├── components.tsx`);
    console.log(`       ├── functions.ts`);
    console.log(`       └── index.ts`);
    console.log('');
    console.log('Next steps:');
    console.log(`  1. cd ${rel}`);
    console.log('  2. npm install');
    console.log(`  3. Edit src/${catalogJsonFile} — replace the placeholder catalogId`);
    console.log('  4. Add components to src/components.tsx');
    console.log('  5. npm run build');
    console.log('');
    if (catalogId.includes('.local/')) {
      console.log(`⚠  Catalog ID is a placeholder: ${catalogId}`);
      console.log(`   Update $id and catalogId in src/${catalogJsonFile} before publishing.\n`);
    }
  } catch (err) {
    rl.close();
    throw err;
  }
}
