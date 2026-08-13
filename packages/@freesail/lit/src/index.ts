/**
 * @fileoverview Freesail Lit - Public API
 */

// Provider
export {
  FreesailProviderElement,
  type SurfaceInterceptorResult,
  type BeforeCreateSurface,
  type BeforeUpdateComponents,
  type BeforeUpdateDataModel,
  type BeforeDeleteSurface,
} from './FreesailProviderElement.js';

// Surface Element
export { FreesailSurfaceElement, type SurfaceTemplateFactory } from './FreesailSurfaceElement.js';

// Context
export { freesailContext, type FreesailContextValue } from './context.js';

// Reactive Controllers (the hooks.ts analogue)
export {
  SurfaceController,
  SurfaceDataController,
  ConnectionStatusController,
  SurfacesController,
  SessionIdController,
  dispatchSurfaceAction,
  type ActionDispatch,
} from './controllers.js';

// Registry
export {
  registry,
  withCatalog,
  registerCatalog,
  ComponentMeta,
  type FreesailComponent,
  type FreesailComponentProps,
} from './registry.js';

// Types
export {
  type CatalogDefinition,
  type FunctionImplementation,
  type FreesailSideEffect,
  isFreesailSideEffect,
  setComponentState,
  dispatchAction,
} from './types.js';

// Re-export core types for convenience
export type {
  SurfaceId,
  ComponentId,
  CatalogId,
  A2UIComponent,
  Surface,
  SurfaceManager,
} from '@freesail/core';

// Theme
export * from './theme.js';

// Component tree renderer (exposed for advanced/custom surface elements)
export { renderComponent, type ActionDispatch as RenderActionDispatch, type DataChangeDispatch } from './render-tree.js';
