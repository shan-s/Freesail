/**
 * @fileoverview Freesail Lit Reactive Controllers
 *
 * The Lit analogue of @freesail/react's hooks.ts. Each controller subscribes
 * to surface manager / transport events in `hostConnected()`-equivalent setup
 * and calls `host.requestUpdate()` on change, instead of a hook's `setState`.
 *
 * Every controller resolves the Freesail context (surface manager, transport,
 * sendAction) via @lit/context's ContextConsumer with `subscribe: true`, so it
 * re-binds automatically if the nearest <freesail-provider> ancestor's context
 * value changes (e.g. connection state flips, transport becomes available).
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { ContextConsumer } from '@lit/context';
import type { Surface, SurfaceId, JsonPointer, ComponentId, FreesailContextValue } from '@freesail/core';
import { getDataAtPath } from '@freesail/core';
import { freesailContext } from './context.js';

type Host = ReactiveControllerHost & HTMLElement;

/**
 * Dispatch function type for actions, matching @freesail/react's useAction return shape.
 */
export type ActionDispatch = (
  name: string,
  sourceComponentId: ComponentId,
  context?: Record<string, unknown>
) => Promise<void>;

/**
 * Plain (non-reactive) helper mirroring @freesail/react's useAction — wraps a
 * resolved FreesailContextValue's sendAction, bound to one surface.
 */
export function dispatchSurfaceAction(ctx: FreesailContextValue, surfaceId: SurfaceId): ActionDispatch {
  return (name, sourceComponentId, context = {}) => ctx.sendAction(surfaceId, name, sourceComponentId, context);
}

/**
 * Reactive controller mirroring @freesail/react's useSurface — tracks a single
 * surface by ID and requests a host update whenever it's created, deleted, or
 * its components/data model change. Also exposes the resolved Freesail context
 * (`.context`) so a host element doesn't need a second ContextConsumer of its own.
 */
export class SurfaceController implements ReactiveController {
  surface: Surface | undefined;
  context: FreesailContextValue | undefined;

  private readonly host: Host;
  private surfaceId: SurfaceId;
  private unsubscribers: Array<() => void> = [];
  private readonly consumer: ContextConsumer<typeof freesailContext, Host>;

  constructor(host: Host, surfaceId: SurfaceId) {
    this.host = host;
    this.surfaceId = surfaceId;
    host.addController(this);
    this.consumer = new ContextConsumer(host, {
      context: freesailContext,
      subscribe: true,
      callback: (value) => this._bind(value),
    });
  }

  /**
   * Re-point this controller at a different surface. The host element must
   * call this from `willUpdate()` (before `render()`) whenever its surfaceId
   * property changes, since the value passed to the constructor is captured
   * before the host has necessarily received its real surfaceId (custom
   * element properties are always set after the constructor runs).
   */
  setSurfaceId(surfaceId: SurfaceId): void {
    if (surfaceId === this.surfaceId) return;
    this.surfaceId = surfaceId;
    if (this.context) this._bind(this.context);
  }

  private _bind(ctx: FreesailContextValue): void {
    this._unbind();
    this.context = ctx;
    this.surface = ctx.getSurface(this.surfaceId);

    const manager = ctx.surfaceManager;
    const refresh = () => {
      this.surface = ctx.getSurface(this.surfaceId);
      this.host.requestUpdate();
    };
    const unsubCreate = manager.on('surfaceCreated', (created: Surface) => {
      if (created.id === this.surfaceId) refresh();
    });
    const unsubDelete = manager.on('surfaceDeleted', (deletedId: SurfaceId) => {
      if (deletedId === this.surfaceId) {
        this.surface = undefined;
        this.host.requestUpdate();
      }
    });
    const unsubComponents = manager.on('componentsUpdated', (updatedId: SurfaceId) => {
      if (updatedId === this.surfaceId) refresh();
    });
    const unsubData = manager.on('dataModelUpdated', (updatedId: SurfaceId) => {
      if (updatedId === this.surfaceId) refresh();
    });
    this.unsubscribers = [unsubCreate, unsubDelete, unsubComponents, unsubData];
    this.host.requestUpdate();
  }

  private _unbind(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  hostConnected(): void {}
  hostDisconnected(): void {
    this._unbind();
  }
}

/**
 * Reactive controller mirroring @freesail/react's useSurfaceData — tracks a
 * value at a JSON Pointer path within a surface's data model.
 */
export class SurfaceDataController<T = unknown> implements ReactiveController {
  data: T | undefined;

