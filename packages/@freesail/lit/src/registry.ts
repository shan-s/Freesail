/**
 * @fileoverview Component Registry
 *
 * Maps component names from the catalog to Lit render functions.
 * This enables the renderer to dynamically instantiate components
 * based on A2UI messages.
 *
 * The generic registry implementation lives in @freesail/core and is shared
 * with every other framework binding (e.g. @freesail/react) — this file only
 * defines the Lit-specific component contract and instantiates this
 * package's own singleton.
 */

import type { TemplateResult } from 'lit';
import type { A2UIComponent, CatalogId, FunctionCall } from '@freesail/core';
import { ComponentRegistry, ComponentMeta } from '@freesail/core';
import type { FunctionImplementation } from './types.js';

// Re-exported so consumers can import ComponentMeta from '@freesail/lit'
// directly, matching the '@freesail/react' package's public surface.
export { ComponentMeta };

/**
 * Props passed to all Freesail Lit components.
 *
 * Component authors write plain functions `(props) => TemplateResult` —
 * there is no per-component custom-element registration.
 */
export interface FreesailComponentProps {
  /** The component definition from the A2UI message (with resolved data bindings, no __ keys) */
  component: A2UIComponent;
  /** Framework-injected metadata: data bindings, update timestamps, component state overrides */
  meta: ComponentMeta;
  /**
   * Rendered children (for container components). Interpolate directly into
   * an `html` template, e.g. `` html`<div>${children}</div>` `` — lit-html
   * accepts a TemplateResult, an array of them, the `nothing` sentinel, or a
   * directive result (e.g. from `repeat()`) in any child position, so this is
   * intentionally left as `unknown` rather than a narrower union.
   */
  children?: unknown;
  /** Full data model for the surface (server → client, kept in sync by two-way binding) */
  dataModel?: Record<string, unknown>;
  /** Scope data when inside a template iteration */
  scopeData?: unknown;
  /** Callback to dispatch user actions (client → server) */
  onAction?: (name: string, context: Record<string, unknown>) => void;
  /**
   * Write a value to the local data model at the given JSON Pointer path.
   * This is the "Write" half of A2UI two-way binding — input components
   * call this on every user interaction (keystroke, toggle, etc.).
   * The update is LOCAL only; it does NOT send a message to the server.
   * The updated data model reaches the server when an action is dispatched
   * (either via resolved data bindings in the action context, or via
   * the sendDataModel metadata mechanism).
   */
  onDataChange?: (path: string, value: unknown) => void;
  /**
   * Execute a function call definition.
   * This is for LocalAction handling (client-side logic).
   */
  onFunctionCall?: (call: FunctionCall) => void;
}

/**
 * A plain function that renders an A2UI component to a lit-html TemplateResult.
 */
export type FreesailComponent = (props: FreesailComponentProps) => TemplateResult;

/**
 * Registry of all catalogs and their components for this framework binding.
 */
export const registry = new ComponentRegistry<FreesailComponent>();

/**
 * Higher-order function to create a component with catalog binding.
 * This ensures the component is registered when imported.
 */
export function withCatalog(
  catalogId: CatalogId,
  componentName: string,
  Component: FreesailComponent
): FreesailComponent {
  registry.registerComponent(catalogId, componentName, Component);
  return Component;
}

/**
 * Register multiple components for a catalog at once.
 */
export function registerCatalog(
  catalogId: CatalogId,
  components: Record<string, FreesailComponent>,
  functions?: Record<string, FunctionImplementation>,
  schema?: Record<string, unknown>
): void {
  registry.registerCatalog(catalogId, components, functions, schema);
}
