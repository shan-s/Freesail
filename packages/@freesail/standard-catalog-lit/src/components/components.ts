/**
 * @fileoverview Standard Catalog Components (Lit)
 *
 * Lit implementation of @freesail/standard-catalog's component set. Same
 * prop contract (component['propName']) and same --freesail-* CSS variable
 * styling as the React version, so a surface looks/behaves the same
 * regardless of which renderer a host app uses.
 *
 * Deliberate simplifications vs the React version (see plan/PR notes):
 *  - No React hooks means no per-component local state. Two-way-bound form
 *    controls (TextField, CheckBox, Slider, Dropdown, ChoicePicker, DateInput,
 *    TimeInput) are implemented as *uncontrolled* native HTML form elements:
 *    onDataChange is called directly from input/change events, and the whole
 *    surface re-renders in response (via FreesailSurfaceElement's reactive
 *    controller), which naturally reflects the new value on the next paint —
 *    no local mirror state needed for responsiveness.
 *  - Radix UI primitives (Popover/Dialog/Select/Slider/Tabs/RadioGroup/
 *    Checkbox) and react-day-picker are replaced with native HTML elements
 *    (<dialog>, <select>, <input type="range/date/time/checkbox/radio">) —
 *    simpler, fully accessible, and needs no JS-managed open/focus-trap state
 *    since the browser owns it.
 *  - TabGroup's active-tab selection is implemented with the classic
 *    "hidden radio inputs + CSS sibling selectors" pattern so tab switching
 *    needs no JS state at all (browser-native radio `checked` state persists
 *    across re-renders on its own). Tab titles are embedded as a
 *    `data-tab-title` attribute by Tab and patched into the header buttons
 *    once via a `ref()` callback after first paint (Lit's plain-function
 *    components can't introspect pre-rendered `children` the way React
 *    elements can be introspected via `.props`).
 *  - Text's `body` variant markdown support is a small hand-rolled inline
 *    parser (bold/italic/inline-code/links) instead of react-markdown —
 *    it builds real lit-html template pieces (no `unsafeHTML`), preserving
 *    the same "interpret markdown syntax, never render raw HTML" safety
 *    property react-markdown has by default.
 */

