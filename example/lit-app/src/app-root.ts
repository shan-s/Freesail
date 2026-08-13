/**
 * @fileoverview Example Lit Application using Freesail
 *
 * This example shows how to integrate Freesail into a Lit / Web Components
 * application to enable AI agents to drive the UI using the A2UI v0.9 protocol.
 * Mirrors example/react-app/src/App.tsx, scoped to @freesail/standard-catalog-lit
 * (chat-catalog and weather-catalog have no Lit port yet).
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import {
  defaultLightTokens,
  defaultDarkTokens,
  type FreesailThemeTokens,
  type CatalogDefinition,
} from '@freesail/lit';
import { StandardCatalog } from '@freesail/standard-catalog-lit';
import './app-header.js';
import './app-surfaces.js';
import './app-chat.js';

type ThemeMode = 'light' | 'dark' | 'custom';
type FontSize = 'normal' | 'large';

const ALL_CATALOGS: CatalogDefinition[] = [StandardCatalog];

const TYPE_SCALE_KEYS: (keyof FreesailThemeTokens)[] = [
  'typeCaption', 'typeLabel', 'typeBody', 'typeH5', 'typeH4', 'typeH3', 'typeH2', 'typeH1',
];

function bumpFontScale(tokens: FreesailThemeTokens, levels: number): Partial<FreesailThemeTokens> {
  const factor = Math.pow(1.125, levels);
  const result: Partial<FreesailThemeTokens> = {};
  for (const key of TYPE_SCALE_KEYS) {
    const val = tokens[key];
    const match = val.match(/clamp\((\d+(?:\.\d+)?)px,\s*([\d.]+)(cqi),\s*(\d+(?:\.\d+)?)px\)/);
    if (match) {
      const min = Math.round(parseFloat(match[1]!) * factor);
      const mid = Math.round(parseFloat(match[2]!) * factor * 10) / 10;
      const max = Math.round(parseFloat(match[4]!) * factor);
      (result as Record<string, string>)[key] = `clamp(${min}px, ${mid}${match[3]}, ${max}px)`;
    }
  }
  return result;
}

const FONT_SCALES: Record<FontSize, Partial<FreesailThemeTokens>> = {
  normal: {},
  large: bumpFontScale(defaultLightTokens, 2),
};

// A custom hot-pink theme just to show overrides working
const customThemeProps: Partial<FreesailThemeTokens> = {
  primary: '#e11d48', // Rose 600
  primaryHover: '#be123c', // Rose 700
  bgRaised: '#fff1f2', // Rose 50
  radiusMd: '0px', // Square corners for demonstration
};

export class AppRootElement extends LitElement {
  static override properties = {
    themeMode: { attribute: false },
    fontSize: { attribute: false },
  };

  themeMode: ThemeMode;
  fontSize: FontSize;

  constructor() {
    super();
    this.themeMode = 'light';
    this.fontSize = 'normal';
  }

  override createRenderRoot(): this {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('theme-change', this._onThemeChange);
    this.addEventListener('fontsize-change', this._onFontSizeChange);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('theme-change', this._onThemeChange);
    this.removeEventListener('fontsize-change', this._onFontSizeChange);
  }

  private _onThemeChange = ((e: CustomEvent<ThemeMode>) => { this.themeMode = e.detail; }) as EventListener;
  private _onFontSizeChange = ((e: CustomEvent<FontSize>) => { this.fontSize = e.detail; }) as EventListener;

  override render(): TemplateResult {
    const baseTokens: FreesailThemeTokens | Partial<FreesailThemeTokens> =
      this.themeMode === 'dark' ? defaultDarkTokens
      : this.themeMode === 'custom' ? { ...defaultLightTokens, ...customThemeProps }
      : defaultLightTokens;
    const activeTheme = { ...baseTokens, ...FONT_SCALES[this.fontSize] };

    return html`
      <div style=${styleMap({ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' })}>
        <freesail-provider
          .theme=${activeTheme}
          .catalogs=${ALL_CATALOGS}
          .onConnectionChange=${(connected: boolean) => console.log('Connection status:', connected)}
          .onError=${(error: Error) => console.error('Freesail error:', error)}
        >
          <div style=${styleMap({ display: 'flex', flex: '1', overflow: 'hidden', minHeight: '0' })}>
            <lit-app-chat></lit-app-chat>
            <div style=${styleMap({ flex: '1', padding: '20px', overflow: 'auto', backgroundColor: 'var(--freesail-bg, #f8fafc)', color: 'var(--freesail-text-foreground, #0f172a)' })}>
              <lit-app-header .themeMode=${this.themeMode} .fontSize=${this.fontSize}></lit-app-header>
              <main>
                <lit-app-surfaces></lit-app-surfaces>
              </main>
            </div>
          </div>
        </freesail-provider>
      </div>
    `;
  }
}

if (!customElements.get('lit-app-root')) {
  customElements.define('lit-app-root', AppRootElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'lit-app-root': AppRootElement;
  }
}
