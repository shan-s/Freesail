/**
 * @fileoverview @freesail/standard-catalog
 *
 * The standard UI component catalog for Freesail, built as a standalone
 * package using the Freesail SDK — the same way any external developer
 * would create a custom catalog.
 *
 * @example
 * ```tsx
 * import { FreesailProvider } from '@freesail/react';
 * import { StandardCatalog } from '@freesail/standard-catalog';
 *
 * <FreesailProvider
 *   gateway="/gateway"
 *   catalogDefinitions={[StandardCatalog]}
 * >
 *   <App />
 * </FreesailProvider>
 * ```
 */

import type { CatalogDefinition } from '@freesail/react';
import { standardCatalogComponents } from './components/components.js';
import catalogSchema from './standard-catalog.json';

// Re-export all individual components for advanced usage
export * from './components/components.js';
export { standardCatalogComponents } from './components/components.js';
export { standardCatalogFunctions } from './functions/functions.js';

export const STANDARD_CATALOG_ID = catalogSchema.catalogId;

/**
 * The standard catalog as a CatalogDefinition.
 *
 * Pass this to FreesailProvider's `catalogDefinitions` prop:
 *
 * ```tsx
 * <FreesailProvider
 *   gateway="/api"
 *   catalogDefinitions={[StandardCatalog]}
 * >
 * ```
 */
import { standardCatalogFunctions } from './functions/functions.js';

export const StandardCatalog: CatalogDefinition = {
  namespace: STANDARD_CATALOG_ID,
  schema: catalogSchema,
  components: standardCatalogComponents,
  functions: standardCatalogFunctions,
};
