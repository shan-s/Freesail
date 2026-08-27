/**
 * @fileoverview SSE Transport Layer
 *
 * Implements the Server-Sent Events client with auto-reconnect
 * and offline message queueing capabilities.
 */

import {
  A2UI_VERSION,
  type DownstreamMessage,
  type UpstreamMessage,
  type SurfaceId,
  type ComponentId,
  type A2UIClientCapabilities,
  type A2UIClientDataModel,
} from './protocol.js';
import { A2UIParser } from './parser.js';

/**
 * Transport connection states.
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/**
 * Transport configuration options.
 */
export interface TransportOptions {
  /** Base gateway URL (e.g. 'http://localhost:3001'). SSE and POST endpoints are derived automatically. */
  gateway: string;
  /**
   * Optional name to scope the sessionStorage key for this provider instance.
   * Only needed when two providers on the same page connect to the same gateway.
   * Defaults to a key derived from the gateway hostname and current pathname.
   */
  name?: string;
  /** Client capabilities to announce on connection */
  capabilities?: A2UIClientCapabilities;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Reconnect delay multiplier (default: 2) */
  reconnectMultiplier?: number;
  /** Maximum number of queued messages (default: 100) */
  maxQueueSize?: number;
  /** Request timeout in ms (default: 30000) */
  requestTimeout?: number;
}

/**
 * Details accompanying a `sessionStart` event, describing how the session was established.
 */
export interface SessionStartInfo {
  /** True when the gateway resumed the exact session the client asked for. */
  resumed: boolean;
  /** The session ID the client attempted to resume, or null on a first connection. */
  previousSessionId: string | null;
  /**
   * True when the client had a prior session that the gateway did NOT resume — because it
   * expired, was unknown, or was still live in another tab. Any surfaces the client is
   * holding, and any actions queued against them, belong to a session that no longer
   * exists: they reference component IDs the new session has never seen. Consumers must
   * discard client state when this is true.
   *
   * Note this is narrower than `!resumed`: a first-ever connection is also not a resume,
   * but has no stale state to discard, so `invalidated` stays false there.
   */
  invalidated: boolean;
}

/**
 * Event types emitted by the transport.
 */
export interface TransportEvents {
  message: (message: DownstreamMessage) => void;
  stateChange: (state: ConnectionState) => void;
  error: (error: Error) => void;
  queueFlushed: (count: number) => void;
  /** Emitted when the server assigns a session ID on connection */
  sessionStart: (sessionId: string, info: SessionStartInfo) => void;
  /**
   * Emitted when queued upstream messages are discarded because the session that owns
   * them was invalidated. The messages are handed back so callers can regenerate
   * equivalent intent against the new session — they must not be replayed as-is.
   */
  queueDropped: (messages: UpstreamMessage[], reason: 'sessionInvalidated') => void;
}

type EventCallback<K extends keyof TransportEvents> = TransportEvents[K];

/**
 * How long to wait after the SSE stream opens for the gateway's `connected` frame before
 * assuming it will never arrive and flushing the queue anyway.
 */
const SESSION_HANDSHAKE_TIMEOUT = 2000;

const DEFAULT_OPTIONS: Required<Omit<TransportOptions, 'gateway' | 'capabilities' | 'name'>> = {
  autoReconnect: true,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectMultiplier: 2,
  maxQueueSize: 100,
  requestTimeout: 30000,
};

/**
 * Derive a sessionStorage key scoped to the gateway hostname and provider name/pathname.
 * Ensures cross-origin MFE providers never collide (different hostnames → different keys),
 * and same-gateway same-page providers are differentiated via the `name` option.
 */
