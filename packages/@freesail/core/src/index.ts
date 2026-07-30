/**
 * @fileoverview Freesail Core - Public API
 *
 * This module exports the public API for @freesail/core.
 */

// Protocol version
export { A2UI_VERSION } from './protocol.js';

// Protocol types
export type {
  SurfaceId,
  ComponentId,
  CatalogId,
  JsonPointer,
  DataBinding,
  FunctionCall,
  DynamicValue,
  DynamicString,
  DynamicNumber,
  DynamicBoolean,
  DynamicStringList,
  ChildListTemplate,
  ChildList,
  AccessibilityAttributes,
  ServerAction,
  LocalAction,
  ComponentAction,
  ValidationCheck,
  A2UIComponent,
  CreateSurfaceMessage,
  UpdateComponentsMessage,
  UpdateDataModelMessage,
  DeleteSurfaceMessage,
  GetDataModelMessage,
  GetComponentTreeMessage,
  ActionMessage,
  ErrorMessage,
  ClientErrorCode,
  A2UIClientCapabilities,
  A2UIClientDataModel,
  DownstreamMessage,
  UpstreamMessage,
  A2UIMessage,
} from './protocol.js';

// Protocol type guards and helpers
export {
  isDataBinding,
  isFunctionCall,
  isChildListTemplate,
  isCreateSurfaceMessage,
  isUpdateComponentsMessage,
  isUpdateDataModelMessage,
  isDeleteSurfaceMessage,
  isGetDataModelMessage,
  isGetComponentTreeMessage,
  isActionMessage,
  isErrorMessage,
  isDownstreamMessage,
  isUpstreamMessage,
  componentStatePath,
  STRUCTURAL_COMPONENT_PROPS,
} from './protocol.js';

// Parser
export type { ParseResult, ParseError, ParserOptions } from './parser.js';
export { A2UIParser, parseMessage, serializeMessage } from './parser.js';

// Transport
export type {
  ConnectionState,
  TransportOptions,
  TransportEvents,
} from './transport.js';
export { A2UITransport, createTransport } from './transport.js';

// Surface Manager
export type {
  Surface,
  SerializedSurface,
  CreateSurfaceOptions,
  SurfaceManagerEvents,
  SurfaceError,
} from './surface.js';
export { SurfaceManager, createSurfaceManager } from './surface.js';

// Logger
export type { Logger, LogFn } from './logger.js';

// Data path resolution
export { getDataAtPath } from './data-path.js';

// Component metadata
export { ComponentMeta } from './component-meta.js';

// Generic component registry (shared by every renderer package)
export {
  ComponentRegistry,
  type ComponentMap,
  type FunctionLookup,
  type FunctionImplementation,
} from './registry.js';

// Framework-agnostic binding/evaluation engine (shared by every renderer package)
export {
  extractMeta,
  isDataBindingObject,
  resolveSingleBinding,
  resolveDataBindings,
  evaluateFunction,
  resolveActionContext,
  interpolateTemplate,
} from './binding-engine.js';

// Side effects (catalog function helpers)
export {
  type FreesailSideEffect,
  isFreesailSideEffect,
  dispatchAction,
  setComponentState,
} from './side-effects.js';

// Theming (framework-agnostic design tokens + CSS custom property conversion)
export {
  type FreesailThemeMode,
  type FreesailThemeTokens,
  type FreesailSurfaceTheme,
  type FreesailThemeProp,
  type CssVarMap,
  defaultLightTokens,
  defaultDarkTokens,
  resolveTokens,
  tokensToCssVars,
  surfaceThemeToCssVars,
} from './theme-utils.js';

// Shared renderer-context value shape
export type { FreesailContextValue } from './context-types.js';
