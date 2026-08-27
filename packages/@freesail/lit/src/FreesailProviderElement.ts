/**
 * @fileoverview FreesailProviderElement (<freesail-provider>)
 *
 * The root element that manages the Freesail transport connection and
 * surface state, publishing it via @lit/context to descendant elements
 * (in particular <freesail-surface>). This is the Lit analogue of
 * @freesail/react's FreesailProvider component.
 *
 * Renders in the light DOM (no shadow root) so that declaratively-authored
 * children (e.g. nested <freesail-surface> elements) are left completely
 * untouched — this element's own render() output is empty; it exists purely
 * to run the connection lifecycle and publish context.
 */

import { LitElement } from 'lit';
import { ContextProvider } from '@lit/context';
import {
  createSurfaceManager,
  createTransport,
  isCreateSurfaceMessage,
  isUpdateComponentsMessage,
  isUpdateDataModelMessage,
  isDeleteSurfaceMessage,
  isGetDataModelMessage,
  isGetComponentTreeMessage,
  resolveTokens,
  tokensToCssVars,
} from '@freesail/core';
import type {
  SurfaceManager,
  SurfaceError,
  SerializedSurface,
  A2UITransport,
  TransportOptions,
  SurfaceId,
  ComponentId,
  CatalogId,
  DownstreamMessage,
  A2UIClientCapabilities,
  A2UIComponent,
  JsonPointer,
  SessionStartInfo,
  FreesailContextValue,
  FreesailThemeProp,
  FreesailThemeMode,
} from '@freesail/core';
import { freesailContext } from './context.js';
import { registerCatalog, type FreesailComponent } from './registry.js';
import type { CatalogDefinition } from './types.js';

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Returned by a surface operation interceptor.
 * allowed: whether to proceed with the operation.
 * message: if allowed and non-empty, the provider sends a
 *          'client_side_validation_message' action upstream.
 *          If not allowed, appended to the operation-specific error.
 */
export type SurfaceInterceptorResult = { allowed: boolean; message: string };

export type BeforeCreateSurface = (
  surfaceId: SurfaceId,
  catalogId: CatalogId,
  sendDataModel: boolean | undefined,
  surfaceManager: SurfaceManager
) => SurfaceInterceptorResult | Promise<SurfaceInterceptorResult>;

export type BeforeUpdateComponents = (
  surfaceId: SurfaceId,
  components: A2UIComponent[],
  surfaceManager: SurfaceManager
) => SurfaceInterceptorResult | Promise<SurfaceInterceptorResult>;

export type BeforeUpdateDataModel = (
  surfaceId: SurfaceId,
  path: JsonPointer | undefined,
  value: unknown,
  surfaceManager: SurfaceManager
) => SurfaceInterceptorResult | Promise<SurfaceInterceptorResult>;

export type BeforeDeleteSurface = (
  surfaceId: SurfaceId,
  surfaceManager: SurfaceManager
) => SurfaceInterceptorResult | Promise<SurfaceInterceptorResult>;

/** Tracks derived sessionStorage keys of currently mounted providers to detect duplicates. */
const mountedProviderKeys = new Set<string>();

/**
 * Root element for Freesail.
 *
 * Manages the transport connection and surface state, publishing them via
 * @lit/context so any descendant element (in particular <freesail-surface>)
 * can consume them.
 *
 * Usage:
 * ```html
 * <freesail-provider gateway="https://gateway.example.com">
 *   <freesail-surface surface-id="main"></freesail-surface>
 * </freesail-provider>
 * ```
 * ```ts
 * const provider = document.querySelector('freesail-provider');
 * provider.catalogs = [StandardCatalogLit];
 * ```
 */
export class FreesailProviderElement extends LitElement {
  static override properties = {
    gateway: { type: String },
    name: { type: String },
    theme: { attribute: false },
    catalogs: { attribute: false },
    transportOptions: { attribute: false },
    additionalCapabilities: { attribute: false },
    onConnectionChange: { attribute: false },
    onSessionInvalidated: { attribute: false },
    onError: { attribute: false },
    onBeforeCreateSurface: { attribute: false },
    onBeforeUpdateComponents: { attribute: false },
    onBeforeUpdateDataModel: { attribute: false },
    onBeforeDeleteSurface: { attribute: false },
  };