import { html, svg, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { ref, createRef, type Ref } from 'lit/directives/ref.js';
import type { FreesailComponentProps, FreesailComponent } from '@freesail/lit';
import type { FunctionCall } from '@freesail/core';
import {
  getSemanticColor,
  applyComponentTheme,
  mapJustify,
  validateChecks,
  type CssDeclarations,
} from './utils.js';

// =============================================================================
// Shared style / DOM helpers
// =============================================================================

function fieldBorder(hasError: boolean): string {
  return hasError
    ? '1px solid var(--freesail-error)'
    : '1px solid var(--freesail-border)';
}

/** Sanitize a string for safe use in CSS class names / ids. */
function sanitizeCssIdent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sanitizeCssValue(value: string): string {
  return value.replace(/[;{}"'<>\\]/g, '');
}

/** Check that a URL is safe for use in src/href attributes (http/https only). */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseOptions(rawOptions: unknown): Array<{ label: string; value: string }> {
  return Array.isArray(rawOptions)
    ? rawOptions.map((opt) => {
        if (typeof opt === 'string') {
          return { label: opt, value: opt.toLowerCase().replace(/\s+/g, '_') };
        } else if (opt && typeof opt === 'object' && 'label' in opt && 'value' in opt) {
          return { label: String((opt as any).label), value: String((opt as any).value) };
        }
        return { label: '', value: '' };
      })
    : [];
}

// =============================================================================
// Layout Components
// =============================================================================

const GAP_MAP: Record<string, string> = {
  none: '0',
  xs: 'var(--freesail-space-xs)',
  sm: 'var(--freesail-space-sm)',
  small: 'var(--freesail-space-sm)',
  md: 'var(--freesail-space-md)',
  medium: 'var(--freesail-space-md)',
  lg: 'var(--freesail-space-lg)',
  large: 'var(--freesail-space-lg)',
  xl: 'var(--freesail-space-xl)',
};

function resolveGap(gap: string | undefined): string {
  if (!gap) return 'var(--freesail-space-sm)';
  return GAP_MAP[gap] ?? gap;
}

export const Column: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
  const theme = component['theme'] as Record<string, string> | undefined;
  const themeVars = applyComponentTheme(theme);
  const style: CssDeclarations = {
    ...themeVars,
    display: 'flex',
    flexDirection: 'column',
    gap: resolveGap(component['gap'] as string | undefined),
    alignItems: (component['align'] as string) ?? 'start',
    width: (component['width'] as string) ?? '',
    minWidth: 0,
    minHeight: 0,
  };
  if (component['padding']) style['padding'] = component['padding'] as string;
  if (theme?.['bg']) style['background'] = 'var(--freesail-bg)';
  return html`<div class="fs-layout" style=${styleMap(style)}>${children}</div>`;
};

export const Row: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
  const theme = component['theme'] as Record<string, string> | undefined;
  const themeVars = applyComponentTheme(theme);
  const style: CssDeclarations = {
    ...themeVars,
    display: 'flex',
    flexDirection: 'row',
    gap: resolveGap(component['gap'] as string | undefined),
    alignItems: (component['align'] as string) ?? 'flex-end',
    justifyContent: mapJustify(component['justify'] as string),
    flexWrap: (component['wrap'] as string) ?? 'wrap',
    width: '100%',
    minWidth: 0,
    minHeight: 0,
  };
  if (component['padding']) style['padding'] = component['padding'] as string;
  if (theme?.['bg']) style['background'] = 'var(--freesail-bg)';
  return html`<div class="fs-layout" style=${styleMap(style)}>${children}</div>`;
};

function ensureCardDialogStyles(): void {
  const id = 'fs-card-dialog-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    dialog.fs-card-zoom { border: none; padding: 0; background: transparent; max-width: 90vw; max-height: 90vh; }
    dialog.fs-card-zoom::backdrop { background: rgba(0,0,0,0.5); }
  `;
  document.head.appendChild(style);
}

export const Card: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
  ensureCardDialogStyles();
  const zoomable = component['zoomable'] as boolean | undefined;
  const variant = (component['variant'] as string) ?? 'raised';
  const isFlat = variant === 'flat';
  const borderWeight = component['borderWeight'] !== undefined ? Number(component['borderWeight']) : 1;
  const themeVars = applyComponentTheme(component['theme'] as Record<string, string> | undefined);
  const align = component['align'] as string | undefined;
  const justify = component['justify'] as string | undefined;

  const cardStyle: CssDeclarations = {
    ...themeVars,
    display: 'flex',
    flexDirection: 'column',
    alignItems: align ?? 'stretch',
    justifyContent: mapJustify(justify),
    padding: (component['padding'] as string) ?? 'var(--freesail-space-lg)',
    borderRadius: isFlat ? '0' : ((component['borderRadius'] as string) ?? 'var(--freesail-radius-md)'),
    border: borderWeight > 0 ? `${borderWeight}px solid var(--freesail-border)` : 'none',
    boxShadow: isFlat ? 'none' : 'var(--freesail-shadow-sm)',
    background: isFlat ? 'var(--freesail-bg)' : 'var(--freesail-bg-raised)',
    color: 'var(--freesail-text-foreground)',
    alignSelf: 'stretch',
    position: 'relative',
    overflow: 'hidden',
    minWidth: (component['minWidth'] as string) ?? ((component['width'] as string) ? '' : '180px'),
  };
  if (component['width']) cardStyle['width'] = component['width'] as string;
  if (component['height']) cardStyle['height'] = component['height'] as string;

  if (!zoomable) {
    return html`<div style=${styleMap(cardStyle)}>${children}</div>`;
  }

  const dialogRef: Ref<HTMLDialogElement> = createRef();
  const openZoom = () => dialogRef.value?.showModal();
  const closeZoom = () => dialogRef.value?.close();
  const onDialogClick = (e: MouseEvent) => {
    if (e.target === dialogRef.value) closeZoom();
  };

  const zoomBtnStyle: CssDeclarations = {
    position: 'absolute', top: '0.5rem', right: '0.5rem', width: '22px', height: '22px',
    borderRadius: '4px', border: '1px solid var(--freesail-border)', background: 'var(--freesail-bg-raised)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--freesail-text-secondary)', zIndex: 1, padding: '0',
  };

  const zoomIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6z"/></svg>`;

  return html`
    <div style=${styleMap(cardStyle)}>
      <button type="button" style=${styleMap(zoomBtnStyle)} @click=${openZoom} title="Zoom in">${zoomIcon}</button>
      ${children}
    </div>
    <dialog class="fs-card-zoom" ${ref(dialogRef)} @click=${onDialogClick}>
      <div style=${styleMap({ ...cardStyle, width: '70vw', maxWidth: '1200px', height: 'auto', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--freesail-shadow-md)', alignSelf: 'auto' })}>
        <button type="button" style=${styleMap(zoomBtnStyle)} @click=${closeZoom} title="Restore">${zoomIcon}</button>
        ${children}
      </div>
    </dialog>
  `;
};

// =============================================================================
// Text Components
// =============================================================================

const THEMED_LINK_STYLE: CssDeclarations = {
  color: 'var(--freesail-primary)',
  textDecorationColor: 'var(--freesail-primary)',
};

/** Matches, in priority order: **bold**, *italic*, `code`, [text](url). */
const INLINE_MD_RE = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;

function renderInlineMarkdown(line: string): unknown[] {
  const parts: unknown[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_MD_RE.lastIndex = 0;
  while ((match = INLINE_MD_RE.exec(line))) {
    if (match.index > lastIndex) parts.push(line.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      parts.push(html`<strong>${match[1]}</strong>`);
    } else if (match[2] !== undefined) {
      parts.push(html`<em>${match[2]}</em>`);
    } else if (match[3] !== undefined) {
      parts.push(html`<code>${match[3]}</code>`);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const href = match[5];
      const safe = href && !href.trimStart().toLowerCase().startsWith('javascript:') ? href : undefined;
      parts.push(html`<a href=${safe ?? nothing} target="_blank" rel="noopener noreferrer" style=${styleMap(THEMED_LINK_STYLE)}>${match[4]}</a>`);
    }
    lastIndex = INLINE_MD_RE.lastIndex;
  }
  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  return parts;
}

function renderMarkdownBody(text: string): TemplateResult {
  const lines = text.split('\n');
  return html`${lines.map((line, i) => html`${i > 0 ? html`<br />` : nothing}${renderInlineMarkdown(line)}`)}`;
}

export const Text: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const rawText = component['text'] ?? '';
  const text = (typeof rawText === 'object' && rawText !== null
    ? JSON.stringify(rawText)
    : String(rawText)).replace(/\\n/g, '\n');

  const variant = (component['variant'] as string) ?? 'body';
  const explicitColor = getSemanticColor(component['color'] as string);
  const explicitSize = component['size'] as string | undefined;
  const explicitWeight = component['fontWeight'] as string | undefined;
  const explicitWidth = component['width'] as string | undefined;

  const variantDefaults: Record<string, CssDeclarations> = {
    h1:      { fontSize: 'var(--freesail-type-h1)',      fontWeight: '700', lineHeight: '1.2', color: 'var(--freesail-text-foreground)', margin: '0' },
    h2:      { fontSize: 'var(--freesail-type-h2)',      fontWeight: '700', lineHeight: '1.3', color: 'var(--freesail-text-foreground)', margin: '0' },
    h3:      { fontSize: 'var(--freesail-type-h3)',      fontWeight: '600', lineHeight: '1.4', color: 'var(--freesail-text-foreground)', margin: '0' },
    h4:      { fontSize: 'var(--freesail-type-h4)',      fontWeight: '600', lineHeight: '1.4', color: 'var(--freesail-text-foreground)', margin: '0' },
    h5:      { fontSize: 'var(--freesail-type-h5)',      fontWeight: '600', lineHeight: '1.5', color: 'var(--freesail-text-foreground)', margin: '0' },
    body:    { fontSize: 'var(--freesail-type-body)',    fontWeight: 'normal', color: 'var(--freesail-text-foreground)', margin: '0' },
    label:   { fontSize: 'var(--freesail-type-label)',   fontWeight: '500',    color: 'var(--freesail-text-foreground)', margin: '0' },
    caption: { fontSize: 'var(--freesail-type-caption)', fontWeight: 'normal', color: 'var(--freesail-text-secondary)',  margin: '0' },
  };

  const defaults = variantDefaults[variant] ?? variantDefaults['body']!;
  const style: CssDeclarations = {
    ...defaults,
    ...(explicitColor  ? { color: explicitColor }      : {}),
    ...(explicitSize   ? { fontSize: explicitSize }     : {}),
    ...(explicitWeight ? { fontWeight: explicitWeight } : {}),
    ...(explicitWidth  ? { width: explicitWidth }       : {}),
  };
  const styles = styleMap(style);

  if (variant === 'h1') return html`<h1 style=${styles}>${text}</h1>`;
  if (variant === 'h2') return html`<h2 style=${styles}>${text}</h2>`;
  if (variant === 'h3') return html`<h3 style=${styles}>${text}</h3>`;
  if (variant === 'h4') return html`<h4 style=${styles}>${text}</h4>`;
  if (variant === 'h5') return html`<h5 style=${styles}>${text}</h5>`;
  if (variant === 'label') return html`<label style=${styles}>${text}</label>`;
  if (variant === 'caption') return html`<span style=${styles}>${text}</span>`;

  return html`<div style=${styles}>${renderMarkdownBody(text)}</div>`;
};

const MATERIAL_SYMBOLS_HREF = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap';

function ensureMaterialSymbols(): void {
  if (!document.querySelector(`link[href="${MATERIAL_SYMBOLS_HREF}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = MATERIAL_SYMBOLS_HREF;
    document.head.appendChild(link);
  }
}

const ICON_SIZE_TOKENS: Record<string, string> = {
  sm: 'var(--freesail-icon-sm)', md: 'var(--freesail-icon-md)', lg: 'var(--freesail-icon-lg)',
  xl: 'var(--freesail-icon-xl)', '2xl': 'var(--freesail-icon-2xl)', '3xl': 'var(--freesail-icon-3xl)', '4xl': 'var(--freesail-icon-4xl)',
};

const toSnakeCase = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

/** Probes whether a Material Symbols ligature actually rendered as an icon glyph (vs. literal fallback text). */
function checkLigatureAndPatch(span: HTMLElement, ligature: string): void {
  document.fonts.load('24px "Material Symbols Outlined"').then(() => {
    const probe = document.createElement('span');
    Object.assign(probe.style, {
      position: 'absolute', top: '-9999px', left: '-9999px',
      fontFamily: "'Material Symbols Outlined', sans-serif",
      fontSize: '24px', whiteSpace: 'nowrap', visibility: 'hidden',
    });
    document.body.appendChild(probe);
    probe.textContent = ligature;
    const ligatureWidth = probe.getBoundingClientRect().width;
    probe.textContent = 'home';
    const referenceWidth = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);
    if (ligatureWidth > referenceWidth * 1.5) {
      span.textContent = 'help_outline';
    }
  });
}

export const Icon: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const rawName = component['name'];
  const name = typeof rawName === 'string' ? rawName : 'help';
  const rawSize = (component['size'] as string) ?? 'lg';
  const size = ICON_SIZE_TOKENS[rawSize] ?? rawSize;
  const color = getSemanticColor(component['color'] as string) ?? 'currentColor';
  ensureMaterialSymbols();

  const ligature = toSnakeCase(name);
  const style: CssDeclarations = {
    fontSize: size, color, lineHeight: '1', fontFamily: "'Material Symbols Outlined', sans-serif",
    fontWeight: 'normal', fontStyle: 'normal', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', width: size, height: size, verticalAlign: 'middle',
  };

  return html`<span
    style=${styleMap(style)}
    ${ref((el) => { if (el instanceof HTMLElement) checkLigatureAndPatch(el, ligature); })}
  >${ligature}</span>`;
};

// =============================================================================
// Interactive Components
// =============================================================================

function ensureButtonStyles(): void {
  const id = 'fs-button-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    .fs-btn { transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease, opacity 0.15s ease; }
    .fs-btn:active:not(:disabled) { transform: scale(0.97); }
    .fs-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--freesail-primary) 88%, #000) !important; box-shadow: 0 2px 8px color-mix(in srgb, var(--freesail-primary) 40%, transparent) !important; }
    .fs-btn-primary:active:not(:disabled) { background: color-mix(in srgb, var(--freesail-primary) 80%, #000) !important; box-shadow: none !important; }
    .fs-btn-secondary:hover:not(:disabled) { background: color-mix(in srgb, var(--freesail-bg-muted) 85%, #000) !important; box-shadow: 0 2px 6px rgba(0,0,0,0.1) !important; }
    .fs-btn-secondary:active:not(:disabled) { background: color-mix(in srgb, var(--freesail-bg-muted) 70%, #000) !important; box-shadow: none !important; }
    .fs-btn-outline:hover:not(:disabled) { background: color-mix(in srgb, var(--freesail-primary) 6%, transparent) !important; border-color: var(--freesail-primary-hover) !important; color: var(--freesail-primary-hover) !important; }
    .fs-btn-outline:active:not(:disabled) { background: color-mix(in srgb, var(--freesail-primary) 10%, transparent) !important; }
    .fs-btn-borderless:hover:not(:disabled) { background: color-mix(in srgb, var(--freesail-primary) 6%, transparent) !important; color: var(--freesail-primary-hover) !important; }
    .fs-btn-borderless:active:not(:disabled) { background: color-mix(in srgb, var(--freesail-primary) 10%, transparent) !important; }
    .fs-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--freesail-error) 88%, #000) !important; box-shadow: 0 2px 8px rgba(239,68,68,0.35) !important; }
    .fs-btn-danger:active:not(:disabled) { background: color-mix(in srgb, var(--freesail-error) 80%, #000) !important; box-shadow: none !important; }
  `;
  document.head.appendChild(style);
}

const BUTTON_VARIANT_STYLES: Record<string, CssDeclarations> = {
  primary:    { background: 'var(--freesail-primary)', color: 'var(--freesail-primary-foreground)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' },
  secondary:  { background: 'var(--freesail-bg-muted)', color: 'var(--freesail-text-foreground)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' },
  outline:    { background: 'transparent', border: '1px solid var(--freesail-border)', color: 'var(--freesail-text-foreground)' },
  borderless: { background: 'transparent', color: 'var(--freesail-text-foreground)', textDecoration: 'underline' },
  danger:     { background: 'var(--freesail-error)', color: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' },
};

export const Button: FreesailComponent = ({ component, children, onAction, onFunctionCall }: FreesailComponentProps) => {
  ensureButtonStyles();
  const label = children ?? (component['label'] as string) ?? 'Button';
  const variant = (component['variant'] as string) ?? 'primary';
  const disabled = (component['disabled'] as boolean) ?? false;
  const width = component['width'] as string | undefined;
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);
  const isDisabled = disabled || !!validationError;

  const action = component['action'] as
    | { event?: { name: string; context?: Record<string, unknown> }; functionCall?: any }
    | FunctionCall
    | undefined;
  const isFunctionCallAction = action && 'call' in action && !('event' in action);
  const eventAction = action && 'event' in action ? action : undefined;
  const actionName = eventAction?.event?.name ?? (!isFunctionCallAction ? (component['action'] as string) : undefined) ?? 'button_click';
  const actionContext = eventAction?.event?.context ?? {};

  const safeVariant = BUTTON_VARIANT_STYLES[variant] ? variant : 'primary';
  const style: CssDeclarations = {
    padding: 'var(--freesail-space-sm) var(--freesail-space-md)',
    borderRadius: 'var(--freesail-radius-md)', border: 'none',
    cursor: isDisabled ? 'not-allowed' : 'pointer', fontSize: 'var(--freesail-type-body)', fontWeight: '500',
    opacity: isDisabled ? '0.55' : '1', userSelect: 'none', outline: 'none', display: 'inline-flex',
    alignSelf: width ? 'auto' : 'flex-start', alignItems: 'center', justifyContent: 'center',
    gap: 'var(--freesail-space-xs)', lineHeight: '1', whiteSpace: 'nowrap',
    ...BUTTON_VARIANT_STYLES[safeVariant],
  };
  if (width) style['width'] = width;

  const handleClick = () => {
    if (isDisabled) return;
    if (action && 'functionCall' in action && (action as any).functionCall && onFunctionCall) {
      onFunctionCall((action as any).functionCall);
    } else if (action && 'call' in action && onFunctionCall) {
      onFunctionCall(action as FunctionCall);
    }
    if (onAction && !isFunctionCallAction) {
      onAction(actionName, actionContext);
    }
  };

  return html`<div style="display:contents">
    <button
      type="button"
      class="fs-btn fs-btn-${safeVariant}"
      style=${styleMap(style)}
      ?disabled=${isDisabled}
      title=${validationError || nothing}
      @click=${handleClick}
    >${label}</button>
  </div>`;
};

export const TextField: FreesailComponent = ({ component, meta, onDataChange }: FreesailComponentProps) => {
  const label = component['label'] as string | undefined;
  const width = component['width'] as string | undefined;
  const placeholder = (component['placeholder'] as string) ?? '';
  const variant = (component['variant'] as string) ?? 'shortText';
  const value = (component['value'] as string) ?? '';
  const min = component['min'] as number | undefined;
  const max = component['max'] as number | undefined;
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);
  const boundPath = meta.getBinding('value')?.path ?? null;

  const handleChange = (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (onDataChange && boundPath) onDataChange(boundPath, target.value);
  };

  const labelStyle: CssDeclarations = { fontSize: 'var(--freesail-type-label)', fontWeight: '500', color: 'var(--freesail-text-foreground)', whiteSpace: 'nowrap' };
  const inputStyle: CssDeclarations = {
    flex: '1', minWidth: '0', padding: 'var(--freesail-space-sm) var(--freesail-space-md)',
    borderRadius: 'var(--freesail-radius-md)', border: validationError ? '1px solid var(--freesail-error)' : '1px solid var(--freesail-border)',
    fontSize: 'var(--freesail-type-body)', boxSizing: 'border-box', backgroundColor: 'var(--freesail-bg)', color: 'var(--freesail-text-foreground)',
  };

  return html`
    <div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-xs)', width: width ?? '100%', minWidth: '0' })}>
      <div style=${styleMap({ display: 'flex', alignItems: variant === 'longText' ? 'flex-start' : 'center', gap: 'var(--freesail-space-sm)' })}>
        ${label ? html`<label style=${styleMap(labelStyle)}>${label}</label>` : nothing}
        ${variant === 'longText'
          ? html`<textarea placeholder=${placeholder} .value=${value} @input=${handleChange} style=${styleMap({ ...inputStyle, minHeight: '80px', resize: 'vertical' })}></textarea>`
          : html`<input
              type=${variant === 'obscured' ? 'password' : variant === 'number' ? 'number' : 'text'}
              placeholder=${placeholder}
              .value=${value}
              @input=${handleChange}
              min=${variant === 'number' && min != null ? min : nothing}
              max=${variant === 'number' && max != null ? max : nothing}
              style=${styleMap(inputStyle)}
            />`}
      </div>
      ${validationError ? html`<div style=${styleMap({ fontSize: 'var(--freesail-type-caption)', color: 'var(--freesail-error)' })}>${validationError}</div>` : nothing}
    </div>
  `;
};

// =============================================================================
// Form Components
// =============================================================================

export const DateInput: FreesailComponent = ({ component, meta, onDataChange }: FreesailComponentProps) => {
  const label = (component['label'] as string) ?? '';
  const rawMin = (component['min'] as string) ?? undefined;
  const rawMax = (component['max'] as string) ?? undefined;
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);
  const isRange = (component['mode'] as string) === 'range';
  const boundPath = meta.getBinding('value')?.path ?? null;
  const writePath = boundPath ?? `/input/${component.id}`;

  const valueArr = (component['value'] as string[] | undefined) ?? [];
  const singleValue = isRange ? '' : (valueArr[0] ?? '');
  const fromValue = isRange ? (valueArr[0] ?? '') : '';
  const toValue = isRange ? (valueArr[1] ?? '') : '';

  const fieldStyle: CssDeclarations = {
    padding: 'var(--freesail-space-sm) var(--freesail-space-md)', borderRadius: 'var(--freesail-radius-md)',
    border: fieldBorder(!!validationError), fontSize: 'var(--freesail-type-body)', backgroundColor: 'var(--freesail-bg)',
    color: 'var(--freesail-text-foreground)', flex: '1', minWidth: '0',
  };

  const onSingleChange = (e: Event) => onDataChange?.(writePath, [(e.target as HTMLInputElement).value].filter(Boolean));
  const onFromChange = (e: Event) => onDataChange?.(writePath, [(e.target as HTMLInputElement).value, toValue].filter(Boolean));
  const onToChange = (e: Event) => onDataChange?.(writePath, [fromValue, (e.target as HTMLInputElement).value].filter(Boolean));

  return html`
    <div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-xs)' })}>
      ${label ? html`<label style=${styleMap({ fontSize: 'var(--freesail-type-label)', fontWeight: '500' })}>${label}</label>` : nothing}
      ${isRange
        ? html`<div style=${styleMap({ display: 'flex', alignItems: 'center', gap: 'var(--freesail-space-sm)' })}>
            <input type="date" .value=${fromValue} min=${rawMin ?? nothing} max=${rawMax ?? nothing} @change=${onFromChange} style=${styleMap(fieldStyle)} />
            <span style="color:var(--freesail-text-secondary)">→</span>
            <input type="date" .value=${toValue} min=${rawMin ?? nothing} max=${rawMax ?? nothing} @change=${onToChange} style=${styleMap(fieldStyle)} />
          </div>`
        : html`<input type="date" .value=${singleValue} min=${rawMin ?? nothing} max=${rawMax ?? nothing} @change=${onSingleChange} style=${styleMap(fieldStyle)} />`}
      ${validationError ? html`<div style=${styleMap({ fontSize: 'var(--freesail-type-caption)', color: 'var(--freesail-error)' })}>${validationError}</div>` : nothing}
    </div>
  `;
};

export const TimeInput: FreesailComponent = ({ component, meta, onDataChange }: FreesailComponentProps) => {
  const label = (component['label'] as string) ?? '';
  const timeStep = Math.max(1, Math.min(60, Number(component['timeStep'] ?? 1)));
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);
  const boundPath = meta.getBinding('value')?.path ?? null;
  const writePath = boundPath ?? `/input/${component.id}`;
  const valueArr = (component['value'] as string[] | undefined) ?? [];
  const value = valueArr[0] ?? '';

  const onChange = (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    onDataChange?.(writePath, v ? [v] : []);
  };

  const fieldStyle: CssDeclarations = {
    padding: 'var(--freesail-space-sm) var(--freesail-space-md)', borderRadius: 'var(--freesail-radius-md)',
    border: fieldBorder(!!validationError), fontSize: 'var(--freesail-type-body)', backgroundColor: 'var(--freesail-bg)',
    color: 'var(--freesail-text-foreground)', width: '100%',
  };

  return html`
    <div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-xs)' })}>
      ${label ? html`<label style=${styleMap({ fontSize: 'var(--freesail-type-label)', fontWeight: '500', color: 'var(--freesail-text-foreground)' })}>${label}</label>` : nothing}
      <input type="time" .value=${value} step=${timeStep * 60} @change=${onChange} style=${styleMap(fieldStyle)} />
      ${validationError ? html`<div style=${styleMap({ fontSize: 'var(--freesail-type-caption)', color: 'var(--freesail-error)' })}>${validationError}</div>` : nothing}
    </div>
  `;
};

