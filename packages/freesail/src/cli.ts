/**
 * @fileoverview Freesail CLI
 *
 * Entry point for the `freesail` command-line tool.
 *
 * Usage:
 *   freesail catalog new       — scaffold a new catalog package
 *   freesail catalog validate  — validate an existing catalog package
 */

const [, , noun, verb] = process.argv;

if (noun === 'catalog') {
  if (verb === 'new') {
    import('./commands/catalog-new.js').then((m) => m.run());
  } else if (verb === 'validate') {
    import('./commands/catalog-validate.js').then((m) => m.run());
  } else {
    console.error(`Unknown catalog command: ${verb ?? '(none)'}`);
    console.error('Usage: freesail catalog <new|validate>');
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${noun ?? '(none)'}`);
  console.error('Usage: freesail catalog <new|validate>');
  process.exit(1);
}
