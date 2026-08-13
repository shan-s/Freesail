/**
 * @fileoverview Lit Component Tree Renderer
 *
 * The recursive walk that turns a surface's flat A2UIComponent adjacency map
 * into lit-html output. This is the Lit-specific counterpart to
 * @freesail/react's `renderComponent()` — it is a small, framework-specific
 * shell around the shared, framework-agnostic binding/evaluation engine in
 * @freesail/core (resolveDataBindings, evaluateFunction, resolveActionContext,
 * extractMeta), which it calls exactly the way the React renderer does,
 * passing this package's own `registry` as the FunctionLookup.
 */

import { html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  resolveDataBindings,
  evaluateFunction,
  resolveActionContext,
  extractMeta,
} from '@freesail/core';
import type {
  A2UIComponent,
  CatalogId,
  ComponentId,
  ChildList,
} from '@freesail/core';
import { registry, type FreesailComponentProps } from './registry.js';
import { getDataAtPath } from './utils.js';
import { isFreesailSideEffect } from './types.js';

/**
 * Dispatch function type for actions.
 */
export type ActionDispatch = (
  name: string,
  sourceComponentId: ComponentId,
  context: Record<string, unknown>
) => Promise<void>;

/**
 * Callback for two-way binding: components write values to the local data model.
 */
export type DataChangeDispatch = (path: string, value: unknown) => void;

/**
 * Renders a single A2UI component (and its descendants) to lit-html output.
 */