  /**
   * Base gateway URL. SSE and POST endpoints are derived automatically.
   *
   * Omit (or leave as default '') when the app and gateway share the same origin —
   * i.e. the gateway is reverse-proxied onto the same domain (nginx in production,
   * Vite proxy in dev). Requests will use relative paths and no CORS is needed.
   */
  gateway: string;
  /**
   * Optional name to scope this provider's session within the same gateway.
   * Only needed when two providers on the same page connect to the same gateway.
   */
  name?: string;
  /** Theme to apply to Freesail surfaces. Defaults to light mode if undefined. */
  theme?: FreesailThemeProp;
  /**
   * Array of catalogs to register. Property-only — arrays cannot be expressed
   * as HTML attributes, so this must be set imperatively: `el.catalogs = [...]`.
   * Components are auto-registered on connect and whenever this changes.
   */
  catalogs: CatalogDefinition[];
  /** Additional transport options. */
  transportOptions?: Partial<Omit<TransportOptions, 'gateway' | 'capabilities' | 'name'>>;
  /**
   * Extra capability key/values merged into the standard catalog list
   * advertised to the agent on every upstream message.
   */
  additionalCapabilities?: Record<string, unknown>;
  /** Called when connection state changes. */
  onConnectionChange?: (connected: boolean) => void;
  /**
   * Called when the gateway declined to resume the previous session, after the stale
   * surfaces have been cleared. The UI is now empty and the agent has no memory of what
   * came before, so this is where an app re-runs whatever bootstrapping it does on a cold
   * start. Also dispatched as a `freesail-session-invalidated` DOM event.
   */
  onSessionInvalidated?: (previousSessionId: string | null) => void;
  /** Called when an error occurs. */
  onError?: (error: Error) => void;
  /** Called before honouring an agent createSurface. Return allowed: false to block. */
  onBeforeCreateSurface?: BeforeCreateSurface;
  /** Called before honouring an agent updateComponents. Return allowed: false to block. */
  onBeforeUpdateComponents?: BeforeUpdateComponents;
  /** Called before honouring an agent updateDataModel. Return allowed: false to block. */
  onBeforeUpdateDataModel?: BeforeUpdateDataModel;
  /** Called before honouring an agent deleteSurface. Return allowed: false to block. */
  onBeforeDeleteSurface?: BeforeDeleteSurface;

  /** Surface manager instance, created once for the lifetime of this element. */
  readonly surfaceManager: SurfaceManager;

  private _transport: A2UITransport | null = null;
  private _connected = false;
  private _agentDeleted = new Set<string>();
  private _providerKey: string | null = null;
  private _unsubscribers: Array<() => void> = [];
  private readonly _contextProvider: ContextProvider<typeof freesailContext>;

  constructor() {
    super();
    this.gateway = '';
    this.catalogs = [];
    this.surfaceManager = createSurfaceManager();
    this._contextProvider = new ContextProvider(this, {
      context: freesailContext,
      initialValue: this._buildContextValue(),
    });
  }

