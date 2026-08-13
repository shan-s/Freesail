/**
 * @fileoverview Generic Component Registry
 *
 * Maps component names from a catalog to framework-specific component
 * values (a React ComponentType, a Lit render function, etc). This is
 * the framework-agnostic core shared by every renderer package — each
 * renderer instantiates its own `ComponentRegistry<TComponent>` singleton
 * with its own component-value type.
 */

import type { CatalogId } from './protocol.js';

/**
 * A function implementation that can be called from the data model.
 */
export type FunctionImplementation = (...args: any[]) => any;

/**
 * Component map within a catalog.
 */
export type ComponentMap<TComponent> = Map<string, TComponent>;

/**
 * Minimal interface the binding engine needs to look up catalog functions
 * and their declared positional parameter names. `ComponentRegistry`
 * satisfies this structurally, but binding-engine.ts depends only on
 * this interface so it never needs to import a concrete registry type.
 */
export interface FunctionLookup {
  getFunction(catalogId: CatalogId, functionName: string): FunctionImplementation | null;
  getParamNames(catalogId: CatalogId, functionName: string): string[] | undefined;
}

/**
 * Registry of all catalogs and their components, generic over the
 * framework-specific component value type `TComponent`.
 */
export class ComponentRegistry<TComponent> implements FunctionLookup {
  private catalogs: Map<CatalogId, ComponentMap<TComponent>> = new Map();
  private functions: Map<CatalogId, Record<string, FunctionImplementation>> = new Map();
  /** Positional parameter names per function, extracted from the catalog schema. */
  private paramNames: Map<CatalogId, Record<string, string[]>> = new Map();
  private fallbackComponent: TComponent | null = null;

  /**
   * Register a catalog with its components, functions, and optional schema.
   * When a schema is provided, parameter names are extracted from
   * `functions.*.args.properties` keys so `evaluateFunction` can
   * reorder named-key argument objects from the LLM.
   */
  registerCatalog(
    catalogId: CatalogId,
    components: Record<string, TComponent>,
    functions?: Record<string, FunctionImplementation>,
    schema?: Record<string, unknown>
  ): void {
    const map: ComponentMap<TComponent> = new Map(Object.entries(components));
    this.catalogs.set(catalogId, map);
    if (functions) {
      this.functions.set(catalogId, functions);
    }
    if (schema) {
      this.extractParamNames(catalogId, schema);
    }
  }

  /**
   * Extract positional parameter names from a catalog schema's function definitions.
   */
  private extractParamNames(catalogId: CatalogId, schema: Record<string, unknown>): void {
    const funcs = schema['functions'] as Record<string, Record<string, unknown>> | undefined;
    if (!funcs) return;
    const names: Record<string, string[]> = {};
    for (const [funcName, funcDef] of Object.entries(funcs)) {
      const propsField = funcDef['properties'] as Record<string, unknown> | undefined;
      const argsDef = propsField?.['args'] as Record<string, unknown> | undefined;
      if (argsDef) {
        const props = argsDef['properties'] as Record<string, unknown> | undefined;
        if (props && Object.keys(props).length > 0) {
          names[funcName] = Object.keys(props);
        }
      }
    }
    if (Object.keys(names).length > 0) {
      this.paramNames.set(catalogId, names);
    }
  }

  /**
   * Register a single component in a catalog.
   */
  registerComponent(
    catalogId: CatalogId,
    componentName: string,
    component: TComponent
  ): void {
    if (!this.catalogs.has(catalogId)) {
      this.catalogs.set(catalogId, new Map());
    }
    this.catalogs.get(catalogId)!.set(componentName, component);
  }

  /**
   * Get a component from a catalog.
   */
  getComponent(catalogId: CatalogId, componentName: string): TComponent | null {
    const catalog = this.catalogs.get(catalogId);
    if (!catalog) {
      console.warn(`Catalog not found: ${catalogId}`);
      return this.fallbackComponent;
    }

    const component = catalog.get(componentName);
    if (!component) {
      console.warn(`Component not found: ${componentName} in catalog ${catalogId}`);
      return this.fallbackComponent;
    }

    return component;
  }

  /**
   * Get a function from a catalog.
   */
  getFunction(catalogId: CatalogId, functionName: string): FunctionImplementation | null {
    const catalogFunctions = this.functions.get(catalogId);
    if (!catalogFunctions) {
      return null;
    }
    // Direct lookup first
    if (catalogFunctions[functionName] != null) {
      return catalogFunctions[functionName];
    }
    // Fallback: try snake_case -> camelCase conversion (e.g. open_url -> openUrl)
    if (functionName.includes('_')) {
      const camelName = functionName.replace(/_([a-z])/g, (_match, p1) => p1.toUpperCase());
      return catalogFunctions[camelName] ?? null;
    }
    return null;
  }

  /**
   * Get the declared positional parameter names for a function.
   * Returns undefined if no schema was registered or the function has no named params.
   */
  getParamNames(catalogId: CatalogId, functionName: string): string[] | undefined {
    return this.paramNames.get(catalogId)?.[functionName];
  }

  /**
   * Check if a catalog is registered.
   */
  hasCatalog(catalogId: CatalogId): boolean {
    return this.catalogs.has(catalogId);
  }

  /**
   * Get all registered catalog IDs.
   */
  getCatalogIds(): CatalogId[] {
    return Array.from(this.catalogs.keys());
  }

  /**
   * Set a fallback component for unknown components.
   */
  setFallbackComponent(component: TComponent): void {
    this.fallbackComponent = component;
  }

  /**
   * Clear all registrations.
   */
  clear(): void {
    this.catalogs.clear();
    this.functions.clear();
    this.paramNames.clear();
    this.fallbackComponent = null;
  }
}
