/**
 * @fileoverview Freesail React Context
 *
 * Provides React context for Freesail state management.
 */

import { createContext, useContext } from 'react';
import type { FreesailContextValue } from '@freesail/core';

/**
 * Freesail context value.
 * Shape is shared across every renderer package — see @freesail/core.
 */
export type { FreesailContextValue };

/**
 * React context for Freesail.
 */
export const FreesailContext = createContext<FreesailContextValue | null>(null);

/**
 * Hook to access the Freesail context.
 * Throws if used outside of a FreesailProvider.
 */
export function useFreesailContext(): FreesailContextValue {
  const context = useContext(FreesailContext);
  if (!context) {
    throw new Error('useFreesailContext must be used within a FreesailProvider');
  }
  return context;
}
