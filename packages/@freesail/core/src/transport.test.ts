/**
 * @fileoverview Transport session-handshake tests.
 *
 * Focused on what happens when the gateway declines to resume a session: the client is
 * holding surfaces and queued actions that belong to a session which no longer exists,
 * and must not deliver them into the new one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { A2UITransport, type SessionStartInfo } from './transport.js';
import type { UpstreamMessage } from './protocol.js';

/** Minimal EventSource stand-in that lets a test drive open/message/error by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string, public init?: unknown) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  /** Simulate the stream opening. */
  open(): void {
    this.onopen?.();
  }

  /** Simulate the gateway's `connected` frame. */
  sendConnected(sessionId: string, resumed?: boolean): void {
    this.onmessage?.({
      data: JSON.stringify({ connected: true, sessionId, ...(resumed && { resumed: true }) }),
    });
  }

  static get latest(): FakeEventSource {
    const last = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!last) throw new Error('no EventSource was constructed');
    return last;
  }
}

function makeAction(name: string): UpstreamMessage {
  return {
    action: {
      surfaceId: 'surface-1',
      name,
      sourceComponentId: 'button-1',
      context: {},
      timestamp: new Date().toISOString(),
    },
  } as unknown as UpstreamMessage;
}

/** POST bodies the transport sent, in order. */
let posted: string[] = [];
/** surfaceIds sent to /register-surface, in order. */
let registered: string[] = [];

beforeEach(() => {
  FakeEventSource.instances = [];
  posted = [];
  registered = [];

  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.endsWith('/register-surface')) {
      registered.push(JSON.parse(init?.body ?? '{}').surfaceId);
    } else if (init?.body) {
      posted.push(init.body);
    }
    return { ok: true, status: 200, statusText: 'OK' } as Response;
  }));

  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Connect and complete the handshake, returning the transport and captured sessionStart info. */
function connectTransport() {
  const transport = new A2UITransport({ gateway: 'http://localhost:3001' });
  const starts: Array<{ sessionId: string; info: SessionStartInfo }> = [];
  const dropped: UpstreamMessage[][] = [];

  transport.on('sessionStart', (sessionId, info) => starts.push({ sessionId, info }));
  transport.on('queueDropped', (messages) => dropped.push(messages));
  transport.connect();

  return { transport, starts, dropped };
}

describe('A2UITransport session handshake', () => {
  it('reports a first connection as neither resumed nor invalidated', () => {
    const { starts } = connectTransport();

    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a');

    expect(starts).toHaveLength(1);
    expect(starts[0]?.info).toEqual({
      resumed: false,
      previousSessionId: null,
      invalidated: false,
    });
  });

  it('reports a genuine resume as not invalidated', () => {
    const { transport, starts } = connectTransport();

    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a');

    // Drop the stream, then reconnect and have the gateway hand back the same session.
    FakeEventSource.latest.onerror?.();
    transport.connect();
    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a', true);

    expect(starts[1]?.info).toEqual({
      resumed: true,
      previousSessionId: 'session-a',
      invalidated: false,
    });
  });

  it('marks the session invalidated when the gateway issues a different session', () => {
    const { transport, starts } = connectTransport();

    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a');

    FakeEventSource.latest.onerror?.();
    transport.connect();
    FakeEventSource.latest.open();
    // Grace period expired — the gateway mints a fresh session instead of resuming.
    FakeEventSource.latest.sendConnected('session-b');

    expect(starts[1]?.info).toEqual({
      resumed: false,
      previousSessionId: 'session-a',
      invalidated: true,
    });
  });

  it('does not flush queued messages before the connected frame arrives', async () => {
    const { transport } = connectTransport();

    // Queued while disconnected.
    await transport.send(makeAction('click'));
    expect(posted).toHaveLength(0);

    // The stream opening is NOT enough — the session is not yet known to be valid.
    FakeEventSource.latest.open();
    await vi.waitFor(() => expect(posted).toHaveLength(0));

    FakeEventSource.latest.sendConnected('session-a');
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(posted[0]!).action.name).toBe('click');
  });

  it('drops queued messages instead of delivering them to a new session', async () => {
    const { transport, dropped } = connectTransport();

    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a');

    // Stream drops; the action queues up while reconnecting.
    FakeEventSource.latest.onerror?.();
    await transport.send(makeAction('submit'));
    expect(posted).toHaveLength(0);

    transport.connect();
    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-b');

    await vi.waitFor(() => expect(dropped).toHaveLength(1));
    expect(dropped[0]).toHaveLength(1);
    // Never delivered: the new session has no surface-1 to act on.
    expect(posted).toHaveLength(0);
  });

  it('still flushes on resume', async () => {
    const { transport } = connectTransport();

    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a');

    FakeEventSource.latest.onerror?.();
    await transport.send(makeAction('submit'));

    transport.connect();
    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a', true);

    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(posted[0]!).action.name).toBe('submit');
  });

  it('defers a surface registered before the handshake, then sends it', async () => {
    const { transport } = connectTransport();

    // Client-created surface (e.g. a locally bootstrapped chat) claimed on mount, before
    // the session ID exists. /register-surface would 400 without one.
    transport.registerSurface('__chat');
    FakeEventSource.latest.open();
    expect(registered).toHaveLength(0);

    FakeEventSource.latest.sendConnected('session-a');
    await vi.waitFor(() => expect(registered).toEqual(['__chat']));
  });

  it('registers a client-created surface immediately once a session exists', async () => {
    const { transport } = connectTransport();

    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a');

    transport.registerSurface('__chat');
    await vi.waitFor(() => expect(registered).toEqual(['__chat']));
  });

  it('does not re-register a surface already registered with this session', async () => {
    const { transport } = connectTransport();

    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a');

    transport.registerSurface('__chat');
    await vi.waitFor(() => expect(registered).toEqual(['__chat']));

    // The provider claims every surfaceCreated, so agent-created surfaces arrive twice.
    transport.registerSurface('__chat');
    await vi.waitFor(() => expect(registered).toEqual(['__chat']));
  });

  it('re-registers surfaces after the session is invalidated', async () => {
    const { transport } = connectTransport();

    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-a');
    transport.registerSurface('__chat');
    await vi.waitFor(() => expect(registered).toEqual(['__chat']));

    FakeEventSource.latest.onerror?.();
    transport.connect();
    FakeEventSource.latest.open();
    FakeEventSource.latest.sendConnected('session-b');

    // session-b has no surface→session mappings, so a repeat claim must go through.
    transport.registerSurface('__chat');
    await vi.waitFor(() => expect(registered).toEqual(['__chat', '__chat']));
  });

  it('flushes anyway if the gateway never sends a connected frame', async () => {
    vi.useFakeTimers();
    const { transport } = connectTransport();

    await transport.send(makeAction('click'));
    FakeEventSource.latest.open();
    expect(posted).toHaveLength(0);

    // A gateway that speaks SSE but not the Freesail handshake must not strand the queue.
    await vi.advanceTimersByTimeAsync(2100);
    expect(posted).toHaveLength(1);
  });
});
