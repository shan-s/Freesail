/**
 * @fileoverview Chat Catalog Functions
 *
 * Re-exports included functions from the standard catalog.
 * Edit catalog.include.json to add or remove included functions,
 * then run `freesail prepare catalog` to regenerate generated-includes.ts.
 */

import type { FunctionImplementation } from '@freesail/react';
import { includedFunctions } from '../includes/generated-includes.js';

export const chatCatalogFunctions: Record<string, FunctionImplementation> = {
  ...includedFunctions,
};