  private readonly host: Host;
  private readonly surfaceId: SurfaceId;
  private readonly path?: JsonPointer;
  private unsubscribe?: () => void;
  private readonly consumer: ContextConsumer<typeof freesailContext, Host>;

  constructor(host: Host, surfaceId: SurfaceId, path?: JsonPointer) {
    this.host = host;
    this.surfaceId = surfaceId;
    this.path = path;
    host.addController(this);
    this.consumer = new ContextConsumer(host, {
      context: freesailContext,
      subscribe: true,
      callback: (value) => this._bind(value),
    });
  }

  private _bind(ctx: FreesailContextValue): void {
    this.unsubscribe?.();
    const manager = ctx.surfaceManager;
    const surface = ctx.getSurface(this.surfaceId);
    this.data = surface ? (getDataAtPath(surface.dataModel, this.path) as T) : undefined;

    this.unsubscribe = manager.on('dataModelUpdated', (updatedId: SurfaceId, updatedPath: JsonPointer) => {
      if (updatedId !== this.surfaceId) return;
      if (this.path && !updatedPath.startsWith(this.path) && !this.path.startsWith(updatedPath)) return;
      const current = ctx.getSurface(this.surfaceId);
      this.data = current ? (getDataAtPath(current.dataModel, this.path) as T) : undefined;
      this.host.requestUpdate();
    });
    this.host.requestUpdate();
  }

  hostConnected(): void {}
  hostDisconnected(): void {
    this.unsubscribe?.();
  }
}

/**
 * Reactive controller mirroring @freesail/react's useConnectionStatus.
 */
export class ConnectionStatusController implements ReactiveController {
  isConnected = false;

  private readonly host: Host;
  private readonly consumer: ContextConsumer<typeof freesailContext, Host>;

  constructor(host: Host) {
    this.host = host;
    host.addController(this);
    this.consumer = new ContextConsumer(host, {
      context: freesailContext,
      subscribe: true,
      callback: (value) => {
        this.isConnected = value.isConnected;
        this.host.requestUpdate();
      },
    });
  }

  hostConnected(): void {}
  hostDisconnected(): void {}
}

/**
 * Reactive controller mirroring @freesail/react's useSurfaces.
 */
export class SurfacesController implements ReactiveController {
  surfaces: Surface[] = [];

  private readonly host: Host;
  private unsubscribers: Array<() => void> = [];
  private readonly consumer: ContextConsumer<typeof freesailContext, Host>;

  constructor(host: Host) {
    this.host = host;
    host.addController(this);
    this.consumer = new ContextConsumer(host, {
      context: freesailContext,
      subscribe: true,
      callback: (value) => this._bind(value),
    });
  }

  private _bind(ctx: FreesailContextValue): void {
    this._unbind();
    const manager = ctx.surfaceManager;
    const refresh = () => {
      this.surfaces = manager.getAllSurfaces();
      this.host.requestUpdate();
    };
    refresh();
    const unsubCreate = manager.on('surfaceCreated', refresh);
    const unsubDelete = manager.on('surfaceDeleted', refresh);
    this.unsubscribers = [unsubCreate, unsubDelete];
  }

  private _unbind(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  hostConnected(): void {}
  hostDisconnected(): void {
    this._unbind();
  }
}

/**
 * Reactive controller mirroring @freesail/react's useSessionId.
 */
export class SessionIdController implements ReactiveController {
  sessionId: string | null = null;

  private readonly host: Host;
  private unsubscribe?: () => void;
  private readonly consumer: ContextConsumer<typeof freesailContext, Host>;

  constructor(host: Host) {
    this.host = host;
    host.addController(this);
    this.consumer = new ContextConsumer(host, {
      context: freesailContext,
      subscribe: true,
      callback: (value) => this._bind(value),
    });
  }

  private _bind(ctx: FreesailContextValue): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.sessionId = ctx.transport?.sessionId ?? null;
    if (ctx.transport) {
      this.unsubscribe = ctx.transport.on('sessionStart', (sid: string) => {
        this.sessionId = sid;
        this.host.requestUpdate();
      });
    }
    this.host.requestUpdate();
  }

  hostConnected(): void {}
  hostDisconnected(): void {
    this.unsubscribe?.();
  }
}
