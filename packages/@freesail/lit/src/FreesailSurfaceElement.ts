/**
 * @fileoverview FreesailSurfaceElement (<freesail-surface>)
 *
 * The element that renders a single A2UI surface. Users drop this into their
 * app (as a descendant of <freesail-provider>) to display agent-driven UI.
 * This is the Lit analogue of @freesail/react's FreesailSurface component.
 *
 * Renders in the light DOM (no shadow root) so that developer-supplied
 * `class` targeting works via ordinary global CSS (parity with React's
 * `className` prop), and so components like TabularGrid can inject their own
 * scoped `<style>` tag without fighting shadow-root style scoping.
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import {
  resolveTokens,
  tokensToCssVars,
  surfaceThemeToCssVars,
} from '@freesail/core';
import type { SurfaceId, ComponentId, FreesailThemeProp, FreesailThemeMode, FreesailSurfaceTheme } from '@freesail/core';
import { registry } from './registry.js';
import { renderComponent } from './render-tree.js';
import { SurfaceController, dispatchSurfaceAction } from './controllers.js';
import { FREESAIL_LOGO_DATA_URI } from './logo.js';

export type SurfaceTemplateFactory = () => TemplateResult;

const defaultLoadingTemplate: SurfaceTemplateFactory = () => html`
  <div style=${styleMap({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 16px',
    gap: '16px',
  })}>
    <style>
      @keyframes freesail-pulse {
        0%, 100% { opacity: 0.4; transform: scale(0.95); }
        50% { opacity: 1; transform: scale(1); }
      }
      @keyframes freesail-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
    ${FREESAIL_LOGO_DATA_URI
      ? html`<img src=${FREESAIL_LOGO_DATA_URI} alt="Loading" style="width:48px;height:48px;animation:freesail-pulse 1.5s ease-in-out infinite" />`
      : html`<div style="width:32px;height:32px;border:3px solid var(--freesail-border, #e2e8f0);border-top-color:var(--freesail-primary, #2563eb);border-radius:50%;animation:freesail-spin 0.8s linear infinite"></div>`}
  </div>
`;

const defaultErrorTemplate: SurfaceTemplateFactory = () => html`
  <div style="padding:16px;color:#c00">Error: Unable to render surface</div>
`;

/**
 * Renders a single A2UI surface.
 *
 * Subscribes to surface updates (via SurfaceController) and automatically
 * re-renders when the component tree or data model changes.
 *
 * Usage:
 * ```html
 * <freesail-provider>
 *   <freesail-surface surface-id="main"></freesail-surface>
 * </freesail-provider>
 * ```
 */
export class FreesailSurfaceElement extends LitElement {
  static override properties = {
    surfaceId: { attribute: 'surface-id', type: String },
    theme: { attribute: false },
    loadingTemplate: { attribute: false },
    errorTemplate: { attribute: false },
    emptyTemplate: { attribute: false },
  };

  /** The surface ID to render. */
  surfaceId: SurfaceId;
  /** Optional theme override for this specific surface. */
  theme?: FreesailThemeProp;
  /** Loading state template factory (surface doesn't exist yet). Defaults to the Freesail spinner. */
  loadingTemplate: SurfaceTemplateFactory;
  /** Error state template factory (catalog not registered). Defaults to a plain error message. */
  errorTemplate: SurfaceTemplateFactory;
  /** Empty state template factory (surface exists but has no components). Defaults to the loading template. */
  emptyTemplate: SurfaceTemplateFactory;

  private readonly _surfaceController: SurfaceController;

  constructor() {
    super();
    this.surfaceId = '' as SurfaceId;
    this.loadingTemplate = defaultLoadingTemplate;
    this.errorTemplate = defaultErrorTemplate;
    this.emptyTemplate = defaultLoadingTemplate;
    this._surfaceController = new SurfaceController(this, this.surfaceId);
  }

  override createRenderRoot(): this {
    return this;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('surfaceId')) {
      this._surfaceController.setSurfaceId(this.surfaceId);
    }
  }

  private _developerThemeCssVars(): Record<string, string> {
    if (!this.theme) return {};
    const tokens = resolveTokens(this.theme);
    if (!tokens) return {};
    const mode: FreesailThemeMode = typeof this.theme === 'string' ? (this.theme as FreesailThemeMode) : 'light';
    return tokensToCssVars(tokens, mode);
  }

  override render(): TemplateResult {
    const { surface, context } = this._surfaceController;
    const developerThemeCssVars = this._developerThemeCssVars();

    // Loading state — context not resolved yet, or surface doesn't exist yet
    if (!context || !surface) {
      return html`<div style=${styleMap({ flex: '1', minHeight: '0', ...developerThemeCssVars })}>${this.loadingTemplate()}</div>`;
    }

    // Empty state — surface exists but no components
    if (surface.components.size === 0 || !surface.rootId) {
      return html`<div style=${styleMap({ flex: '1', minHeight: '0', ...developerThemeCssVars })}>${this.emptyTemplate()}</div>`;
    }

    // Check if catalog is registered
    if (!registry.hasCatalog(surface.catalogId)) {
      console.error(`[Freesail] Catalog not registered: ${surface.catalogId}`);
      return html`<div style=${styleMap({ flex: '1', minHeight: '0', ...developerThemeCssVars })}>${this.errorTemplate()}</div>`;
    }

    const dispatch = dispatchSurfaceAction(context, this.surfaceId);
    const onDataChange = (path: string, value: unknown) => {
      context.surfaceManager.updateDataModel(this.surfaceId, path, value);
    };

    const renderedTree = renderComponent(
      surface.rootId,
      surface.components,
      surface.catalogId,
      surface.dataModel,
      surface.dataUpdateTimestamps,
      dispatch,
      onDataChange
    );

    const rootComponent = surface.components.get('root' as ComponentId);
    const agentSurfaceTheme = rootComponent?.['theme'] as FreesailSurfaceTheme | undefined;
    const agentCssVars = agentSurfaceTheme ? surfaceThemeToCssVars(agentSurfaceTheme) : {};

    const surfaceStyle: Record<string, string> = {
      flex: '1',
      minHeight: '0',
      display: 'flex',
      flexDirection: 'column',
      containerType: 'inline-size',
      containerName: 'freesail-surface',
      ...developerThemeCssVars,
      ...agentCssVars,
    };

    return html`<div data-freesail-surface=${this.surfaceId} style=${styleMap(surfaceStyle)}>${renderedTree}</div>`;
  }
}

if (!customElements.get('freesail-surface')) {
  customElements.define('freesail-surface', FreesailSurfaceElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'freesail-surface': FreesailSurfaceElement;
  }
}