export function renderComponent(
  componentId: ComponentId,
  components: Map<ComponentId, A2UIComponent>,
  catalogId: CatalogId,
  dataModel: Record<string, unknown>,
  dataUpdateTimestamps: Record<string, number>,
  dispatch: ActionDispatch,
  onDataChange: DataChangeDispatch,
  scopeData?: unknown,
  scopeBasePath?: string
): TemplateResult | typeof nothing {
  const componentDef = components.get(componentId);
  if (!componentDef) {
    // Component may arrive in a subsequent update_components batch — render nothing for now
    return nothing;
  }

  // Get the render function from the registry
  const Component = registry.getComponent(catalogId, componentDef.component);
  if (!Component) {
    return unknownComponent(componentDef);
  }

  // Render children recursively.
  // Deliberately `undefined`, not lit's `nothing` sentinel: catalog components
  // commonly do `children ?? component['someProp'] ?? fallback` (e.g. Button's
  // `children ?? label`) to let content override a prop-driven default.
  // `nothing` is a real, non-nullish object, so it would defeat that `??`
  // fallback; `undefined` renders identically as "nothing" in a child
  // position but stays nullish for prop-fallback logic.
  let children: unknown = undefined;

  // 1. Handle single child (for Card, etc.)
  if (componentDef.child) {
    children = renderComponent(
      componentDef.child,
      components,
      catalogId,
      dataModel,
      dataUpdateTimestamps,
      dispatch,
      onDataChange,
      scopeData,
      scopeBasePath
    );
  }
  // 2. Handle multiple standard children (Column, Row, List, etc.)
  else if (componentDef.children) {
    const childList = componentDef.children as ChildList;

    if (Array.isArray(childList)) {
      // Static array of child IDs
      children = childList.map((childId) =>
        renderComponent(childId, components, catalogId, dataModel, dataUpdateTimestamps, dispatch, onDataChange, scopeData, scopeBasePath)
      );
    } else if (typeof childList === 'object' && 'componentId' in childList) {
      // Template for dynamic children
      const template = childList;
      // Resolve relative paths against the current scope's base path so nested
      // templates (e.g. skills inside a developer iteration) work correctly.
      const resolvedTemplatePath = !template.path.startsWith('/') && scopeBasePath
        ? `${scopeBasePath}/${template.path}`
        : template.path;
      const listData = getDataAtPath(dataModel, resolvedTemplatePath);

      if (Array.isArray(listData)) {
        children = repeat(
          listData,
          (itemData, index) => `${template.componentId}_${(itemData as any)?.id ?? index}`,
          (itemData, index) => {
            // Build the absolute path for this item in the data model
            const itemBasePath = `${resolvedTemplatePath}/${index}`;
            return renderComponent(
              template.componentId,
              components,
              catalogId,
              dataModel,
              dataUpdateTimestamps,
              dispatch,
              onDataChange,
              itemData, // Pass item data as scope
              itemBasePath // Absolute path for two-way binding
            );
          }
        );
      }
    }
  }

  // Resolve data bindings in component properties
  const resolvedProps = resolveDataBindings(componentDef, dataModel, dataUpdateTimestamps, catalogId, registry, scopeData, scopeBasePath);
  const { cleanProps, meta } = extractMeta(resolvedProps, dataModel, componentId);

  // Visibility check: if `visible` resolves to exactly false, skip rendering.
  // Component state override (from show/hide) takes precedence over component prop.
  const visibilityOverride = meta.getComponentState('visible');
  const effectiveVisible = visibilityOverride != null ? visibilityOverride : cleanProps['visible'];
  if (effectiveVisible === false || effectiveVisible === 'false') {
    return nothing;
  }

  // Build props
  const props: FreesailComponentProps = {
    component: { ...componentDef, ...cleanProps },
    meta,
    children,
    dataModel,
    scopeData,
    onAction: (name, context) => {
      // Resolve data bindings in action context at dispatch time.
      const resolvedContext = resolveActionContext(context, dataModel, catalogId, registry, scopeData);
      return dispatch(name, componentDef.id, resolvedContext);
    },
    onDataChange,
    onFunctionCall: (call) => {
      const result = evaluateFunction(call, dataModel, catalogId, registry, scopeData);
      if (!isFreesailSideEffect(result)) return;
      if (result._effect === 'dataModelUpdate') {
        onDataChange(result.path, result.value);
      }
      const action = result._effect === 'actionDispatch'
        ? { name: result.name, context: result.context }
        : result.action;
      if (action) {
        dispatch(action.name, componentDef.id, action.context);
      }
    },
  };

  let rendered: TemplateResult;
  try {
    rendered = Component(props);
  } catch (err) {
    console.error(`[Freesail] Component render error (${componentDef.component}):`, err);
    return unknownComponent(componentDef);
  }

  // --- AUTOMATIC DOM TAGGING (WRAPPER APPROACH) ---
  // Use a wrapper div with display:contents so that data attributes
  // stay on a real DOM element instead of leaking as props into the
  // rendered component's own markup.
  const taggedRendered = html`<div data-freesail-component=${componentDef.component} data-freesail-id=${componentId} style="display:contents">${rendered}</div>`;
  // --------------------------------------------------

  // Apply layout properties (weight, width, height) using a wrapper div.
  // Uses a data attribute so parent layouts (e.g. GridLayout) can override
  // with display:contents if needed.
  const weight = resolvedProps['weight'] as number | undefined;
  const width = resolvedProps['width'] as string | undefined;
  const height = resolvedProps['height'] as string | undefined;
  const flexBasis = resolvedProps['flexBasis'] as string | undefined;
  const minWidth = resolvedProps['minWidth'] as string | undefined;
  const minHeight = resolvedProps['minHeight'] as string | undefined;

  if (weight != null || width != null || height != null || flexBasis != null || minWidth != null || minHeight != null) {
    const wrapperStyle: Record<string, string> = {
      flex: weight != null ? `${weight} 1 ${flexBasis ?? 'auto'}` : '0 0 auto',
      minWidth: minWidth ?? flexBasis ?? 'min-content',
      minHeight: minHeight ?? '0',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    };
    if (weight != null && !flexBasis && !minWidth) wrapperStyle['maxWidth'] = 'max-content';
    if (weight != null) wrapperStyle['alignSelf'] = 'stretch';
    if (width != null) wrapperStyle['width'] = width;
    if (height != null) wrapperStyle['height'] = height;

    return html`<div data-freesail-weight=${weight != null ? 'true' : nothing} style=${styleMap(wrapperStyle)}>${taggedRendered}</div>`;
  }
  return taggedRendered;
}

function unknownComponent(component: A2UIComponent): TemplateResult {
  return html`
    <div style="padding: 8px; border: 1px dashed #f00; background: #fee; margin: 4px;">
      <strong>Unknown Component:</strong> ${component.component}
      <pre style="font-size: 10px">${JSON.stringify(component, null, 2)}</pre>
    </div>
  `;
}
