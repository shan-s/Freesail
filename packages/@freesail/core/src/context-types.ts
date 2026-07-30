/**
 * @fileoverview Shared Freesail Context Value Shape
 *
 * The renderer-context value (surface manager, transport, action dispatch)
 * has an identical shape across every framework binding — only how it's
 * threaded through the component tree differs (React Context, Lit @lit/context,
 * ...). Hoisted here so renderer packages don't each maintain a structurally
 * identical copy.
 */

import type { SurfaceManager, Surface } from './surface.js';
import type { A2UITransport } from './transport.js';
import type { SurfaceId, ComponentId } from './protocol.js';

export interface FreesailContextValue {
  /** Surface manager instance */
  surfaceManager: SurfaceManager;
  /** Transport instance (may be null if not connected) */
  transport: A2UITransport | null;
  /** Send an action (v0.9 format) */
  sendAction: (
    surfaceId: SurfaceId,
    name: string,
    sourceComponentId: ComponentId,
    context: Record<string, unknown>
  ) => Promise<void>;
  /** Get a surface by ID */
  getSurface: (surfaceId: SurfaceId) => Surface | undefined;
  /** Connection state */
  isConnected: boolean;
}
