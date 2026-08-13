/**
 * @fileoverview Freesail Lit Context
 *
 * Provides a @lit/context channel for Freesail state management, the Lit
 * analogue of @freesail/react's React Context. The value shape itself is
 * shared across every renderer package — see @freesail/core.
 */

import { createContext } from '@lit/context';
import type { FreesailContextValue } from '@freesail/core';

export type { FreesailContextValue };

/**
 * Context key for the Freesail runtime (surface manager, transport, action
 * dispatch). Provided by <freesail-provider> and consumed by
 * <freesail-surface> (and any other descendant that needs it) via
 * @lit/context's ContextProvider/ContextConsumer.
 */
export const freesailContext = createContext<FreesailContextValue>('freesail-context');
