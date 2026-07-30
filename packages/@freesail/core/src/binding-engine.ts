/**
 * @fileoverview Freesail Binding Engine
 *
 * Framework-agnostic data-binding resolution, function-call evaluation, and
 * `${...}` template interpolation shared by every renderer package (React,
 * Lit, ...). This is the logic that walks an A2UIComponent's resolved props,
 * resolves `{path}` data bindings and FunctionCall objects against a surface's
 * data model, and evaluates `formatString`-style template strings.
 *
 * The recursive component tree walk itself (building framework-specific
 * output nodes, wrapper elements, keyed list iteration, etc.) is NOT here —
 * that stays in each renderer package since it's irreducibly framework-specific.
 */

import type { A2UIComponent, CatalogId, ComponentId, FunctionCall } from './protocol.js';
import { isFunctionCall, componentStatePath } from './protocol.js';
import { getDataAtPath } from './data-path.js';
import { ComponentMeta } from './component-meta.js';
import type { FunctionLookup } from './registry.js';

// =============================================================================
// Meta Extraction
// =============================================================================

/**
 * Extracts __raw* and __*UpdatedAt framework metadata keys from resolved props,
 * builds a ComponentMeta, and returns the clean props (no __ keys) separately.
 */
export function extractMeta(
  resolved: Record<string, unknown>,
  dataModel: Record<string, unknown>,
  componentId: ComponentId
): { cleanProps: Record<string, unknown>; meta: ComponentMeta } {
  const bindings: Record<string, { path: string }> = {};
  const dataUpdatedAt: Record<string, number> = {};
  const cleanProps: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(resolved)) {
    if (k.startsWith('__raw') && k.length > 5) {
      // __rawValue → 'value', __rawToken → 'token'
      const cap = k.slice(5);
      bindings[cap.charAt(0).toLowerCase() + cap.slice(1)] = v as { path: string };
    } else if (k.startsWith('__') && k.endsWith('UpdatedAt')) {
      // __tokenUpdatedAt → 'token'
      dataUpdatedAt[k.slice(2, -9)] = v as number;
    } else {
      cleanProps[k] = v;
    }
  }

  const componentStateOverride =
    (getDataAtPath(dataModel, componentStatePath(componentId, '')) as Record<string, unknown>) ?? {};

  return { cleanProps, meta: new ComponentMeta(bindings, dataUpdatedAt, componentStateOverride) };
}

// =============================================================================
// Data Binding Resolution
// =============================================================================

export function isDataBindingObject(value: unknown): value is { path: string } {
  if (typeof value !== 'object' || value === null || !('path' in value)) return false;
  if (typeof (value as Record<string, unknown>)['path'] !== 'string') return false;
  if ('componentId' in value) return false; // ChildListTemplate
  if ('event' in value) return false;       // ServerAction
  if ('call' in value) return false;        // FunctionCall
  return true;
}

/**
 * Helper to resolve a single binding object, following chains.
 */
export function resolveSingleBinding(
  binding: { path: string },
  dataModel: Record<string, unknown>,
  scopeData?: unknown
): unknown {
  const path = binding.path;
  let resolvedValue: unknown;

  // "." or "" means "the current scoped item" — used when iterating scalar arrays
  if (path === '.' || path === '') {
    return scopeData !== undefined ? scopeData : getDataAtPath(dataModel, '/');
  }

  if (path.startsWith('/')) {
    resolvedValue = getDataAtPath(dataModel, path);
  } else if (scopeData !== undefined) {
    resolvedValue = getDataAtPath(scopeData as Record<string, unknown>, '/' + path);
  } else {
    resolvedValue = getDataAtPath(dataModel, '/' + path);
  }

  // Chained bindings (max depth 5)
  let depth = 0;
  while (isDataBindingObject(resolvedValue) && depth < 5) {
    const chainedPath = resolvedValue.path;
    resolvedValue = chainedPath.startsWith('/')
      ? getDataAtPath(dataModel, chainedPath)
      : getDataAtPath(dataModel, '/' + chainedPath);
    depth++;
  }

  return resolvedValue;
}

/**
 * Resolve data bindings in component properties.
 */