function ensureChoiceInputStyles(): void {
  const id = 'fs-choice-input-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    .fs-radio, .fs-checkbox {
      appearance: none; -webkit-appearance: none; margin: 0; flex-shrink: 0; cursor: pointer;
      width: 18px; height: 18px; border: 2px solid var(--freesail-border); background: var(--freesail-bg);
      display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
    }
    .fs-radio { border-radius: 50%; }
    .fs-checkbox { border-radius: var(--freesail-radius-sm); width: 16px; height: 16px; }
    .fs-radio:checked, .fs-checkbox:checked { border-color: var(--freesail-primary); background: var(--freesail-primary); }
    .fs-radio:checked::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--freesail-primary-foreground); }
    .fs-checkbox:checked::after {
      content: ''; width: 10px; height: 6px; margin-bottom: 2px;
      border-left: 2px solid var(--freesail-primary-foreground); border-bottom: 2px solid var(--freesail-primary-foreground);
      transform: rotate(-45deg);
    }
  `;
  document.head.appendChild(style);
}

export const ChoicePickerSingleSelect: FreesailComponent = ({ component, meta, onDataChange }: FreesailComponentProps) => {
  ensureChoiceInputStyles();
  const label = String((component['label'] as string) ?? '');
  const variant = (component['variant'] as string) ?? 'radio';
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);
  const options = parseOptions(component['options']);
  const rawValueList = component['value'];
  const value: string = typeof rawValueList === 'string' ? rawValueList : (Array.isArray(rawValueList) && rawValueList.length > 0 ? rawValueList[0] : '');
  const boundPath = meta.getBinding('value')?.path ?? null;
  const writePath = boundPath ?? `/input/${component.id}`;
  const groupName = `fs-radio-${sanitizeCssIdent(String(component.id))}`;

  const select = (val: string) => onDataChange?.(writePath, val);

  const body = variant === 'chips'
    ? html`<div style=${styleMap({ display: 'flex', flexWrap: 'wrap', gap: 'var(--freesail-space-sm)' })}>
        ${options.map((opt) => {
          const selected = value === opt.value;
          return html`<button type="button" @click=${() => select(opt.value)} style=${styleMap({
            borderRadius: '9999px', cursor: 'pointer', fontSize: 'var(--freesail-type-body)',
            border: `1px solid ${selected ? 'var(--freesail-primary)' : 'var(--freesail-border)'}`,
            backgroundColor: selected ? 'var(--freesail-primary)' : 'transparent',
            color: selected ? 'var(--freesail-primary-foreground)' : 'var(--freesail-text-foreground)',
            padding: '4px 12px',
          })}>${opt.label}</button>`;
        })}
      </div>`
    : html`<div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-xs)' })}>
        ${options.map((opt) => html`
          <label style=${styleMap({ display: 'flex', alignItems: 'center', gap: 'var(--freesail-space-sm)', cursor: 'pointer' })}>
            <input class="fs-radio" type="radio" name=${groupName} ?checked=${value === opt.value} @change=${() => select(opt.value)} />
            <span style="font-size:var(--freesail-type-body)">${opt.label}</span>
          </label>
        `)}
      </div>`;

  return html`
    <div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-sm)' })}>
      ${label ? html`<div style="font-size:var(--freesail-type-body);font-weight:500">${label}</div>` : nothing}
      ${body}
      ${validationError ? html`<div style=${styleMap({ fontSize: 'var(--freesail-type-caption)', color: 'var(--freesail-error)', marginTop: 'var(--freesail-space-xs)' })}>${validationError}</div>` : nothing}
    </div>
  `;
};

export const ChoicePickerMultiSelect: FreesailComponent = ({ component, meta, onDataChange }: FreesailComponentProps) => {
  ensureChoiceInputStyles();
  const label = String((component['label'] as string) ?? '');
  const variant = (component['variant'] as string) ?? 'checkbox';
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);
  const options = parseOptions(component['options']);
  const rawValueList = component['value'];
  const value: string[] = Array.isArray(rawValueList) ? rawValueList : [];
  const boundPath = meta.getBinding('value')?.path ?? null;
  const writePath = boundPath ?? `/input/${component.id}`;

  const toggle = (val: string, checked: boolean) => {
    const next = checked ? Array.from(new Set([...value, val])) : value.filter((v) => v !== val);
    onDataChange?.(writePath, next);
  };

  const body = variant === 'chips'
    ? html`<div style=${styleMap({ display: 'flex', flexWrap: 'wrap', gap: 'var(--freesail-space-sm)' })}>
        ${options.map((opt) => {
          const selected = value.includes(opt.value);
          return html`<button type="button" @click=${() => toggle(opt.value, !selected)} style=${styleMap({
            display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '9999px', cursor: 'pointer', fontSize: 'var(--freesail-type-body)',
            border: `1px solid ${selected ? 'var(--freesail-primary)' : 'var(--freesail-border)'}`,
            backgroundColor: selected ? 'var(--freesail-primary)' : 'transparent',
            color: selected ? 'var(--freesail-primary-foreground)' : 'var(--freesail-text-foreground)',
            padding: '4px 12px',
          })}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style=${styleMap({ visibility: selected ? 'visible' : 'hidden' })}><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${opt.label}
          </button>`;
        })}
      </div>`
    : html`<div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-xs)' })}>
        ${options.map((opt) => html`
          <label style=${styleMap({ display: 'flex', alignItems: 'center', gap: 'var(--freesail-space-sm)', cursor: 'pointer' })}>
            <input class="fs-checkbox" type="checkbox" ?checked=${value.includes(opt.value)} @change=${(e: Event) => toggle(opt.value, (e.target as HTMLInputElement).checked)} />
            <span style="font-size:var(--freesail-type-body)">${opt.label}</span>
          </label>
        `)}
      </div>`;

  return html`
    <div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-sm)' })}>
      ${label ? html`<div style="font-size:var(--freesail-type-body);font-weight:500">${label}</div>` : nothing}
      ${body}
      ${validationError ? html`<div style=${styleMap({ fontSize: 'var(--freesail-type-caption)', color: 'var(--freesail-error)', marginTop: 'var(--freesail-space-xs)' })}>${validationError}</div>` : nothing}
    </div>
  `;
};

export const CheckBox: FreesailComponent = ({ component, meta, onDataChange }: FreesailComponentProps) => {
  ensureChoiceInputStyles();
  const label = (component['label'] as string) ?? '';
  const checked = (component['value'] as boolean) ?? false;
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);
  const boundPath = meta.getBinding('value')?.path ?? null;
  const writePath = boundPath ?? `/input/${component.id}`;

  const onChange = (e: Event) => onDataChange?.(writePath, (e.target as HTMLInputElement).checked);

  return html`
    <div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-xs)' })}>
      <label style=${styleMap({ display: 'flex', alignItems: 'center', gap: 'var(--freesail-space-sm)', cursor: 'pointer' })}>
        <input class="fs-checkbox" type="checkbox" .checked=${checked} @change=${onChange} />
        <span>${label}</span>
      </label>
      ${validationError ? html`<div style=${styleMap({ fontSize: 'var(--freesail-type-caption)', color: 'var(--freesail-error)' })}>${validationError}</div>` : nothing}
    </div>
  `;
};

export const Slider: FreesailComponent = ({ component, meta, onDataChange }: FreesailComponentProps) => {
  const label = String((component['label'] as string) ?? '');
  const step = Number((component['step'] as number) ?? 1);
  const stepStr = step.toString();
  const dp = Math.min(stepStr.includes('.') ? (stepStr.split('.')[1] ?? '').length : 0, 2);
  const round = (n: number) => (dp > 0 ? parseFloat(n.toFixed(dp)) : n);
  const fmt = (n: number) => (dp > 0 ? n.toFixed(dp) : String(n));

  const min = round(Number((component['min'] as number) ?? 0));
  const max = round(Number((component['max'] as number) ?? 100));
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);
  const boundPath = meta.getBinding('value')?.path ?? null;
  const writePath = boundPath ?? `/input/${component.id}`;

  const rawValue = component['value'];
  const isMulti = Array.isArray(rawValue);
  const valueArray: number[] = isMulti ? (rawValue as unknown[]).map((v) => round(Number(v))) : [round(Number(rawValue ?? min))];
  const displayValue = isMulti ? valueArray.map(fmt).join(' – ') : fmt(valueArray[0] ?? min);
  const sliderWidth = `clamp(160px, ${(max - min) / (step || 1)}cqi, 100%)`;

  const onThumbChange = (index: number) => (e: Event) => {
    const v = round(Number((e.target as HTMLInputElement).value));
    const next = [...valueArray];
    next[index] = v;
    const out = dp > 0 ? next.map(fmt) : next;
    onDataChange?.(writePath, isMulti ? out : out[0]);
  };

  const rangeStyle: CssDeclarations = { flex: '1', accentColor: 'var(--freesail-primary)' };

  return html`
    <div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-xs)', width: sliderWidth })}>
      ${label ? html`<div style=${styleMap({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--freesail-space-lg)' })}>
          <label style="font-size:var(--freesail-type-body);font-weight:500">${label}</label>
          <span style="font-size:var(--freesail-type-label);color:var(--freesail-text-secondary);flex-shrink:0">${displayValue}</span>
        </div>` : nothing}
      <div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' })}>
        ${valueArray.map((v, i) => html`<input type="range" min=${min} max=${max} step=${step} .value=${String(v)} @input=${onThumbChange(i)} style=${styleMap(rangeStyle)} aria-label=${isMulti ? `${label} thumb ${i + 1}` : label} />`)}
      </div>
      ${!label ? html`<span style="font-size:var(--freesail-type-label);color:var(--freesail-text-secondary);text-align:right">${displayValue}</span>` : nothing}
      ${validationError ? html`<div style=${styleMap({ fontSize: 'var(--freesail-type-caption)', color: 'var(--freesail-error)' })}>${validationError}</div>` : nothing}
    </div>
  `;
};

export const Dropdown: FreesailComponent = ({ component, meta, onDataChange }: FreesailComponentProps) => {
  const label = component['label'] as string | undefined;
  const placeholder = (component['placeholder'] as string | undefined) ?? 'Select an option';
  const width = component['width'] as string | undefined;
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);
  const options = parseOptions(component['options']);
  const rawValueString = component['value'];
  const value: string = typeof rawValueString === 'string' ? rawValueString : '';
  const boundPath = meta.getBinding('value')?.path ?? null;
  const writePath = boundPath ?? `/input/${component.id}`;

  const onChange = (e: Event) => onDataChange?.(writePath, (e.target as HTMLSelectElement).value);

  const selectStyle: CssDeclarations = {
    display: 'block', padding: 'var(--freesail-space-sm) var(--freesail-space-md)', borderRadius: 'var(--freesail-radius-md)',
    border: fieldBorder(!!validationError), fontSize: 'var(--freesail-type-body)', backgroundColor: 'var(--freesail-bg)',
    color: value ? 'var(--freesail-text-foreground)' : 'var(--freesail-text-secondary)', cursor: 'pointer', width: '100%',
  };

  return html`
    <div style=${styleMap({ display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-xs)', width: width ?? '' })}>
      ${label ? html`<label style="font-size:var(--freesail-type-label);font-weight:500">${label}</label>` : nothing}
      <select .value=${value} @change=${onChange} style=${styleMap(selectStyle)}>
        <option value="" disabled ?selected=${!value}>${placeholder}</option>
        ${options.map((opt) => html`<option value=${opt.value} ?selected=${value === opt.value}>${opt.label}</option>`)}
      </select>
      ${validationError ? html`<div style=${styleMap({ fontSize: 'var(--freesail-type-caption)', color: 'var(--freesail-error)', marginTop: 'var(--freesail-space-xs)' })}>${validationError}</div>` : nothing}
    </div>
  `;
};

export const Spacer: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const rawWidth = component['width'] ?? '16px';
  const width = typeof rawWidth === 'number' ? `${rawWidth}px` : String(rawWidth);
  const rawHeight = component['height'] ?? '16px';
  const height = typeof rawHeight === 'number' ? `${rawHeight}px` : String(rawHeight);
  return html`<div style=${styleMap({ height, width })}></div>`;
};

function ensureModalStyles(): void {
  const id = 'fs-modal-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    dialog.fs-modal { border: none; padding: var(--freesail-space-lg); border-radius: var(--freesail-radius-lg); max-width: 90vw; max-height: 90vh; overflow: auto; box-shadow: var(--freesail-shadow-md); background: var(--freesail-bg-raised); color: var(--freesail-text-foreground); position: relative; }
    dialog.fs-modal::backdrop { background: rgba(0,0,0,0.5); }
  `;
  document.head.appendChild(style);
}

export const Modal: FreesailComponent = ({ component, children, onAction, onFunctionCall }: FreesailComponentProps) => {
  ensureModalStyles();
  const themeVars = applyComponentTheme(component['theme'] as Record<string, string> | undefined);

  const handleClose = () => {
    onFunctionCall?.({ call: 'hide', args: { componentId: component.id } });
    onAction?.('modal_closed', { componentId: component.id });
  };

  const dialogRef: Ref<HTMLDialogElement> = createRef();
  const openIfNeeded = (el: Element | undefined) => {
    if (!(el instanceof HTMLDialogElement) || el.open) return;
    // ref() fires while lit-html is still committing the clone into a detached
    // DocumentFragment, before it's appended to the live document — calling
    // showModal() synchronously here throws InvalidStateError ("not in a
    // Document"). Defer one microtask so the element is connected by the time
    // this runs.
    queueMicrotask(() => {
      if (el.isConnected && !el.open) el.showModal();
    });
  };
  const onDialogClick = (e: MouseEvent) => {
    if (e.target === dialogRef.value) handleClose();
  };

  return html`
    <dialog
      class="fs-modal"
      style=${styleMap(themeVars)}
      ${ref((el) => { (dialogRef as any).value = el; openIfNeeded(el); })}
      @close=${handleClose}
      @cancel=${handleClose}
      @click=${onDialogClick}
    >
      <button
        @click=${handleClose}
        aria-label="Close"
        style="position:absolute;top:var(--freesail-space-sm);right:var(--freesail-space-sm);cursor:pointer;border:none;background:none;font-size:var(--freesail-icon-lg);color:var(--freesail-text-secondary)"
      >&times;</button>
      ${children}
    </dialog>
  `;
};

// =============================================================================
// Shared Chart Helpers
// =============================================================================

const defaultPalette = [
  '#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
];

interface DataPoint {
  label: string;
  value: number;
  color?: string;
}

function parseData(raw: unknown): DataPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Record<string, unknown>) => ({
    label: String(item['label'] ?? ''),
    value: Number(item['value'] ?? 0),
    color: item['color'] != null ? String(item['color']) : undefined,
  }));
}

