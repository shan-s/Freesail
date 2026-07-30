/**
 * @fileoverview @freesail/standard-catalog-lit
 *
 * The standard UI component catalog for Freesail, Lit implementation.
 * Same catalogId/schema as @freesail/standard-catalog — only the rendering
 * implementation differs, so agent-authored surfaces are portable between
 * a React host app and a Lit host app.
 *
 * @example
 * ```ts
 * import { StandardCatalog } from '@freesail/standard-catalog-lit';
 *
 * const provider = document.querySelector('freesail-provider')!;
 * provider.catalogs = [StandardCatalog];
 * ```
 */

import type { CatalogDefinition } from '@freesail/lit';
import { standardCatalogComponents } from './components/components.js';
import { standardCatalogFunctions } from './functions/functions.js';
import catalogSchema from './standard-catalog.json';

export const StandardCatalog: CatalogDefinition = {
  namespace: catalogSchema.catalogId,
  schema: catalogSchema,
  components: standardCatalogComponents,
  functions: standardCatalogFunctions,
};
