/**
 * @fileoverview App header: title, connection indicator, theme/font-size switcher.
 *
 * Mirrors example/react-app's ConnectionIndicator + theme switcher UI, using
 * @freesail/lit's ConnectionStatusController (the Lit analogue of
 * ReactUI.useConnectionStatus()). Must be rendered as a DESCENDANT of
 * <freesail-provider> in the DOM so the controller's context lookup resolves.
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { ConnectionStatusController } from '@freesail/lit';

type ThemeMode = 'light' | 'dark' | 'custom';
type FontSize = 'normal' | 'large';

function themeButton(label: string, active: boolean, onClick: () => void): TemplateResult {
  return html`<button
    @click=${onClick}
    style=${styleMap({
      padding: '6px 12px', border: 'none', borderRadius: 'var(--freesail-radius-sm)',
      background: active ? 'var(--freesail-bg-raised, #fff)' : 'transparent',
      color: active ? 'var(--freesail-text-foreground, #000)' : 'var(--freesail-text-secondary, #666)',
      boxShadow: active ? 'var(--freesail-shadow-sm)' : 'none',
      cursor: 'pointer', fontSize: '13px', fontWeight: active ? '500' : 'normal',
    })}
  >${label}</button>`;
}

const wifiOnIcon = html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 12.55a11 11 0 0 1 14.08 0" />
  <path d="M1.42 9a16 16 0 0 1 21.16 0" />
  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
  <line x1="12" y1="20" x2="12.01" y2="20" />
</svg>`;

const wifiOffIcon = html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="2" y1="2" x2="22" y2="22" />
  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
  <line x1="12" y1="20" x2="12.01" y2="20" />
  <path d="M5 12.55a11 11 0 0 1 14.08 0" />
  <path d="M1.42 9a16 16 0 0 1 21.16 0" />
</svg>`;

export class AppHeaderElement extends LitElement {
  static override properties = {
    themeMode: { attribute: false },
    fontSize: { attribute: false },
  };

  themeMode: ThemeMode;
  fontSize: FontSize;

  private readonly _connection: ConnectionStatusController;

  constructor() {
    super();
    this.themeMode = 'light';
    this.fontSize = 'normal';
    this._connection = new ConnectionStatusController(this);
  }

  override createRenderRoot(): this {
    return this;
  }

  private _setTheme(mode: ThemeMode): void {
    this.dispatchEvent(new CustomEvent<ThemeMode>('theme-change', { detail: mode, bubbles: true, composed: true }));
  }

  private _setFontSize(size: FontSize): void {
    this.dispatchEvent(new CustomEvent<FontSize>('fontsize-change', { detail: size, bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    const isConnected = this._connection.isConnected;
    const color = isConnected ? '#06b09f' : '#ef4444';

    return html`
      <header style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:16px">
          <h1 style="margin:0;font-size:24px">Freesail</h1>
          <div aria-label=${isConnected ? 'Connected' : 'Disconnected'} style=${styleMap({ display: 'flex', alignItems: 'center', gap: '8px', color })}>
            ${isConnected ? wifiOnIcon : wifiOffIcon}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <div style="display:flex;gap:8px;background:var(--freesail-bg, #e2e8f0);padding:4px;border-radius:var(--freesail-radius-md);outline:1px solid var(--freesail-border, #a8d6eb)">
            ${themeButton('Light', this.themeMode === 'light', () => this._setTheme('light'))}
            ${themeButton('Dark', this.themeMode === 'dark', () => this._setTheme('dark'))}
            ${themeButton('Custom (Rose)', this.themeMode === 'custom', () => this._setTheme('custom'))}
          </div>
          <div style="display:flex;gap:8px;background:var(--freesail-bg, #e2e8f0);padding:4px;border-radius:var(--freesail-radius-md)">
            ${themeButton('A', this.fontSize === 'normal', () => this._setFontSize('normal'))}
            ${themeButton('A+', this.fontSize === 'large', () => this._setFontSize('large'))}
          </div>
        </div>
      </header>
    `;
  }
}

if (!customElements.get('lit-app-header')) {
  customElements.define('lit-app-header', AppHeaderElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'lit-app-header': AppHeaderElement;
  }
  interface HTMLElementEventMap {
    'theme-change': CustomEvent<ThemeMode>;
    'fontsize-change': CustomEvent<FontSize>;
  }
}