  override createRenderRoot(): this {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._registerCatalogs();
    this._applyTheme();
    this._connectTransport();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._disconnectTransport();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('catalogs')) {
      this._registerCatalogs();
      this._pushCapabilities();
    }
    if (changed.has('theme')) {
      this._applyTheme();
    }
  }

  private _registerCatalogs(): void {
    for (const def of this.catalogs) {
      registerCatalog(
        def.namespace as CatalogId,
        def.components as Record<string, FreesailComponent>,
        def.functions,
        def.schema as Record<string, unknown> | undefined
      );
    }
  }

  private _buildCapabilities(): A2UIClientCapabilities | undefined {
    const catalogIds = this.catalogs.map((d) => d.namespace as CatalogId);
    const hasExtra = this.additionalCapabilities && Object.keys(this.additionalCapabilities).length > 0;
    if (catalogIds.length === 0 && !hasExtra) return undefined;
    return { catalogs: catalogIds, ...this.additionalCapabilities };
  }

  private _pushCapabilities(): void {
    this._transport?.updateCapabilities(this._buildCapabilities());
  }

  private _applyTheme(): void {
    const resolvedTheme = resolveTokens(this.theme) ?? resolveTokens('light');
    const mode: FreesailThemeMode = this.theme === 'dark' ? 'dark' : 'light';
    const cssVars = tokensToCssVars(resolvedTheme!, mode);
    this.style.display = 'contents';
    for (const [key, value] of Object.entries(cssVars)) {
      this.style.setProperty(key, String(value));
    }
  }

  private _connectTransport(): void {
    // Warn if two providers on the same page share the same derived sessionStorage key —
    // this likely means they will compete for the same session.
    const hostname = this.gateway
      ? (() => { try { return new URL(this.gateway, window.location.href).hostname; } catch { return window.location.hostname; } })()
      : window.location.hostname;
    const hostSlug = hostname.replace(/[^a-zA-Z0-9]/g, '_');
    const scope = this.name
      ? this.name
      : (window.location.pathname.replace(/\/$/, '').replace(/\//g, '_') || '_');
    const providerKey = `freesail_session_${hostSlug}_${scope}`;

    if (mountedProviderKeys.has(providerKey)) {
      console.warn(
        `[FreesailProvider] Two providers share the same session key "${providerKey}". ` +
        `Use the 'name' property to distinguish them.`
      );
    }
    mountedProviderKeys.add(providerKey);
    this._providerKey = providerKey;

    const transport = createTransport({
      gateway: this.gateway,
      name: this.name,
      capabilities: this._buildCapabilities(),
      ...this.transportOptions,
    });

    const { surfaceManager } = this;
    const agentDeleted = this._agentDeleted;

    // Handle incoming messages
    transport.on('message', (message: DownstreamMessage) => {
      if (isGetDataModelMessage(message)) {
        const { surfaceId } = message.getDataModel;
        const surface = surfaceManager.getSurface(surfaceId as any);
        if (!surface) {
          console.warn(`[FreesailProvider] get_data_model: surface '${surfaceId}' not found, ignoring request`);
          return;
        }
        transport.sendAction(
          surfaceId,
          '__get_data_model_response',
          '__system' as ComponentId,
          // Same view the piggybacked data model uses — an explicit request must not
          // expose client-only `__` state that the implicit path strips.
          { current_data_model: surfaceManager.getSharedDataModel(surfaceId) ?? {} }
        );
        return;
      }
      if (isGetComponentTreeMessage(message)) {
        const { surfaceId } = message.getComponentTree;
        const surface = surfaceManager.getSurface(surfaceId as any);
        if (!surface) {
          console.warn(`[FreesailProvider] get_component_tree: surface '${surfaceId}' not found, ignoring request`);
          return;
        }
        const components = Array.from(surface.components?.values() ?? []);
        const rootId = surface.rootId ?? null;
        transport.sendAction(
          surfaceId,
          '__get_component_tree_response',
          '__system' as ComponentId,
          { components, root_id: rootId }
        );
        return;
      }
      void handleMessage(message, surfaceManager, agentDeleted, transport, {
        onBeforeCreateSurface: this.onBeforeCreateSurface,
        onBeforeUpdateComponents: this.onBeforeUpdateComponents,
        onBeforeUpdateDataModel: this.onBeforeUpdateDataModel,
        onBeforeDeleteSurface: this.onBeforeDeleteSurface,
      });
    });

    // Notify agent when a surface is deleted client-side (e.g. disconnect cleanup)
    const unsubSurfaceDeleted = surfaceManager.on('surfaceDeleted', (surfaceId: SurfaceId) => {
      if (agentDeleted.delete(surfaceId as string)) {
        // Agent-initiated delete — don't echo back
        return;
      }
      transport.sendAction(surfaceId, 'surface_deleted', '__system' as ComponentId, { surfaceId, reason: 'client' });
    });

    // When a surface has no components after the orphan timeout,
    // send a reminder action so the agent can decide to delete it.
    const unsubOrphan = surfaceManager.on('surfaceOrphan', (surfaceId: SurfaceId) => {
      transport.sendAction(
        surfaceId,
        'surface_cleanup_reminder',
        '__system' as ComponentId,
        { surfaceId, message: `Surface ${String(surfaceId)} has no components. You may have forgotten to call update_components, or a previous attempt to update components may have failed. Use the surface or delete it if it is no longer needed.` }
      );
    });

    // When orphan components are detected, remind the agent to wire them up
    const unsubOrphanComponents = surfaceManager.on('orphanComponents', (surfaceId: SurfaceId, componentIds: ComponentId[]) => {
      transport.sendAction(
        surfaceId,
        'orphan_components_reminder',
        '__system' as ComponentId,
        {
          surfaceId,
          componentIds,
          message: `These components in surface '${String(surfaceId)}' are not reachable from root and won't render: ${componentIds.join(', ')}. Did you forget to wire them to a parent component? Please update the parent to include them, or ignore if this was intentional.`,
        }
      );
    });

    // Handle connection state changes
    transport.on('stateChange', (state: string) => {
      const connected = state === 'connected';
      this._connected = connected;
      this._contextProvider.setValue(this._buildContextValue());

      if (state === 'disconnected') {
        surfaceManager.clearSurfaces();
      }

      this.onConnectionChange?.(connected);
    });

    // Persist surface state to sessionStorage on every significant change so it
    // survives page refresh. Debounced to avoid flooding on rapid dataModel updates.
    const saveSurfaceState = debounce(() => {
      const sid = transport.sessionId;
      if (!sid) return;
      try {
        sessionStorage.setItem(
          `freesail_surfaces_${sid}`,
          JSON.stringify(surfaceManager.snapshot())
        );
      } catch {
        // sessionStorage unavailable (SSR, quota exceeded) — fail silently
      }
    }, 300);

    // Claim every surface that actually exists, whoever created it. Surfaces the agent
    // creates are also registered from the transport, but client-created ones (a locally
    // bootstrapped chat surface) have no other path — without the mapping, an upstream
    // action that arrives with no session header is discarded by the gateway.
    // Registration is deduped and deferred until the session ID is known.
    const unsubRegisterSurface = surfaceManager.on('surfaceCreated', (surface) => {
      transport.registerSurface(surface.id);
    });

    const unsubSaveCreated   = surfaceManager.on('surfaceCreated',    saveSurfaceState);
    const unsubSaveUpdated   = surfaceManager.on('componentsUpdated', saveSurfaceState);
    const unsubSaveDataModel = surfaceManager.on('dataModelUpdated',  saveSurfaceState);
    const unsubSaveDeleted   = surfaceManager.on('surfaceDeleted',    saveSurfaceState);

    // When session starts, restore surface state from sessionStorage, then register catalog schemas.
    transport.on('sessionStart', (sessionId: string, info?: SessionStartInfo) => {
      // The gateway refused to resume the session these surfaces belong to. Because
      // reconnects move through 'reconnecting' rather than 'disconnected', the
      // clearSurfaces() above never ran and the UI is still rendering surfaces whose
      // component IDs the new session has never seen — interactive, but backed by nothing.
      // Drop them so the app starts from a state the gateway agrees with.
      if (info?.invalidated) {
        surfaceManager.clearSurfaces();
        if (info.previousSessionId) {
          try {
            sessionStorage.removeItem(`freesail_surfaces_${info.previousSessionId}`);
          } catch {
            // Storage unavailable — the orphaned snapshot dies with the tab anyway.
          }
        }
        this.onSessionInvalidated?.(info.previousSessionId);
        this.dispatchEvent(
          new CustomEvent('freesail-session-invalidated', {
            detail: { previousSessionId: info.previousSessionId },
            bubbles: true,
            composed: true,
          })
        );
      }

      try {
        const saved = sessionStorage.getItem(`freesail_surfaces_${sessionId}`);
        if (saved) {
          const snapshots = JSON.parse(saved) as SerializedSurface[];
          surfaceManager.restore(snapshots);
        }
      } catch {
        // Corrupt storage or SSR — start fresh
      }

      const schemas = this.catalogs
        .map((def) => def.schema)
        .filter((s) => s && Object.keys(s).length > 0);

      if (schemas.length > 0) {
        transport.registerCatalogs(schemas).then((ok: boolean) => {
          if (ok) {
            console.log('[Freesail] Catalogs registered with gateway');
          }
        });
      }
    });

    // Forward surface manager errors upstream so the agent can react to them
    const unsubError = surfaceManager.on('error', (error: SurfaceError) => {
      transport.sendError(error.surfaceId, error.code, error.message, error.path);
    });

    // Handle errors
    transport.on('error', (error: Error) => {
      console.error('[Freesail] Transport error:', error);
      this.onError?.(error);
    });

    this._transport = transport;
    this._contextProvider.setValue(this._buildContextValue());

    transport.connect();

    this._unsubscribers = [
      unsubSurfaceDeleted, unsubOrphan, unsubOrphanComponents, unsubError,
      unsubSaveCreated, unsubSaveUpdated, unsubSaveDataModel, unsubSaveDeleted,
      unsubRegisterSurface,
    ];
  }

  private _disconnectTransport(): void {
    if (this._providerKey) mountedProviderKeys.delete(this._providerKey);
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
    this._transport?.disconnect();
    this._transport = null;
    this.surfaceManager.dispose();
  }

  // Send action callback (v0.9 format)
  private _sendAction = async (
    surfaceId: SurfaceId,
    name: string,
    sourceComponentId: ComponentId,
    context: Record<string, unknown>
  ): Promise<void> => {
    const transport = this._transport;
    if (!transport) {
      console.warn('[Freesail] Cannot send action: transport not initialized');
      return;
    }

    // Send only the data model of the surface that triggered the action.
    let dataModel: { surfaceId: SurfaceId; dataModel: Record<string, unknown> } | undefined;
    if (this.surfaceManager.shouldSendDataModel(surfaceId)) {
      const shared = this.surfaceManager.getSharedDataModel(surfaceId);
      if (shared && Object.keys(shared).length > 0) {
        dataModel = { surfaceId, dataModel: shared };
      }
    }

    await transport.sendAction(surfaceId, name, sourceComponentId, context, dataModel);
  };

  private _buildContextValue(): FreesailContextValue {
    return {
      surfaceManager: this.surfaceManager,
      transport: this._transport,
      sendAction: this._sendAction,
      getSurface: (surfaceId: SurfaceId) => this.surfaceManager.getSurface(surfaceId),
      isConnected: this._connected,
    };
  }
}

if (!customElements.get('freesail-provider')) {
  customElements.define('freesail-provider', FreesailProviderElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'freesail-provider': FreesailProviderElement;
  }
}

// =============================================================================
// Message Handler (framework-agnostic — shared shape with @freesail/react)
// =============================================================================

async function handleMessage(
  message: DownstreamMessage,
  manager: SurfaceManager,
  agentDeleted: Set<string>,
  transport: A2UITransport,
  interceptors: {
    onBeforeCreateSurface?: BeforeCreateSurface;
    onBeforeUpdateComponents?: BeforeUpdateComponents;
    onBeforeUpdateDataModel?: BeforeUpdateDataModel;
    onBeforeDeleteSurface?: BeforeDeleteSurface;
  }
): Promise<void> {
  if (isCreateSurfaceMessage(message)) {
    const { surfaceId, catalogId, sendDataModel } = message.createSurface;
    if (interceptors.onBeforeCreateSurface) {
      const { allowed, message: msg } = await interceptors.onBeforeCreateSurface(surfaceId, catalogId, sendDataModel, manager);
      if (!allowed) {
        transport.sendError(surfaceId, 'CLIENT_SIDE_VALIDATION_FAILURE', `Create surface operation failed: ${msg}`);
        return;
      }
      if (msg) {
        transport.sendAction(surfaceId, 'client_side_validation_message', '__system' as ComponentId, { message: msg });
      }
    }
    manager.createSurface({ surfaceId, catalogId, sendDataModel });
  } else if (isUpdateComponentsMessage(message)) {
    const { surfaceId, components } = message.updateComponents;
    if (interceptors.onBeforeUpdateComponents) {
      const { allowed, message: msg } = await interceptors.onBeforeUpdateComponents(surfaceId, components, manager);
      if (!allowed) {
        const ids = components.map((c: A2UIComponent) => c.id).join(', ');
        transport.sendError(surfaceId, 'CLIENT_SIDE_VALIDATION_FAILURE', `Update components operation failed for components [${ids}]: ${msg}`);
        return;
      }
      if (msg) {
        transport.sendAction(surfaceId, 'client_side_validation_message', '__system' as ComponentId, { message: msg });
      }
    }
    manager.updateComponents(surfaceId, components);
  } else if (isUpdateDataModelMessage(message)) {
    const { surfaceId, path, value } = message.updateDataModel;
    if (interceptors.onBeforeUpdateDataModel) {
      const { allowed, message: msg } = await interceptors.onBeforeUpdateDataModel(surfaceId, path, value, manager);
      if (!allowed) {
        const pathDisplay = path ?? '/';
        transport.sendError(surfaceId, 'CLIENT_SIDE_VALIDATION_FAILURE', `Update data model operation failed at paths [${pathDisplay}]: ${msg}`);
        return;
      }
      if (msg) {
        transport.sendAction(surfaceId, 'client_side_validation_message', '__system' as ComponentId, { message: msg });
      }
    }
    manager.updateDataModel(surfaceId, path, value);
  } else if (isDeleteSurfaceMessage(message)) {
    const { surfaceId } = message.deleteSurface;
    if (interceptors.onBeforeDeleteSurface) {
      const { allowed, message: msg } = await interceptors.onBeforeDeleteSurface(surfaceId, manager);
      if (!allowed) {
        transport.sendError(surfaceId, 'CLIENT_SIDE_VALIDATION_FAILURE', `Delete surface operation failed: ${msg}`);
        return;
      }
      if (msg) {
        transport.sendAction(surfaceId, 'client_side_validation_message', '__system' as ComponentId, { message: msg });
      }
    }
    agentDeleted.add(surfaceId as string);
    manager.deleteSurface(surfaceId);
  }
}