function deriveStorageKey(gateway: string, name?: string): string {
  const hostname = gateway
    ? new URL(gateway, typeof window !== 'undefined' ? window.location.href : 'http://localhost').hostname
    : (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
  const hostSlug = hostname.replace(/[^a-zA-Z0-9]/g, '_');
  const scope = name
    ? name
    : (typeof window !== 'undefined'
        ? (window.location.pathname.replace(/\/$/, '').replace(/\//g, '_') || '_')
        : '_');
  return `freesail_session_${hostSlug}_${scope}`;
}

/**
 * A2UI Transport Layer
 *
 * Manages the bi-directional communication between client and server:
 * - Downstream (Server → Client): SSE stream for receiving messages
 * - Upstream (Client → Server): HTTP POST for sending messages
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Offline message queueing with automatic flush on reconnect
 * - Event-based message handling
 * - Client capabilities handshake
 */
export class A2UITransport {
  private options: Required<Omit<TransportOptions, 'capabilities' | 'name'>> & { capabilities?: A2UIClientCapabilities; name?: string };

  private get sseUrl(): string {
    return `${this.options.gateway}/sse`;
  }
  private get postUrl(): string { return `${this.options.gateway}/message`; }
  private state: ConnectionState = 'disconnected';
  private eventSource: EventSource | null = null;
  private parser: A2UIParser;
  private messageQueue: UpstreamMessage[] = [];
  private currentReconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Map<keyof TransportEvents, Set<EventCallback<keyof TransportEvents>>> =
    new Map();
  private dataModelProviders: Map<SurfaceId, () => Record<string, unknown>> = new Map();
  private _sessionId: string | null = null;
  /** sessionStorage key used to persist and restore the session ID across page refreshes. */
  private readonly storageKey: string;
  /** Surface IDs whose /register-surface POST failed and need to be retried on reconnect. */
  private pendingSurfaceRegistrations: Set<string> = new Set();
  /**
   * Surface IDs already registered with the current session, so repeat calls are free.
   * Cleared when the session is invalidated — a new session knows none of these surfaces.
   */
  private registeredSurfaces: Set<string> = new Set();
  /** True while flushQueue() is running — prevents postMessage() failures from triggering re-entrant flushes. */
  private isFlushingQueue = false;
  /** Retry timer for re-attempting the queue when SSE stays alive but POST requests fail. */
  private queueRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Fallback timer that completes the session handshake if the gateway never sends a
   * `connected` frame (older or third-party gateways), so the queue still drains.
   */
  private sessionHandshakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TransportOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.parser = new A2UIParser();
    this.currentReconnectDelay = this.options.reconnectDelay;
    this.storageKey = deriveStorageKey(options.gateway, options.name);
  }

  /**
   * Get the session ID assigned by the server.
   */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /**
   * Register a data model provider for a surface.
   * Used when sendDataModel is enabled to get current state.
   */
  registerDataModelProvider(
    surfaceId: SurfaceId,
    provider: () => Record<string, unknown>
  ): void {
    this.dataModelProviders.set(surfaceId, provider);
  }

  /**
   * Unregister a data model provider.
   */
  unregisterDataModelProvider(surfaceId: SurfaceId): void {
    this.dataModelProviders.delete(surfaceId);
  }

  /**
   * Update client capabilities at runtime.
   * The new value will be included in the next upstream POST header,
   * which the gateway uses to detect changes and notify the agent.
   */
  updateCapabilities(capabilities: A2UIClientCapabilities | undefined): void {
    this.options.capabilities = capabilities;
  }

  /**
   * Connect to the SSE stream.
   */
  connect(): void {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.setState('connecting');

    try {
      // Restore session ID from sessionStorage so the gateway can resume the session
      // on page refresh. EventSource doesn't support custom headers, so the session ID
      // is passed as a query parameter. The gateway uses this for session identity only —
      // CSRF protection comes from the freesail-gateway-token cookie.
      const storedSessionId = typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(this.storageKey)
        : null;
      if (storedSessionId && !this._sessionId) {
        this._sessionId = storedSessionId;
      }
      const sseUrl = this._sessionId
        ? `${this.sseUrl}?sessionId=${encodeURIComponent(this._sessionId)}`
        : this.sseUrl;
      this.eventSource = new EventSource(sseUrl, { withCredentials: true });

      this.eventSource.onopen = () => {
        this.setState('connected');
        this.currentReconnectDelay = this.options.reconnectDelay;
        this.clearQueueRetryTimer();
        // Deliberately NOT flushing here. onopen fires before the gateway's `connected`
        // frame, which is the only thing that tells us whether our session survived —
        // flushing now would post queued actions, under the old session ID, for surfaces
        // the gateway may have already discarded. The flush happens in
        // handleSessionEstablished() once that frame lands.
        this.scheduleSessionHandshakeFallback();
      };

      this.eventSource.onmessage = (event) => {
        this.handleSSEMessage(event.data);
      };

      this.eventSource.onerror = () => {
        this.handleDisconnect();
      };
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      this.handleDisconnect();
    }
  }

  /**
   * Disconnect from the SSE stream.
   *
   * @param clearSession - When true, removes the stored session ID from sessionStorage so the
   *   next connect() starts a fresh session. Use this for explicit user-initiated disconnects
   *   (e.g. logout). Defaults to false so that component unmount on page refresh/navigation
   *   does NOT clear the stored session — the gateway can then resume it within the grace period.
   */
  disconnect(clearSession = false): void {
    this.clearReconnectTimer();
    this.clearQueueRetryTimer();
    this.clearSessionHandshakeTimer();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Reset in-memory session ID. Only remove the persisted sessionStorage entry when explicitly
    // requested — otherwise a page refresh would lose the session resume capability.
    this._sessionId = null;
    if (clearSession && typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(this.storageKey);
    }
    this.setState('disconnected');
  }

  /**
   * Send an upstream message to the server.
   * If disconnected, the message is queued for later delivery (dataModel is not queued).
   */
  async send(message: UpstreamMessage, dataModel?: A2UIClientDataModel): Promise<boolean> {
    if (this.state !== 'connected') {
      return this.queueMessage(message);
    }

    return this.postMessage(message, dataModel);
  }

  /**
   * Send an action message (v0.9 format).
   */
  async sendAction(
    surfaceId: SurfaceId,
    name: string,
    sourceComponentId: ComponentId,
    context: Record<string, unknown>,
    dataModel?: A2UIClientDataModel
  ): Promise<boolean> {
    const message: UpstreamMessage = {
      version: A2UI_VERSION,
      action: {
        name,
        surfaceId,
        sourceComponentId,
        timestamp: new Date().toISOString(),
        context,
      },
    };

    return this.send(message, dataModel);
  }

  /**
   * Send an error message.
   */
  async sendError(
    surfaceId: SurfaceId,
    code: string,
    errorMessage: string,
    path?: string
  ): Promise<boolean> {
    const message: UpstreamMessage = {
      version: A2UI_VERSION,
      error: {
        code,
        message: errorMessage,
        surfaceId,
        path,
      },
    };

    return this.send(message);
  }

  /**
   * Get the current connection state.
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get the number of queued messages.
   */
  getQueueSize(): number {
    return this.messageQueue.length;
  }

  /**
   * Register catalog schemas with the gateway server.
   * Called after connecting to provide the server with catalog definitions.
   */
  async registerCatalogs(catalogs: unknown[]): Promise<boolean> {
    if (!this._sessionId) {
      this.emit('error', new Error('Cannot register catalogs: no session ID'));
      return false;
    }

    try {
      const baseUrl = this.options.gateway;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.requestTimeout
      );

      const catalogHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this._sessionId) {
        catalogHeaders['X-Freesail-Session'] = this._sessionId;
      }

      const response = await fetch(`${baseUrl}/register-catalogs`, {
        method: 'POST',
        headers: catalogHeaders,
        credentials: 'include',
        body: JSON.stringify({ catalogs }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return true;
    } catch (error) {
      this.emit(
        'error',
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }

  /**
   * Subscribe to transport events.
   */
  on<K extends keyof TransportEvents>(
    event: K,
    callback: TransportEvents[K]
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback<keyof TransportEvents>);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback<keyof TransportEvents>);
    };
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof TransportEvents>(
    event: K,
    callback: TransportEvents[K]
  ): void {
    this.listeners.get(event)?.delete(callback as EventCallback<keyof TransportEvents>);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit('stateChange', state);
    }
  }

  private emit<K extends keyof TransportEvents>(
    event: K,
    ...args: Parameters<TransportEvents[K]>
  ): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          (callback as (...args: Parameters<TransportEvents[K]>) => void)(...args);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Complete the session handshake once the gateway's `connected` frame lands.
   *
   * This is the point where the client learns whether the session it asked to resume
   * survived, so it is also the point where queued upstream messages become safe to send
   * (or must be discarded). Nothing upstream should be flushed before this runs.
   */
  private handleSessionEstablished(newSessionId: string, resumed: boolean): void {
    this.clearSessionHandshakeTimer();

    const previousSessionId = this._sessionId;
    // The client had a session that the gateway did not hand back: it expired, was
    // unknown, or is still live in another tab (the duplicate-tab path always mints a
    // fresh ID). Either way the surfaces we are holding, and anything queued against
    // them, belong to a session that no longer exists.
    const invalidated = previousSessionId !== null && !resumed;

    this._sessionId = newSessionId;
    // Persist the server-assigned canonical session ID so it survives page refresh.
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(this.storageKey, newSessionId);
      } catch {
        // Quota exceeded or storage disabled — session resume degrades, nothing else breaks.
      }
    }

    if (invalidated) {
      // Queued actions target component IDs the new session has never seen, so delivering
      // them would hand the agent actions for surfaces it never created. Hand them to
      // listeners instead, so callers can regenerate equivalent intent against the new
      // session rather than replay stale intent into it.
      if (this.messageQueue.length > 0) {
        const dropped = this.messageQueue;
        this.messageQueue = [];
        this.clearQueueRetryTimer();
        this.emit('queueDropped', dropped, 'sessionInvalidated');
      }
      // Registrations for the old session's surfaces are equally meaningless now, and the
      // new session has no surface→session mappings at all, so nothing counts as
      // registered any more.
      this.pendingSurfaceRegistrations.clear();
      this.registeredSurfaces.clear();
    }

    this.emit('sessionStart', newSessionId, { resumed, previousSessionId, invalidated });

    // Safe to send now: either the session was resumed, or the stale queue has been dropped.
    this.flushQueue();
    this.flushPendingSurfaceRegistrations();
  }

  /**
   * Guard against a gateway that never sends a `connected` frame. Without it the queue,
   * which no longer flushes on `onopen`, would never drain against such a gateway.
   * Treated as a non-resumed session with no previous ID, i.e. flush without dropping.
   */
  private scheduleSessionHandshakeFallback(): void {
    this.clearSessionHandshakeTimer();
    this.sessionHandshakeTimer = setTimeout(() => {
      this.sessionHandshakeTimer = null;
      if (this.state !== 'connected') return;
      this.flushQueue();
      this.flushPendingSurfaceRegistrations();
    }, SESSION_HANDSHAKE_TIMEOUT);
  }

  private clearSessionHandshakeTimer(): void {
    if (this.sessionHandshakeTimer) {
      clearTimeout(this.sessionHandshakeTimer);
      this.sessionHandshakeTimer = null;
    }
  }

  private handleSSEMessage(data: string): void {
    // Check for connection message (sent before protocol messages)
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && parsed.connected && parsed.sessionId) {
        this.handleSessionEstablished(
          parsed.sessionId as string,
          parsed.resumed === true
        );
        return;
      }
    } catch {
      // Not a simple JSON object, continue with parser
    }

    const result = this.parser.parse(data);

    for (const message of result.messages) {
      // Auto-register surface→session mapping when we receive createSurface.
      // registerSurface() defers if the session ID has not arrived yet, so this no longer
      // needs to be dropped on the floor when the handshake is still in flight.
      if ('createSurface' in message) {
        const createSurface = (message as unknown as Record<string, unknown>)['createSurface'];
        if (createSurface && typeof createSurface === 'object' && 'surfaceId' in createSurface) {
          this.registerSurface(createSurface.surfaceId as string);
        }
      }

      this.emit('message', message);
    }

    for (const error of result.errors) {
      this.emit('error', new Error(`Parse error: ${error.message}`));
    }
  }



  /**
   * Tell the gateway that this session owns `surfaceId`.
   *
   * Without this mapping the gateway cannot route upstream actions from the surface, and
   * an action that arrives without a session header is silently discarded. Surfaces the
   * agent creates are registered automatically; surfaces the client creates itself (e.g. a
   * locally bootstrapped chat surface) must be registered through this method.
   *
   * Safe to call repeatedly and before a session exists — duplicates are dropped, and
   * calls made before the handshake are deferred until the session ID is known.
   */
  registerSurface(surfaceId: string): void {
    if (this.registeredSurfaces.has(surfaceId)) return;

    if (!this._sessionId) {
      // /register-surface rejects requests without a session header, so hold the surface
      // until handleSessionEstablished() flushes pending registrations.
      this.pendingSurfaceRegistrations.add(surfaceId);
      return;
    }

    void this.registerSurfaceWithGateway(surfaceId);
  }

  /**
   * Register a surface with the gateway so it knows which session owns it.
   */
  private async registerSurfaceWithGateway(surfaceId: string): Promise<void> {
    try {
      const baseUrl = this.options.gateway;
      const surfaceHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this._sessionId) {
        surfaceHeaders['X-Freesail-Session'] = this._sessionId;
      }
      const response = await fetch(`${baseUrl}/register-surface`, {
        method: 'POST',
        headers: surfaceHeaders,
        credentials: 'include',
        body: JSON.stringify({ surfaceId }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      this.registeredSurfaces.add(surfaceId);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      // Retry on next reconnect — without this mapping the gateway can't route
      // upstream actions from this surface to the correct session.
      this.registeredSurfaces.delete(surfaceId);
      this.pendingSurfaceRegistrations.add(surfaceId);
      this.scheduleQueueRetry();
    }
  }

  private flushPendingSurfaceRegistrations(): void {
    if (this.pendingSurfaceRegistrations.size === 0) return;
    const pending = new Set(this.pendingSurfaceRegistrations);
    this.pendingSurfaceRegistrations.clear();
    for (const surfaceId of pending) {
      void this.registerSurfaceWithGateway(surfaceId);
    }
  }

  private handleDisconnect(): void {
    this.clearSessionHandshakeTimer();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Keep _sessionId so the reconnect attempt can request the same session from the gateway.
    // It is only cleared on an explicit disconnect() call.
    this.parser.reset();

    if (this.options.autoReconnect && this.state !== 'disconnected') {
      this.setState('reconnecting');
      this.scheduleReconnect();
    } else {
      this.setState('disconnected');
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(() => {
      this.connect();

      // Exponential backoff
      this.currentReconnectDelay = Math.min(
        this.currentReconnectDelay * this.options.reconnectMultiplier,
        this.options.maxReconnectDelay
      );
    }, this.currentReconnectDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private queueMessage(message: UpstreamMessage): boolean {
    if (this.messageQueue.length >= this.options.maxQueueSize) {
      this.emit('error', new Error('Message queue full, dropping message'));
      return false;
    }

    this.messageQueue.push(message);
    return true;
  }

  private async flushQueue(): Promise<void> {
    if (this.isFlushingQueue || this.messageQueue.length === 0) return;

    this.isFlushingQueue = true;
    const messages = [...this.messageQueue];
    this.messageQueue = [];

    let flushedCount = 0;

    try {
      for (const message of messages) {
        const success = await this.postMessage(message);
        if (success) {
          flushedCount++;
        } else {
          // Re-queue failed messages (postMessage won't re-queue when isFlushingQueue is true)
          this.messageQueue.push(message);
        }
      }
    } finally {
      this.isFlushingQueue = false;
    }

    if (flushedCount > 0) {
      this.emit('queueFlushed', flushedCount);
    }

    if (this.messageQueue.length > 0) {
      // Some messages failed — retry after 1s.
      // This handles the case where the SSE stays alive but POST requests fail,
      // so onopen won't fire to trigger the next flush naturally.
      this.scheduleQueueRetry();
    }
  }

  private scheduleQueueRetry(): void {
    if (this.queueRetryTimer) return; // already scheduled
    this.queueRetryTimer = setTimeout(() => {
      this.queueRetryTimer = null;
      if (this.state === 'connected') {
        this.flushPendingSurfaceRegistrations();
        if (this.messageQueue.length > 0) {
          void this.flushQueue();
        }
      }
    }, 1000);
  }

  private clearQueueRetryTimer(): void {
    if (this.queueRetryTimer) {
      clearTimeout(this.queueRetryTimer);
      this.queueRetryTimer = null;
    }
  }

  private async postMessage(
    message: UpstreamMessage,
    dataModel?: A2UIClientDataModel
  ): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.requestTimeout
      );

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Session identity header — used by the gateway to route the request to the correct session.
      if (this._sessionId) {
        headers['X-Freesail-Session'] = this._sessionId;
      }

      // Add capabilities if configured
      if (this.options.capabilities) {
        headers['X-A2UI-Capabilities'] = JSON.stringify(this.options.capabilities);
      }

      // Include data model in the body (not header) to avoid logging exposure
      const bodyPayload: Record<string, unknown> = { ...message };
      if (dataModel) {
        bodyPayload['dataModel'] = dataModel;
      }

      const response = await fetch(this.postUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
        credentials: 'include',
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return true;
    } catch (error) {
      this.emit(
        'error',
        error instanceof Error ? error : new Error(String(error))
      );
      if (!this.isFlushingQueue) {
        // Direct call (e.g. from sendAction) — re-queue and trigger an immediate flush
        // so the message is retried without waiting for the next SSE reconnect.
        // When called from within flushQueue() the flush loop already re-queues failures,
        // so we skip this to avoid double-queuing and re-entrant loops.
        this.queueMessage(message);
        void this.flushQueue();
      }
      return false;
    }
  }
}

/**
 * Create a new transport instance.
 */
export function createTransport(options: TransportOptions): A2UITransport {
  return new A2UITransport(options);
}