export function resolveDataBindings(
  component: A2UIComponent,
  dataModel: Record<string, unknown>,
  dataUpdateTimestamps: Record<string, number>,
  catalogId: CatalogId,
  registry: FunctionLookup,
  scopeData?: unknown,
  scopeBasePath?: string,
  _depth = 0
): Record<string, unknown> {
  if (_depth > 10) return {};
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(component)) {
    if (key === 'id' || key === 'component' || key === 'children' || key === 'child') {
      continue;
    }

    // Robustness: Handle double-encoded bindings
    let effectiveValue = value;
    if (typeof value === 'string' && value.trim().startsWith('{') && value.includes('"path"')) {
      try {
        const parsed = JSON.parse(value);
        if (isDataBindingObject(parsed)) {
          effectiveValue = parsed;
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (key === 'action') {
      // Don't eagerly resolve action objects — event context bindings must be
      // resolved at dispatch time (via resolveActionContext) so they reflect the
      // data model at the moment of user interaction, not at render time.
      // Recursing here also pollutes the context with __raw* keys.
      resolved[key] = effectiveValue;
    } else if (isFunctionCall(effectiveValue)) {
      resolved[key] = evaluateFunction(effectiveValue, dataModel, catalogId, registry, scopeData);
    } else if (isDataBindingObject(effectiveValue)) {
      // Preserve the raw binding so components can find the path for two-way binding.
      // If inside a scoped template, convert relative paths to absolute paths
      // so onDataChange writes to the correct location in the data model.
      const rawBinding = { ...effectiveValue };
      if (scopeBasePath && !rawBinding.path.startsWith('/')) {
        rawBinding.path = `${scopeBasePath}/${rawBinding.path}`;
      }
      resolved[`__raw${key.charAt(0).toUpperCase()}${key.slice(1)}`] = rawBinding;
      // Resolve data binding
      resolved[key] = resolveSingleBinding(effectiveValue, dataModel, scopeData);
      const ts = dataUpdateTimestamps[rawBinding.path];
      if (ts !== undefined) resolved[`__${key}UpdatedAt`] = ts;

    } else if (typeof value === 'object' && value !== null) {
      // Prevent recursion into LocalAction definitions (which contain FunctionCalls that should NOT be evaluated yet)
      if ('functionCall' in value && isFunctionCall((value as any).functionCall)) {
          resolved[key] = value;
          continue;
      }

      // Recursively resolve bindings inside objects and arrays
      if (Array.isArray(value)) {
        resolved[key] = value.map(item => {
          if (typeof item === 'object' && item !== null) {
            // Check for LocalAction in array items too
            if ('functionCall' in item && isFunctionCall((item as any).functionCall)) {
                return item;
            }
            if (isFunctionCall(item)) {
              return evaluateFunction(item, dataModel, catalogId, registry, scopeData);
            }
            if (isDataBindingObject(item)) {
              return resolveSingleBinding(item, dataModel, scopeData);
            }
            return resolveDataBindings(item as any, dataModel, dataUpdateTimestamps, catalogId, registry, scopeData, scopeBasePath, _depth + 1);
          }
          return item;
        });
      } else {
        resolved[key] = resolveDataBindings(value as any, dataModel, dataUpdateTimestamps, catalogId, registry, scopeData, scopeBasePath, _depth + 1);
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

// =============================================================================
// Function Evaluation
// =============================================================================

/**
 * Evaluate a function call.
 */
export function evaluateFunction(
  call: FunctionCall,
  dataModel: Record<string, unknown>,
  catalogId: CatalogId,
  registry: FunctionLookup,
  scopeData?: unknown
): unknown {
  const functionName = call.call;
  const funcImpl = registry.getFunction(catalogId, functionName);

  if (!funcImpl) {
    console.warn(`[Freesail] Function not found: ${functionName} in catalog ${catalogId}`);
    return undefined;
  }

  // Resolve arguments
  let rawArgs: unknown[] = [];
  if (Array.isArray(call.args)) {
    rawArgs = call.args;
  } else if (call.args && typeof call.args === 'object') {
    const entries = Object.entries(call.args);

    // Check if the registry declares paramNames for this function
    // and the keys are named (not numeric).
    // If so, reorder entries to match the declared parameter order.
    const paramNames = registry.getParamNames(catalogId, functionName);
    const hasNonNumericKeys = entries.some(([key]) => isNaN(parseInt(key.replace(/^'|'$/g, ''), 10)));

    if (paramNames && hasNonNumericKeys) {
      // Build a lookup from the entries
      const argMap = new Map(entries);
      // Reorder: first pull args matching declared param names in order,
      // then append any extra keys not in paramNames
      const ordered: unknown[] = [];
      const used = new Set<string>();
      for (const name of paramNames) {
        if (argMap.has(name)) {
          ordered.push(argMap.get(name));
          used.add(name);
        }
      }
      // Append remaining keys not in paramNames (preserves insertion order)
      for (const [key, value] of entries) {
        if (!used.has(key)) {
          ordered.push(value);
        }
      }
      rawArgs = ordered;
    } else {
      // Numeric keys or no paramNames — sort numerically as before
      entries.sort(([keyA], [keyB]) => {
        // Remove surrounding quotes if present to cleanly parse as number
        const numA = parseInt(keyA.replace(/^'|'$/g, ''), 10);
        const numB = parseInt(keyB.replace(/^'|'$/g, ''), 10);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
        return 0; // fallback to stable sort for non-numeric keys
      });
      rawArgs = entries.map(([, value]) => value);
    }

    // Robustness: agents sometimes wrap multiple positional args in a single-key
    // object as an array, e.g. { "value": [arg0, arg1] } instead of [arg0, arg1].
    // When there is exactly one entry and its value is an array, spread it so that
    // multi-arg functions like lte(a, b) receive two arguments, not one array.
    if (rawArgs.length === 1 && Array.isArray(rawArgs[0])) {
      rawArgs = rawArgs[0] as unknown[];
    }
  }

  const args = rawArgs.map(arg => {
    if (isFunctionCall(arg)) {
      return evaluateFunction(arg, dataModel, catalogId, registry, scopeData);
    }
    if (isDataBindingObject(arg)) {
      return resolveSingleBinding(arg, dataModel, scopeData);
    }
    // Handle nested arrays/objects in args
    if (typeof arg === 'object' && arg !== null) {
        if (Array.isArray(arg)) {
             return arg.map(item => {
                 if (isFunctionCall(item)) return evaluateFunction(item, dataModel, catalogId, registry, scopeData);
                 if (isDataBindingObject(item)) return resolveSingleBinding(item, dataModel, scopeData);
                 return item;
             });
        }
    }
    return arg;
  });

  // formatString: pre-process the format string for ${...} template interpolation
  let callArgs = args;
  if (functionName === 'formatString' && callArgs.length > 0 && typeof callArgs[0] === 'string') {
    callArgs = [
      interpolateTemplate(
        callArgs[0] as string,
        dataModel,
        catalogId,
        scopeData,
        (nestedCall) => evaluateFunction(nestedCall, dataModel, catalogId, registry, scopeData)
      ),
      ...callArgs.slice(1),
    ];
  }

  try {
    return funcImpl(...callArgs);
  } catch (error) {
    console.error(`[Freesail] Error evaluating function ${functionName}:`, error);
    return undefined;
  }
}

// =============================================================================
// Action Context Resolution
// =============================================================================

/**
 * Resolve data bindings in an action's context object.
 */
export function resolveActionContext(
  context: Record<string, unknown>,
  dataModel: Record<string, unknown>,
  catalogId: CatalogId,
  registry: FunctionLookup,
  scopeData?: unknown
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (isFunctionCall(value)) {
      resolved[key] = evaluateFunction(value, dataModel, catalogId, registry, scopeData);
    } else if (isDataBindingObject(value)) {
      const path = value.path;
      if (path.startsWith('/')) {
        resolved[key] = getDataAtPath(dataModel, path);
      } else if (scopeData !== undefined) {
        resolved[key] = getDataAtPath(scopeData as Record<string, unknown>, '/' + path);
      } else {
        // Relative path but no scope — normalize to absolute
        resolved[key] = getDataAtPath(dataModel, '/' + path);
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

// =============================================================================
// Template Interpolation (for formatString ${...} syntax)
// =============================================================================

/**
 * Finds the position of the closing brace that matches the opening brace at openPos,
 * respecting nested braces and quoted strings.
 */
function findMatchingBrace(str: string, openPos: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = openPos; i < str.length; i++) {
    const ch = str[i];
    const escaped = i > 0 && str[i - 1] === '\\';
    if (ch === "'" && !inDoubleQuote && !escaped) inSingleQuote = !inSingleQuote;
    if (ch === '"' && !inSingleQuote && !escaped) inDoubleQuote = !inDoubleQuote;
    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return i; }
    }
  }
  return -1;
}

/** Converts a value to a display string for interpolation output. */
function interpolatedValueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Splits a comma-separated args string into individual tokens,
 * respecting nested ${...} and quoted strings.
 */
function splitInterpolationArgs(argsStr: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    const escaped = i > 0 && argsStr[i - 1] === '\\';
    if (ch === "'" && !inDoubleQuote && !escaped) inSingleQuote = !inSingleQuote;
    else if (ch === '"' && !inSingleQuote && !escaped) inDoubleQuote = !inDoubleQuote;
    else if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Parses a single argument token from an interpolation expression.
 * Supports: 'string', "string", number, boolean, ${nested}, bare path.
 */
function parseInterpolationValue(
  token: string,
  dataModel: Record<string, unknown>,
  catalogId: string,
  scopeData: unknown,
  evalFn: (call: FunctionCall) => unknown
): unknown {
  token = token.trim();
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"')))
    return token.slice(1, -1);
  if (token.startsWith('${') && token.endsWith('}'))
    return evaluateInterpolationExpr(token.slice(2, -1), dataModel, catalogId, scopeData, evalFn);
  if (token === 'true') return true;
  if (token === 'false') return false;
  const num = Number(token);
  if (!isNaN(num) && token !== '') return num;
  if (token.startsWith('/')) return getDataAtPath(dataModel, token);
  if (scopeData !== undefined) return getDataAtPath(scopeData as Record<string, unknown>, '/' + token);
  return getDataAtPath(dataModel, '/' + token);
}

/**
 * Evaluates the expression inside ${...}: either a data path or a function call.
 */
function evaluateInterpolationExpr(
  expr: string,
  dataModel: Record<string, unknown>,
  catalogId: string,
  scopeData: unknown,
  evalFn: (call: FunctionCall) => unknown
): unknown {
  expr = expr.trim();
  // Function call: word(...)
  if (/^\w[\w.]*\(.*\)$/s.test(expr)) {
    const parenOpen = expr.indexOf('(');
    const funcName = expr.slice(0, parenOpen).trim();
    const argsStr = expr.slice(parenOpen + 1, -1).trim();
    const args: Record<string, unknown> = {};
    if (argsStr) {
      splitInterpolationArgs(argsStr).forEach((part, index) => {
        const colonIdx = part.indexOf(':');
        if (colonIdx > 0) {
          const potentialKey = part.slice(0, colonIdx).trim();
          if (/^[a-zA-Z_]\w*$/.test(potentialKey)) {
            args[potentialKey] = parseInterpolationValue(
              part.slice(colonIdx + 1).trim(), dataModel, catalogId, scopeData, evalFn
            );
            return;
          }
        }
        args[String(index)] = parseInterpolationValue(part, dataModel, catalogId, scopeData, evalFn);
      });
    }
    return evalFn({ call: funcName, args } as unknown as FunctionCall);
  }
  // Data path
  if (expr.startsWith('/')) return getDataAtPath(dataModel, expr);
  if (scopeData !== undefined) return getDataAtPath(scopeData as Record<string, unknown>, '/' + expr);
  return getDataAtPath(dataModel, '/' + expr);
}

/**
 * Processes ${...} template expressions in a formatString format string.
 * Supports: ${/absolute/path}, ${relative/field}, ${funcName(args)},
 * nested expressions (${upper(${/name})}), and escaped literals (\${).
 */
export function interpolateTemplate(
  template: string,
  dataModel: Record<string, unknown>,
  catalogId: string,
  scopeData: unknown,
  evalFn: (call: FunctionCall) => unknown
): string {
  let result = '';
  let i = 0;
  while (i < template.length) {
    // Escaped: \${ → literal ${
    if (template[i] === '\\' && template[i + 1] === '$' && template[i + 2] === '{') {
      result += '${';
      i += 3;
      continue;
    }
    // Expression: ${...}
    if (template[i] === '$' && template[i + 1] === '{') {
      const closeBrace = findMatchingBrace(template, i + 1);
      if (closeBrace === -1) { result += template[i++]; continue; }
      const expr = template.slice(i + 2, closeBrace);
      result += interpolatedValueToString(
        evaluateInterpolationExpr(expr, dataModel, catalogId, scopeData, evalFn)
      );
      i = closeBrace + 1;
      continue;
    }
    result += template[i++];
  }
  return result;
}
