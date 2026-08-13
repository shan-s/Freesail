import { describe, it, expect } from 'vitest';
import * as CoreExports from '@freesail/core';
import * as ReactUIExports from './index.js';

/**
 * Regression gate for the Phase 1 core-extraction refactor: every symbol
 * @freesail/react/src/index.ts re-exported before the refactor must still
 * resolve, and the ones now sourced from @freesail/core must be the exact
 * same runtime value (not a reimplementation) so behavior can never drift.
 */
describe('@freesail/react re-export integrity', () => {
  it('re-exports dispatchAction identical to @freesail/core', () => {
    expect(ReactUIExports.dispatchAction).toBe(CoreExports.dispatchAction);
  });

  it('re-exports isFreesailSideEffect identical to @freesail/core', () => {
    expect(ReactUIExports.isFreesailSideEffect).toBe(CoreExports.isFreesailSideEffect);
  });

  it('re-exports setComponentState identical to @freesail/core', () => {
    expect(ReactUIExports.setComponentState).toBe(CoreExports.setComponentState);
  });

  it('re-exports ComponentMeta identical to @freesail/core', () => {
    expect(ReactUIExports.ComponentMeta).toBe(CoreExports.ComponentMeta);
  });

  it('re-exports theme defaults identical to @freesail/core', () => {
    expect(ReactUIExports.defaultLightTokens).toBe(CoreExports.defaultLightTokens);
    expect(ReactUIExports.defaultDarkTokens).toBe(CoreExports.defaultDarkTokens);
  });

  it('still exports the framework-specific runtime API', () => {
    expect(typeof ReactUIExports.FreesailProvider).toBe('function');
    expect(typeof ReactUIExports.FreesailSurface).toBe('function');
    expect(typeof ReactUIExports.useFreesailContext).toBe('function');
    expect(typeof ReactUIExports.registry).toBe('object');
    expect(typeof ReactUIExports.withCatalog).toBe('function');
    expect(typeof ReactUIExports.registerCatalog).toBe('function');
    expect(typeof ReactUIExports.useSurface).toBe('function');
    expect(typeof ReactUIExports.useSurfaceData).toBe('function');
    expect(typeof ReactUIExports.useAction).toBe('function');
    expect(typeof ReactUIExports.useConnectionStatus).toBe('function');
    expect(typeof ReactUIExports.useSurfaces).toBe('function');
    expect(typeof ReactUIExports.useSessionId).toBe('function');
  });
});
