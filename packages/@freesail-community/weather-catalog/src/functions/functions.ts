/**
 * @fileoverview Weather Catalog Functions
 *
 * Re-exports all common functions. The weather catalog does not define
 * any catalog-specific functions.
 */

import { includedFunctions } from '../includes/generated-includes.js';
export const weatherCatalogFunctions = { ...includedFunctions };
