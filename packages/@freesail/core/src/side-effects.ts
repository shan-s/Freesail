/**
 * @fileoverview Freesail Side Effects
 *
 * Framework-agnostic helpers for catalog function implementations that need
 * to write to the local data model or notify the agent of a client-side event.
 */

import { componentStatePath, STRUCTURAL_COMPONENT_PROPS } from './protocol.js';

/**
 * A typed side effect returned by catalog functions.
 *
 * - `dataModelUpdate`: writes a value to the local data model (e.g. show/hide).
 *   Optionally also dispatches an upstream action to the agent.
 * - `actionDispatch`: dispatches an upstream action to the agent with no local state change.
 *   Any catalog function can return this to notify the agent of something that happened.
 */
export type FreesailSideEffect =
  | {
      readonly _effect: 'dataModelUpdate';
      path: string;
      value: unknown;
      action?: { name: string; context: Record<string, unknown> };
    }
  | {
      readonly _effect: 'actionDispatch';
      name: string;
      context: Record<string, unknown>;
    };

export function isFreesailSideEffect(v: unknown): v is FreesailSideEffect {
  const effect = (v as Record<string, unknown>)?.['_effect'];
  return effect === 'dataModelUpdate' || effect === 'actionDispatch';
}

/**
 * Returns a FreesailSideEffect that dispatches an upstream action to the agent.
 * Use this in any catalog function that needs to notify the agent of a client-side event.
 */
export function dispatchAction(name: string, context: Record<string, unknown> = {}): FreesailSideEffect {
  return { _effect: 'actionDispatch', name, context };
}

/**
 * Returns a FreesailSideEffect that sets a runtime state override for a component.
 * Throws if a structural property (id, component, child, children, action) is targeted,
 * since those are protocol-owned and cannot be overridden at runtime.
 */
export function setComponentState(
  componentId: string,
  property: string,
  value: unknown
): FreesailSideEffect {
  if (STRUCTURAL_COMPONENT_PROPS.has(property)) {
    throw new Error(
      `[Freesail] setComponentState: '${property}' is a structural property and cannot be overridden at runtime.`
    );
  }
  return { _effect: 'dataModelUpdate', path: componentStatePath(componentId, property), value };
}
