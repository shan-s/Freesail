/**
 * @fileoverview Renders all active surfaces (mirrors example/react-app's SurfaceList),
 * using @freesail/lit's SurfacesController (the Lit analogue of ReactUI.useSurfaces()).
 * Must be rendered as a descendant of <freesail-provider> in the DOM.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { SurfacesController } from '@freesail/lit';

export class AppSurfacesElement extends LitElement {
  private readonly _surfaces: SurfacesController;

  constructor() {
    super();
    this._surfaces = new SurfacesController(this);
  }

  override createRenderRoot(): this {
    return this;
  }

  override render(): TemplateResult | typeof nothing {
    // "__chat" is bootstrapped eagerly by <lit-app-chat> and has its own
    // dedicated panel — exclude it here so it isn't rendered twice.
    const surfaces = this._surfaces.surfaces.filter((s) => s.id !== '__chat');
    if (surfaces.length === 0) return nothing;

    return html`
      <div style="display:flex;flex-direction:column;gap:20px">
        ${surfaces.map((s) => html`<freesail-surface surface-id=${s.id} class="surface-container"></freesail-surface>`)}
      </div>
    `;
  }
}

if (!customElements.get('lit-app-surfaces')) {
  customElements.define('lit-app-surfaces', AppSurfacesElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'lit-app-surfaces': AppSurfacesElement;
  }
}