function chartTitle(title?: string): TemplateResult | typeof nothing {
  if (!title) return nothing;
  return html`<div style="font-size:var(--freesail-type-body);font-weight:600;color:var(--freesail-text-foreground);margin-bottom:var(--freesail-space-md)">${title}</div>`;
}

// =============================================================================
// Layout Components (grids)
// =============================================================================

export const FluidGrid: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
  const minItemWidth = sanitizeCssValue((component['minItemWidth'] as string) ?? '200px');
  const gap = sanitizeCssValue((component['gap'] as string) ?? 'var(--freesail-space-sm)');
  const style: CssDeclarations = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(min(${minItemWidth}, 100%), 1fr))`,
    gap, width: '100%', padding: 'var(--freesail-space-md)',
  };
  return html`<div style=${styleMap(style)}>${children}</div>`;
};

export const TabularGrid: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
  const uid = sanitizeCssIdent(String(component.id));
  const gridClass = `fs-grid-${uid}`;
  const wrapperClass = `${gridClass}-wrapper`;

  const headers = (component['headers'] as string[]) ?? [];
  const colCount = headers.length || (component['columns'] as number) || 1;
  const childArray = Array.isArray(children) ? children : children && children !== nothing ? [children] : [];
  const columnWeights = (component['columnWeights'] as number[]) ?? [];
  const rowPadding = sanitizeCssValue((component['rowPadding'] as string) ?? '10px 16px');

  const gridCols = columnWeights.length > 0
    ? Array.from({ length: colCount }, (_, i) => `minmax(min-content, ${columnWeights[i] ?? 1}fr)`).join(' ')
    : `repeat(${colCount}, minmax(min-content, 1fr))`;

  const hasHeaders = headers.length > 0;
  const showGridLines = component['showGridLines'] !== false;
  const showBorder = component['showBorder'] !== false;
  const themeVars = applyComponentTheme(component['theme'] as Record<string, string> | undefined);

  const styleContent = `
    .${wrapperClass}::-webkit-scrollbar { width: 10px; height: 10px; }
    .${wrapperClass}::-webkit-scrollbar-track { background: transparent; margin: 6px; }
    .${wrapperClass}::-webkit-scrollbar-thumb { background: var(--freesail-border); border-radius: 99px; border: 3px solid transparent; background-clip: content-box; }
    .${wrapperClass}::-webkit-scrollbar-thumb:hover { background: var(--freesail-text-secondary); background-clip: content-box; }
    .${wrapperClass} { scrollbar-width: thin; scrollbar-color: var(--freesail-border) transparent; }
    .${gridClass} { display: grid; grid-template-columns: ${gridCols}; min-width: 100%; font-size: var(--freesail-type-body); color: var(--freesail-text-foreground); }
    .${gridClass} > .fs-grid-row,
    .${gridClass} > .fs-grid-row > div,
    .${gridClass} > .fs-grid-row > div > div,
    .${gridClass} > .fs-grid-row > div > div > div,
    .${gridClass} > .fs-grid-row [data-freesail-weight],
    .${gridClass} > .fs-grid-row [data-freesail-component],
    .${gridClass} > .fs-grid-row [data-freesail-component] > div.fs-layout {
      display: contents !important;
    }
    .${gridClass} > .fs-grid-row [data-freesail-component] > *:not([data-freesail-component]) {
      display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: flex-start !important;
      padding: ${rowPadding};
      ${showGridLines ? 'border-bottom: 1px solid var(--freesail-border);' : ''}
    }
    ${hasHeaders ? `
    .${gridClass} > .fs-grid-row:nth-child(odd) [data-freesail-component] > *:not([data-freesail-component]) { background: var(--freesail-bg-raised) !important; }
    .${gridClass} > .fs-grid-row:nth-child(even) [data-freesail-component] > *:not([data-freesail-component]) { background: var(--freesail-bg-muted) !important; }` : ''}
    @container freesail-surface (max-width: 480px) {
      .${gridClass} { grid-template-columns: 1fr; }
      .${gridClass} > .fs-grid-row [data-freesail-component] > *:not([data-freesail-component]) { display: block; }
    }
  `;

  const wrapperStyle: CssDeclarations = {
    ...themeVars, width: '100%', overflowX: 'auto', overflowY: 'auto', padding: 'var(--freesail-space-md)',
    ...(showBorder ? { border: '1px solid var(--freesail-border)', borderRadius: 'var(--freesail-radius-md)' } : {}),
  };

  const headerCellStyle: CssDeclarations = {
    padding: 'var(--freesail-space-sm) var(--freesail-space-md)', textAlign: 'left', fontWeight: '600',
    fontSize: 'var(--freesail-type-caption)', textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--freesail-text-secondary)', background: 'var(--freesail-bg-muted)', borderBottom: '2px solid var(--freesail-border)',
  };

  return html`
    <style>${styleContent}</style>
    <div class=${wrapperClass} style=${styleMap(wrapperStyle)}>
      <div class=${gridClass}>
        ${headers.map((header) => {
          const headerText = typeof header === 'object' && header !== null && 'label' in (header as any) ? String((header as any).label) : String(header);
          return html`<div style=${styleMap(headerCellStyle)}>${headerText}</div>`;
        })}
        ${childArray.map((child) => html`<div class="fs-grid-row">${child}</div>`)}
      </div>
    </div>
  `;
};

export const List: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
  const maxHeight = (component['maxHeight'] as string) ?? 'auto';
  const style: CssDeclarations = {
    display: 'flex', flexDirection: 'column', gap: 'var(--freesail-space-sm)', maxHeight, padding: 'var(--freesail-space-md)',
  };
  if (maxHeight !== 'auto') style['overflowY'] = 'auto';
  return html`<div class="fs-layout" style=${styleMap(style)}>${children}</div>`;
};

export const Tab: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
  const title = (component['title'] as string) ?? 'Tab';
  return html`<div class="fs-tab-panel" data-tab-title=${title} style="display:contents">${children}</div>`;
};

function patchTabTitles(container: Element | undefined): void {
  if (!container) return;
  const panels = container.querySelectorAll<HTMLElement>('[data-tab-title]');
  panels.forEach((panel, i) => {
    const title = panel.dataset['tabTitle'];
    const labelEl = container.querySelector<HTMLElement>(`[data-fs-tab-label="${i}"]`);
    if (title && labelEl && labelEl.textContent !== title) labelEl.textContent = title;
  });
}

export const TabGroup: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
  const items = Array.isArray(children) ? children : children && children !== nothing ? [children] : [];
  const groupName = `fs-tabgroup-${sanitizeCssIdent(String(component.id))}`;

  const rules = items.map((_, i) => `
    #${groupName}-${i}:checked ~ .fs-tabgroup-headers label[for="${groupName}-${i}"] {
      border-bottom-color: var(--freesail-primary); color: var(--freesail-primary-hover); font-weight: 500;
    }
    #${groupName}-${i}:checked ~ .fs-tabgroup-panels > *:nth-child(${i + 1}) { display: block; }
  `).join('\n');

  return html`
    <style>
      .${groupName}-scope .fs-tabgroup-panels > * { display: none; }
      ${rules}
    </style>
    <div class="${groupName}-scope" style="display:flex;flex-direction:column" ${ref((el) => patchTabTitles(el))}>
      ${items.map((_, i) => html`<input type="radio" id="${groupName}-${i}" name=${groupName} ?checked=${i === 0} style="position:absolute;opacity:0;pointer-events:none" />`)}
      <div class="fs-tabgroup-headers" style="display:flex;border-bottom:1px solid var(--freesail-border);margin-bottom:var(--freesail-space-md)">
        ${items.map((_, i) => html`<label
          for="${groupName}-${i}"
          data-fs-tab-label=${i}
          style="padding:var(--freesail-space-sm) var(--freesail-space-md);cursor:pointer;border-bottom:2px solid transparent;color:var(--freesail-text-secondary);font-size:var(--freesail-type-body)"
        >Tab ${i + 1}</label>`)}
      </div>
      <div class="fs-tabgroup-panels" style="flex:1;min-height:0">
        ${items.map((item) => html`<div>${item}</div>`)}
      </div>
    </div>
  `;
};

// =============================================================================
// Media Components
// =============================================================================

export const Video: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const url = String((component['url'] as string) ?? '');
  const embed = Boolean(component['embed']);
  const style: CssDeclarations = { width: '100%', height: '100%', objectFit: 'contain', display: 'block', borderRadius: '8px' };

  if (embed) {
    const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
    if (youtubeMatch) {
      return html`<iframe src="https://www.youtube.com/embed/${youtubeMatch[1]}" style=${styleMap({ ...style, width: '100%', aspectRatio: '16 / 9', border: 'none' })} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    }
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
      return html`<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" style=${styleMap({ ...style, width: '100%', aspectRatio: '16 / 9', border: 'none' })} allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    }
    if (!isSafeUrl(url)) return html`<div style="color:var(--freesail-text-secondary);font-size:var(--freesail-type-body)">Invalid video URL</div>`;
    return html`<iframe src=${url} style=${styleMap({ ...style, width: '100%', aspectRatio: '16 / 9', border: 'none' })} allowfullscreen sandbox="allow-scripts allow-same-origin"></iframe>`;
  }

  if (!isSafeUrl(url)) return html`<div style="color:var(--freesail-text-secondary);font-size:var(--freesail-type-body)">Invalid video URL</div>`;
  return html`<video src=${url} controls style=${styleMap(style)}></video>`;
};

export const AudioPlayer: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const url = String((component['url'] as string) ?? '');
  const description = String((component['description'] as string) ?? '');
  const embed = Boolean(component['embed']);
  const descriptionEl = description ? html`<div style="font-size:var(--freesail-type-body);color:var(--freesail-text-secondary)">${description}</div>` : nothing;

  if (embed) {
    const spotifyMatch = url.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/);
    if (spotifyMatch) {
      const [, type, id] = spotifyMatch;
      return html`<div style="display:flex;flex-direction:column;gap:var(--freesail-space-sm);width:100%">
        ${descriptionEl}
        <iframe src="https://open.spotify.com/embed/${type}/${id}" style=${styleMap({ width: '100%', height: type === 'track' ? '152px' : '352px', border: 'none', borderRadius: '12px' })} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
      </div>`;
    }
    if (url.includes('soundcloud.com')) {
      return html`<div style="display:flex;flex-direction:column;gap:var(--freesail-space-sm);width:100%">
        ${descriptionEl}
        <iframe src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&show_artwork=true" style="width:100%;height:166px;border:none" allow="autoplay"></iframe>
      </div>`;
    }
    if (!isSafeUrl(url)) return html`<div style="color:var(--freesail-text-secondary);font-size:var(--freesail-type-body)">Invalid audio URL</div>`;
    return html`<div style="display:flex;flex-direction:column;gap:var(--freesail-space-sm);width:100%">
      ${descriptionEl}
      <iframe src=${url} style="width:100%;height:166px;border:none;border-radius:12px" allow="autoplay" sandbox="allow-scripts allow-same-origin"></iframe>
    </div>`;
  }

  if (!isSafeUrl(url)) return html`<div style="color:var(--freesail-text-secondary);font-size:var(--freesail-type-body)">Invalid audio URL</div>`;
  return html`<div style="display:flex;flex-direction:column;gap:8px;width:100%">
    ${descriptionEl}
    <audio src=${url} controls style="width:100%"></audio>
  </div>`;
};

// =============================================================================
// Display Components
// =============================================================================

export const Image: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const src = String((component['src'] as string) ?? (component['url'] as string) ?? '');
  const alt = String((component['alt'] as string) ?? '');

  if (!isSafeUrl(src)) {
    return html`<div style="color:var(--freesail-text-secondary);font-size:var(--freesail-type-body)">Invalid image URL</div>`;
  }

  const fit = (component['fit'] as string) ?? 'contain';
  const style: CssDeclarations = {
    width: (component['width'] as string) ?? '100%', height: (component['height'] as string) ?? '100%',
    objectFit: fit, display: 'block', borderRadius: (component['borderRadius'] as string) ?? '0',
  };

  const onError = (e: Event) => {
    const img = e.target as HTMLImageElement;
    img.outerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:40px;color:var(--freesail-border)">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M21 5v6.59l-3-3.01-4 4.01-4-4-4 4-3-3.01V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2zm-3 6.42 3 3.01V19c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2v-6.58l3 2.99 4-4 4 4 4-3.99z"/><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </div>`;
  };

  return html`<img src=${src} alt=${alt} style=${styleMap(style)} @error=${onError} />`;
};

