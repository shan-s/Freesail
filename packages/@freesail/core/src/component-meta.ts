/**
 * @fileoverview Component Metadata
 *
 * Typed container for framework-injected metadata passed alongside resolved
 * component props. Shared by every framework renderer (React, Lit, ...).
 */

/**
 * Typed container for framework-injected metadata passed alongside component props.
 * Access via the `meta` field on FreesailComponentProps — never access `__`-prefixed
 * keys on `component` directly.
 */
export class ComponentMeta {
  constructor(
    private readonly _bindings: Record<string, { path: string }>,
    private readonly _dataUpdatedAt: Record<string, number>,
    private readonly _componentState: Record<string, unknown>
  ) {}

  /** Binding path for a data-bound prop. Returns undefined if the prop is not data-bound. */
  getBinding(propName: string): { path: string } | undefined {
    return this._bindings[propName];
  }

  /** Last-write timestamp for a data-bound prop. Returns 0 if no timestamp exists. */
  getUpdatedTime(propName: string): number {
    return this._dataUpdatedAt[propName] ?? 0;
  }

  /** Runtime state override set via setComponentState (e.g. visible, enabled). */
  getComponentState(property: string): unknown {
    return this._componentState[property];
  }
}
