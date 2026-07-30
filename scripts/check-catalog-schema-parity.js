/**
 * Verifies that @freesail/standard-catalog and @freesail/standard-catalog-lit
 * declare the exact same component/function vocabulary (components.json,
 * functions.json, common/common_types.json). Both packages implement the same
 * catalogId, so an agent's UI plan must be portable between the React and Lit
 * renderers — this script is the guard against the two hand-maintained JSON
 * trios drifting apart.
 */
const fs = require('fs');
const path = require('path');

const REACT_ROOT = path.join(__dirname, '..', 'packages', '@freesail', 'standard-catalog', 'src');
const LIT_ROOT = path.join(__dirname, '..', 'packages', '@freesail', 'standard-catalog-lit', 'src');

const FILES = [
  ['components/components.json', 'components/components.json'],
  ['functions/functions.json', 'functions/functions.json'],
  ['common/common_types.json', 'common/common_types.json'],
];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

let ok = true;

for (const [reactRel, litRel] of FILES) {
  const reactPath = path.join(REACT_ROOT, reactRel);
  const litPath = path.join(LIT_ROOT, litRel);

  if (!fs.existsSync(reactPath) || !fs.existsSync(litPath)) {
    console.error(`❌ Missing file: ${fs.existsSync(reactPath) ? litPath : reactPath}`);
    ok = false;
    continue;
  }

  const reactCanonical = JSON.stringify(canonicalize(readJson(reactPath)));
  const litCanonical = JSON.stringify(canonicalize(readJson(litPath)));

  if (reactCanonical !== litCanonical) {
    console.error(`❌ Schema drift: ${reactRel}`);
    console.error(`   React: ${reactPath}`);
    console.error(`   Lit:   ${litPath}`);
    console.error('   Contents differ — sync the two files (only intentional per-framework implementation details should differ, never the schema).');
    ok = false;
  } else {
    console.log(`✅ ${reactRel} matches between standard-catalog and standard-catalog-lit`);
  }
}

if (!ok) {
  console.error('\n💥 Catalog schema parity check failed.');
  process.exit(1);
}

console.log('\n✨ standard-catalog and standard-catalog-lit schemas match.');
