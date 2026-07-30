/**
 * @fileoverview Minimal chat panel for the Lit example.
 *
 * @freesail/chat-catalog (ChatInput/ChatMessageList/etc.) has no Lit port yet,
 * so this hand-rolls just enough UI to talk to the agent: it bootstraps the
 * same "__chat" surface/data-model shape example/react-app's ChatBootstrapper
 * does, but reads/writes it directly instead of rendering through the
 * Freesail catalog/registry system. The wire contract is intentionally
 * identical to ChatInput's: dispatch a `usr_msg` action with `{ text }` on
 * the `__chat` surface — see @freesail/chat-catalog's ChatInput component and
 * example/agent's langchain-agent.ts (which special-cases exactly this
 * action name + surfaceId) for the other end of this contract.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { SurfaceController, dispatchSurfaceAction, type SurfaceId } from '@freesail/lit';

const CHAT_SURFACE_ID = '__chat' as SurfaceId;

interface ChatDataModel {
  messages?: Array<{ role: string; content: string }>;
  isTyping?: boolean;
}

export class AppChatElement extends LitElement {
  private readonly _chat: SurfaceController;
  private _bootstrapped = false;
  private _draft = '';

  constructor() {
    super();
    this._chat = new SurfaceController(this, CHAT_SURFACE_ID);
    // <lit-app-chat> renders into light DOM (createRenderRoot below), so its
    // rendered content are direct children of the custom element itself —
    // but a custom element with no styling defaults to `display: inline`,
    // which doesn't stretch to fill the parent flex row's height. Without a
    // bounded height here, the message list's `overflow-y:auto` never has
    // anything to scroll within and the whole panel just grows with content.
    // Set the host's own layout imperatively (light-DOM elements have no
    // `:host` selector to do this via CSS).
    this.style.display = 'flex';
    this.style.flexDirection = 'column';
    this.style.width = '320px';
    this.style.flexShrink = '0';
    this.style.minHeight = '0';
    this.style.borderRight = '1px solid var(--freesail-border)';
    this.style.background = 'var(--freesail-bg-raised)';
  }

  override createRenderRoot(): this {
    return this;
  }

  override willUpdate(): void {
    const ctx = this._chat.context;
    if (!ctx || this._bootstrapped) return;
    this._bootstrapped = true;
    if (!ctx.getSurface(CHAT_SURFACE_ID)) {
      // Placeholder catalogId — this surface is never rendered via <freesail-surface>/the
      // registry, so no real catalog needs to be registered for it.
      ctx.surfaceManager.createSurface({ surfaceId: CHAT_SURFACE_ID, catalogId: 'native-chat', sendDataModel: false });
      ctx.surfaceManager.updateDataModel(CHAT_SURFACE_ID, '/', { messages: [], isTyping: false, stream: { token: '', active: false } });
    }
  }

  private _send = (): void => {
    const text = this._draft.trim();
    const ctx = this._chat.context;
    if (!text || !ctx) return;
    this._draft = '';
    void dispatchSurfaceAction(ctx, CHAT_SURFACE_ID)('usr_msg', '__system', { text });
    this.requestUpdate();
  };

  override render(): TemplateResult {
    const dataModel = this._chat.surface?.dataModel as ChatDataModel | undefined;
    const messages = dataModel?.messages ?? [];
    const isTyping = dataModel?.isTyping ?? false;

    return html`
      <div style="flex-shrink:0;padding:12px;border-bottom:1px solid var(--freesail-border);font-weight:600;font-size:13px;color:var(--freesail-text-secondary)">Chat</div>
      <div style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:0">
        ${messages.length === 0 ? html`<div style="font-size:13px;color:var(--freesail-text-secondary)">Say hello to get started.</div>` : nothing}
        ${messages.map((m) => html`
          <div style="align-self:${m.role === 'user' ? 'flex-end' : 'flex-start'};
                      background:${m.role === 'user' ? 'var(--freesail-primary)' : 'var(--freesail-bg-muted)'};
                      color:${m.role === 'user' ? 'var(--freesail-primary-foreground)' : 'var(--freesail-text-foreground)'};
                      padding:8px 12px;border-radius:12px;max-width:85%;font-size:14px;white-space:pre-wrap">${m.content}</div>
        `)}
        ${isTyping ? html`<div style="font-size:12px;color:var(--freesail-text-secondary)">Agent is typing…</div>` : nothing}
      </div>
      <div style="flex-shrink:0;display:flex;gap:8px;padding:12px;border-top:1px solid var(--freesail-border)">
        <input
          .value=${live(this._draft)}
          @input=${(e: Event) => { this._draft = (e.target as HTMLInputElement).value; }}
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this._send(); }}
          placeholder="Type a message..."
          style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--freesail-border);background:var(--freesail-bg);color:var(--freesail-text-foreground)"
        />
        <button
          @click=${this._send}
          style="padding:8px 16px;border-radius:8px;border:none;background:var(--freesail-primary);color:var(--freesail-primary-foreground);cursor:pointer;font-weight:500"
        >Send</button>
      </div>
    `;
  }
}

if (!customElements.get('lit-app-chat')) {
  customElements.define('lit-app-chat', AppChatElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'lit-app-chat': AppChatElement;
  }
}
