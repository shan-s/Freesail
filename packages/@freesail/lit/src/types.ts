/**
 * @fileoverview Freesail Lit - Type Definitions
 *
 * Public interfaces for custom catalog integration.
 */

import type { FreesailComponent } from './registry.js';
import type { FunctionImplementation } from '@freesail/core';

export type { FunctionImplementation };

/**
 * Definition of a custom catalog that can be registered with Freesail.
 *
 * Developers create a CatalogDefinition to bundle their JSON schema
 * and Lit component implementations together, then pass them to
 * <freesail-provider> for registration.
 *
 * @example
 * ```ts
 * import catalog from './catalog.json';
 * import { MyCustomCard } from './components/MyCustomCard.js';
 *
 * export const MyOwnCatalog: CatalogDefinition = {
 *   namespace: 'myown',
 *   schema: catalog,
 *   components: {
 *     'MyCustomCard': MyCustomCard,
 *   },
 * };
 * ```
 */
export interface CatalogDefinition {
  /** Unique namespace for the catalog (e.g., 'myown' or a full URI) */
  namespace: string;
  /** The JSON schema object (catalog.json content) describing available components */
  schema: any;
  /** Map of component names to Lit render functions implementing FreesailComponentProps */
  components: Record<string, FreesailComponent>;
  /** Map of function names to their implementations */
  functions?: Record<string, FunctionImplementation>;
}

// Re-exported so existing consumers importing these from '@freesail/lit'
// (rather than '@freesail/core' directly) keep working, matching the
// '@freesail/react' package's public surface.
export {
  type FreesailSideEffect,
  isFreesailSideEffect,
  dispatchAction,
  setComponentState,
} from '@freesail/core';