export const Divider: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const axis = (component['axis'] as string) ?? 'horizontal';
  const color = getSemanticColor(component['color'] as string) ?? 'var(--freesail-border)';

  if (axis === 'vertical') {
    return html`<div style=${styleMap({ width: '1px', alignSelf: 'stretch', backgroundColor: color, margin: '0 var(--freesail-space-sm)' })}></div>`;
  }
  const style: CssDeclarations = { border: 'none', borderTop: `1px solid ${color}`, margin: (component['margin'] as string) ?? 'var(--freesail-space-md) 0', width: '100%' };
  return html`<hr style=${styleMap(style)} />`;
};

// =============================================================================
// Chart Components
// =============================================================================

export const BarChart: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const title = component['title'] as string | undefined;
  const data = parseData(component['data']);
  const orientation = (component['orientation'] as string) ?? 'vertical';
  const defaultColor = getSemanticColor(component['color'] as string) ?? '#2563eb';
  const showValues = component['showValues'] !== false;
  const CHART_H = typeof component['chartHeight'] === 'number' ? component['chartHeight'] : 244;
  const heightProp = component['height'] as string | undefined;
  const widthProp = component['width'] as string | undefined;

  if (data.length === 0) {
    return html`<div style="color:var(--freesail-text-secondary);font-size:var(--freesail-type-body)">No chart data</div>`;
  }
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const containerStyle = styleMap({ display: 'flex', flexDirection: 'column', width: widthProp ?? (heightProp ? 'fit-content' : '100%'), minWidth: '0' });

  if (orientation === 'horizontal') {
    const barHeight = 28, gap = 8;
    const labelWidth = Math.min(200, Math.max(80, Math.max(...data.map((d) => d.label.length)) * 7));
    const svgHeight = data.length * (barHeight + gap) - gap;
    const chartWidth = 300;
    const svgStyle = styleMap({ overflow: 'visible', display: 'block', ...(!heightProp && { aspectRatio: `${labelWidth + chartWidth + 60} / ${svgHeight}` }) });

    return html`<div style=${containerStyle}>
      ${chartTitle(title)}
      <svg viewBox="0 0 ${labelWidth + chartWidth + 60} ${svgHeight}" preserveAspectRatio="xMinYMin meet"
        width=${heightProp ? nothing : '100%'} height=${heightProp ?? nothing} style=${svgStyle}>
        ${data.map((d, i) => {
          const y = i * (barHeight + gap);
          const barW = (d.value / maxVal) * chartWidth;
          const fill = d.color ?? defaultColor;
          return svg`<g>
            <text x=${labelWidth - 8} y=${y + barHeight / 2} text-anchor="end" dominant-baseline="central" font-size="12" fill="var(--freesail-text-secondary)">${d.label}</text>
            <rect x=${labelWidth} y=${y} width=${barW} height=${barHeight} rx="4" fill=${fill} opacity="0.85" />
            ${showValues ? svg`<text x=${labelWidth + barW + 6} y=${y + barHeight / 2} dominant-baseline="central" font-size="12" font-weight="500" fill="var(--freesail-text-foreground)">${d.value.toLocaleString()}</text>` : nothing}
          </g>`;
        })}
      </svg>
    </div>`;
  }

  const gridLines = 4;
  const gridVals = Array.from({ length: gridLines + 1 }, (_, i) => Math.round((maxVal / gridLines) * i));
  const maxYLabelLen = Math.max(...gridVals.map((v) => v.toLocaleString().length));
  const yAxisLeftPad = Math.max(40, maxYLabelLen * 7 + 12);
  const svgWidth = 500;
  const chartWEst = svgWidth - yAxisLeftPad - 16;
  const stepEst = chartWEst / data.length;
  const maxXLabelLen = Math.max(...data.map((d) => d.label.length));
  const rotateLabels = maxXLabelLen * 7 > stepEst * 0.9;
  const firstLabelBleed = rotateLabels ? Math.ceil((data[0]?.label.length ?? 0) * 4.95) : 0;
  const leftPad = Math.max(yAxisLeftPad, firstLabelBleed);
  const bottomPad = rotateLabels ? Math.min(120, Math.round(maxXLabelLen * 4.5) + 8) : 40;
  const svgHeight = 16 + CHART_H + bottomPad;
  const padding = { top: 16, right: 16, bottom: bottomPad, left: leftPad };
  const chartW = svgWidth - padding.left - padding.right;
  const chartH = CHART_H;
  const barWidth = Math.min(40, (chartW / data.length) * 0.6);
  const step = chartW / data.length;
  const svgStyle = styleMap({ overflow: 'visible', display: 'block', ...(!heightProp && { aspectRatio: `${svgWidth} / ${svgHeight}` }) });

  return html`<div style=${containerStyle}>
    ${chartTitle(title)}
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMinYMin meet"
      width=${heightProp ? nothing : '100%'} height=${heightProp ?? nothing} style=${svgStyle}>
      ${gridVals.map((v) => {
        const y = padding.top + chartH - (v / maxVal) * chartH;
        return svg`<g>
          <line x1=${padding.left} y1=${y} x2=${svgWidth - padding.right} y2=${y} stroke="var(--freesail-border)" stroke-width="1" />
          <text x=${padding.left - 8} y=${y} text-anchor="end" dominant-baseline="central" font-size="11" fill="var(--freesail-text-secondary)">${v.toLocaleString()}</text>
        </g>`;
      })}
      ${data.map((d, i) => {
        const x = padding.left + i * step + (step - barWidth) / 2;
        const barH = (d.value / maxVal) * chartH;
        const y = padding.top + chartH - barH;
        const fill = d.color ?? defaultColor;
        const labelY = padding.top + chartH + 16;
        return svg`<g>
          <rect x=${x} y=${y} width=${barWidth} height=${barH} rx="3" fill=${fill} opacity="0.85" />
          ${showValues ? svg`<text x=${x + barWidth / 2} y=${y - 6} text-anchor="middle" font-size="11" font-weight="500" fill="var(--freesail-text-foreground)">${d.value.toLocaleString()}</text>` : nothing}
          ${rotateLabels
            ? svg`<text x=${x + barWidth / 2} y=${labelY} text-anchor="end" font-size="11" transform="rotate(-45 ${x + barWidth / 2} ${labelY})" fill="var(--freesail-text-secondary)">${d.label}</text>`
            : svg`<text x=${x + barWidth / 2} y=${labelY} text-anchor="middle" font-size="11" fill="var(--freesail-text-secondary)">${d.label}</text>`}
        </g>`;
      })}
    </svg>
  </div>`;
};

