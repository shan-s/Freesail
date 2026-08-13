/**
 * @fileoverview React-flavored theming re-exports.
 *
 * The design tokens and CSS-custom-property conversion are 100%
 * framework-agnostic and live in @freesail/core, shared with every other
 * renderer package. This file only adds the `CSSProperties` typing React
 * consumers expect from a `style={{...}}` spread.
 */

import type { CSSProperties } from 'react';
import {
  defaultLightTokens,
  defaultDarkTokens,
  resolveTokens,
  tokensToCssVars as coreTokensToCssVars,
  surfaceThemeToCssVars as coreSurfaceThemeToCssVars,
} from '@freesail/core';
import type {
  FreesailThemeMode,
  FreesailThemeTokens,
  FreesailSurfaceTheme,
  FreesailThemeProp,
} from '@freesail/core';

export type { FreesailThemeMode, FreesailThemeTokens, FreesailSurfaceTheme, FreesailThemeProp };
export { defaultLightTokens, defaultDarkTokens, resolveTokens };

export function tokensToCssVars(tokens: FreesailThemeTokens, mode: FreesailThemeMode = 'light'): CSSProperties {
  return coreTokensToCssVars(tokens, mode) as CSSProperties;
}

export function surfaceThemeToCssVars(theme: FreesailSurfaceTheme): CSSProperties {
  return coreSurfaceThemeToCssVars(theme) as CSSProperties;
}
