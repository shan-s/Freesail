/**
 * @fileoverview Lit-flavored theming re-exports.
 *
 * The design tokens and CSS-custom-property conversion are 100%
 * framework-agnostic and live in @freesail/core, shared with every other
 * renderer package. lit-html's `styleMap()` directive accepts a plain
 * Record<string, string> directly, so no wrapping/casting is needed here
 * (unlike @freesail/react, which casts to React's CSSProperties type).
 */

export {
  type FreesailThemeMode,
  type FreesailThemeTokens,
  type FreesailSurfaceTheme,
  type FreesailThemeProp,
  type CssVarMap,
  defaultLightTokens,
  defaultDarkTokens,
  resolveTokens,
  tokensToCssVars,
  surfaceThemeToCssVars,
} from '@freesail/core';