export const LineChart: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const title = component['title'] as string | undefined;
  const data = parseData(component['data']);
  const color = getSemanticColor(component['color'] as string) ?? '#2563eb';
  const showDots = component['showDots'] !== false;
  const showArea = component['showArea'] === true;
  const CHART_H = typeof component['chartHeight'] === 'number' ? component['chartHeight'] : 244;
  const heightProp = component['height'] as string | undefined;
  const widthProp = component['width'] as string | undefined;

  if (data.length < 2) {
    return html`<div style="color:var(--freesail-text-secondary);font-size:var(--freesail-type-body)">Need at least 2 data points</div>`;
  }

  const svgWidth = 500;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const minVal = Math.min(...data.map((d) => d.value), 0);
  const range = maxVal - minVal || 1;
  const gridLines = 4;
  const gridVals = Array.from({ length: gridLines + 1 }, (_, i) => minVal + (range / gridLines) * i);
  const maxYLabelLen = Math.max(...gridVals.map((v) => Math.round(v).toLocaleString().length));
  const yAxisLeftPad = Math.max(40, maxYLabelLen * 7 + 12);
  const chartWEst = svgWidth - yAxisLeftPad - 16;
  const stepWEst = data.length > 1 ? chartWEst / (data.length - 1) : chartWEst;
  const maxXLabelLen = Math.max(...data.map((d) => d.label.length));
  const rotateLabels = maxXLabelLen * 7 > stepWEst * 0.9;
  const firstLabelBleed = rotateLabels ? Math.ceil((data[0]?.label.length ?? 0) * 4.95) : 0;
  const leftPad = Math.max(yAxisLeftPad, firstLabelBleed);
  const bottomPad = rotateLabels ? Math.min(120, Math.round(maxXLabelLen * 4.5) + 8) : 40;
  const svgHeight = 16 + CHART_H + bottomPad;
  const padding = { top: 16, right: 16, bottom: bottomPad, left: leftPad };
  const chartW = svgWidth - padding.left - padding.right;
  const chartH = CHART_H;

  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartW,
    y: padding.top + chartH - ((d.value - minVal) / range) * chartH,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = linePath + ` L${points[points.length - 1]!.x},${padding.top + chartH} L${points[0]!.x},${padding.top + chartH} Z`;
  const gradId = `area-grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  const svgStyle = styleMap({ overflow: 'visible', display: 'block', ...(!heightProp && { aspectRatio: `${svgWidth} / ${svgHeight}` }) });

  return html`<div style=${styleMap({ display: 'flex', flexDirection: 'column', width: widthProp ?? (heightProp ? 'fit-content' : '100%'), minWidth: '0' })}>
    ${chartTitle(title)}
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMinYMin meet"
      width=${heightProp ? nothing : '100%'} height=${heightProp ?? nothing} style=${svgStyle}>
      <defs>
        <linearGradient id=${gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color=${color} stop-opacity="0.25" />
          <stop offset="100%" stop-color=${color} stop-opacity="0.02" />
        </linearGradient>
      </defs>
      ${gridVals.map((v) => {
        const y = padding.top + chartH - ((v - minVal) / range) * chartH;
        return svg`<g>
          <line x1=${padding.left} y1=${y} x2=${svgWidth - padding.right} y2=${y} stroke="var(--freesail-border)" stroke-width="1" />
          <text x=${padding.left - 8} y=${y} text-anchor="end" dominant-baseline="central" font-size="11" fill="var(--freesail-text-secondary)">${Math.round(v).toLocaleString()}</text>
        </g>`;
      })}
      ${showArea ? svg`<path d=${areaPath} fill="url(#${gradId})" />` : nothing}
      <path d=${linePath} fill="none" stroke=${color} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${showDots ? points.map((p) => svg`<circle cx=${p.x} cy=${p.y} r="4" fill="white" stroke=${color} stroke-width="2" />`) : nothing}
      ${data.map((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartW;
        if (data.length > 10 && i % Math.ceil(data.length / 10) !== 0 && i !== data.length - 1) return nothing;
        const labelY = padding.top + chartH + 16;
        return rotateLabels
          ? svg`<text x=${x} y=${labelY} text-anchor="end" font-size="11" transform="rotate(-45 ${x} ${labelY})" fill="var(--freesail-text-secondary)">${d.label}</text>`
          : svg`<text x=${x} y=${labelY} text-anchor="middle" font-size="11" fill="var(--freesail-text-secondary)">${d.label}</text>`;
      })}
    </svg>
  </div>`;
};

export const PieChart: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const title = component['title'] as string | undefined;
  const data = parseData(component['data']);
  const donut = component['donut'] === true;
  const size = (component['size'] as number) ?? 250;

  if (data.length === 0) {
    return html`<div style="color:var(--freesail-text-secondary);font-size:var(--freesail-type-body)">No chart data</div>`;
  }

  const total = data.reduce((sum, d) => sum + Math.abs(d.value), 0) || 1;
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = donut ? outerR * 0.55 : 0;

  let currentAngle = -Math.PI / 2;
  const segments = data.map((d, i) => {
    const fraction = Math.abs(d.value) / total;
    const angle = fraction * 2 * Math.PI;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = cx + outerR * Math.cos(startAngle), y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle), y2 = cy + outerR * Math.sin(endAngle);
    let path: string;
    if (innerR > 0) {
      const ix1 = cx + innerR * Math.cos(endAngle), iy1 = cy + innerR * Math.sin(endAngle);
      const ix2 = cx + innerR * Math.cos(startAngle), iy2 = cy + innerR * Math.sin(startAngle);
      path = `M${x1},${y1} A${outerR},${outerR} 0 ${largeArc} 1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z`;
    } else {
      path = `M${cx},${cy} L${x1},${y1} A${outerR},${outerR} 0 ${largeArc} 1 ${x2},${y2} Z`;
    }
    return { path, color: getSemanticColor(d.color) ?? defaultPalette[i % defaultPalette.length]!, label: d.label, percentage: Math.round(fraction * 100) };
  });

  const align = (component['align'] as string) ?? 'start';
  const justifyMap: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end' };
  const justify = justifyMap[align] ?? 'flex-start';

  return html`<div style="display:flex;flex-direction:column;width:100%;min-width:0">
    ${chartTitle(title)}
    <div style=${styleMap({ display: 'flex', alignItems: 'center', justifyContent: justify, gap: 'var(--freesail-space-lg)', flexWrap: 'wrap', width: '100%' })}>
      <svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" style=${styleMap({ flex: '1 1 0', maxWidth: `${size}px`, minWidth: `${Math.round(size / 2)}px`, aspectRatio: '1 / 1', overflow: 'visible', display: 'block' })}>
        ${segments.map((seg) => svg`<path d=${seg.path} fill=${seg.color} stroke="white" stroke-width="2" />`)}
      </svg>
      <div style="display:flex;flex-direction:column;gap:var(--freesail-space-xs);flex-shrink:0">
        ${segments.map((seg) => html`<div style="display:flex;align-items:center;gap:var(--freesail-space-sm);font-size:var(--freesail-type-label);white-space:nowrap">
          <div style=${styleMap({ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: seg.color, flexShrink: '0' })}></div>
          <span style="color:var(--freesail-text-foreground)">${seg.label}</span>
          <span style="color:var(--freesail-text-secondary)">${seg.percentage}%</span>
        </div>`)}
      </div>
    </div>
  </div>`;
};

export const Sparkline: FreesailComponent = ({ component }: FreesailComponentProps) => {
  const values = (component['values'] as number[]) ?? [];
  const color = getSemanticColor(component['color'] as string) ?? '#2563eb';
  const width = parseInt(String(component['width'] ?? 120), 10) || 120;
  const height = parseInt(String(component['height'] ?? 32), 10) || 32;

  if (!Array.isArray(values) || values.length < 2) {
    return html`<div style=${styleMap({ width: `${width}px`, height: `${height}px` })}></div>`;
  }

  const nums = values.map(Number);
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min || 1;
  const pad = 2;
  const points = nums.map((v, i) => ({
    x: pad + (i / (nums.length - 1)) * (width - pad * 2),
    y: pad + (1 - (v - min) / range) * (height - pad * 2),
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const last = points[points.length - 1]!;

  return html`<svg width=${width} height=${height} viewBox="0 0 ${width} ${height}" style="display:block">
    <path d=${linePath} fill="none" stroke=${color} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx=${last.x} cy=${last.y} r="2.5" fill=${color} />
  </svg>`;
};

export const StatCard: FreesailComponent = ({ component, children }: FreesailComponentProps) => {
  ensureMaterialSymbols();
  const label = (component['label'] as string) ?? '';
  const value = (component['value'] as string) ?? '';
  const trend = component['trend'] as string | undefined;
  const trendValue = component['trendValue'] as string | undefined;
  const accentColor = getSemanticColor(component['color'] as string) ?? 'var(--freesail-primary)';
  const width = component['width'] as string | undefined;
  const defaultTrendColor = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : 'var(--freesail-text-secondary)';
  const trendColor = getSemanticColor(component['trendColor'] as string) ?? defaultTrendColor;

  const cardStyle: CssDeclarations = {
    flex: width ? '0 0 auto' : '0 1 auto', minWidth: '200px', padding: 'var(--freesail-space-md)',
    borderRadius: '12px', border: '1px solid var(--freesail-border)', backgroundColor: 'var(--freesail-bg-raised)',
    borderLeft: `4px solid ${accentColor}`, alignSelf: 'stretch', overflow: 'hidden',
  };
  if (width) cardStyle['width'] = width;

  const trendIcon = trend === 'up' ? 'arrow_upward' : trend === 'down' ? 'arrow_downward' : 'arrow_forward';

  return html`<div style=${styleMap(cardStyle)}>
    <div style="font-size:var(--freesail-type-label);color:var(--freesail-text-secondary);margin-bottom:var(--freesail-space-xs);white-space:nowrap;text-overflow:ellipsis;overflow:hidden">${label}</div>
    <div style="font-size:var(--freesail-type-h2);font-weight:700;color:var(--freesail-text-foreground);line-height:1.2;min-height:1.2em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${value || ' '}</div>
    <div style=${styleMap({ display: 'flex', alignItems: 'center', gap: 'var(--freesail-space-xs)', marginTop: 'var(--freesail-space-xs)', fontSize: 'var(--freesail-type-body)', fontWeight: '600', color: trendColor, visibility: trend || trendValue ? 'visible' : 'hidden' })}>
      <span style=${styleMap({ fontFamily: "'Material Symbols Outlined'", fontSize: 'var(--freesail-icon-sm)', lineHeight: '1', color: trendColor, flexShrink: '0' })}>${trendIcon}</span>
      ${trendValue ? html`<span>${trendValue}</span>` : html`<span>&nbsp;</span>`}
    </div>
    ${children}
  </div>`;
};

// =============================================================================
// Export catalog components map
// =============================================================================

export const standardCatalogComponents: Record<string, FreesailComponent> = {
  Column, Row, Card, Text, Button, TextField, Icon, DateInput, TimeInput, Modal, Spacer,
  ChoicePickerSingleSelect, ChoicePickerMultiSelect,
  FluidGrid, TabularGrid, CheckBox, Image, Divider, List, Tab, TabGroup,
  Video, AudioPlayer, Slider, Dropdown, BarChart, LineChart, PieChart, Sparkline, StatCard,
};
