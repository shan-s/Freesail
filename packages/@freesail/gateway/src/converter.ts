/**
 * @fileoverview Catalog Converter
 *
 * Converts catalog.json component definitions into MCP Tool schemas.
 * This enables the Agent to see available UI components as callable tools.
 */

/**
 * Bundled definitions from common_types.json and CatalogComponentCommon.
 * These are inlined so the gateway doesn't need to perform filesystem I/O
 * or take an extra package dependency to resolve $refs at prompt-generation time.
 *
 * Keep in sync with:
 *   packages/@freesail/catalogs/src/common/common_types.json
 *   packages/@freesail/catalogs/src/standard_catalog/standard_catalog.json#/$defs
 */
const BUNDLED_DEFS: Record<string, Record<string, unknown>> = {
  // ---- From common_types.json ------------------------------------------------
  ComponentCommon: {
    properties: {
      // 'id' is already documented in the system prompt — skip to avoid noise
      accessibility: {
        type: 'object',
        description: 'Accessibility attributes (label, description) for assistive technologies.',
      },
      visible: {
        type: 'boolean',
        description: 'Controls whether the component is rendered. Defaults to true.',
        default: true,
      },
    },
  },
  Checkable: {
    properties: {
      checks: {
        type: 'array',
        description:
          'A list of validation checks. Each check has a condition (DynamicBoolean) and a message. ' +
          'If any condition evaluates to false the component shows the error or is disabled.',
      },
    },
  },
  // ---- From standard_catalog.json $defs -------------------------------------
  CatalogComponentCommon: {
    properties: {
      weight: {
        type: 'number',
        description:
          'Flex-grow weight of this component within a Row or Column container. ' +
          'Only meaningful when the component is a direct child of a Row or Column.',
      },
    },
  },
};

/**
 * Resolve a JSON $ref string to a schema object.
 *
 * Handles two patterns:
 *   - "#/$defs/Foo"           → looks up in catalogDefs, then BUNDLED_DEFS
 *   - "path/to/file.json#/$defs/Foo" → extracts "Foo" and looks up in BUNDLED_DEFS
 *
 * @returns the resolved schema object, or null if it cannot be resolved.
 */
function resolveRef(
  ref: string,
  catalogDefs?: Record<string, unknown>
): Record<string, unknown> | null {
  const hash = ref.indexOf('#');
  if (hash === -1) return null;

  const fragment = ref.slice(hash + 1); // e.g. "/$defs/Checkable"
  const parts = fragment.split('/').filter(Boolean); // ["$defs", "Checkable"]

  if (parts.length < 2 || parts[0] !== '$defs') return null;
  const defName = parts[1];
  if (!defName) return null; // narrow string | undefined → string

  // 1. Try the catalog's own $defs (for internal #/$defs/... refs)
  if (catalogDefs && defName in catalogDefs) {
    return catalogDefs[defName] as Record<string, unknown>;
  }

  // 2. Fall back to bundled common-type definitions
  const bundled = BUNDLED_DEFS[defName];
  if (bundled) return bundled;

  return null;
}

import { z } from 'zod';
import Ajv, { type ValidateFunction } from 'ajv';

/**
 * Extracts the description from a component, searching through allOf entries if not at top level.
 */
function extractDescription(component: CatalogComponent): string | undefined {
  if (component.description) return component.description;
  if (component.allOf) {
    for (const sub of component.allOf) {
      const s = sub as CatalogComponent;
      if (s.description) return s.description;
    }
  }
  return undefined;
}

/**
 * Schema for a component property in the catalog.
 */
export interface CatalogProperty {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
  items?: CatalogProperty;
  $ref?: string;
  oneOf?: CatalogProperty[];
  anyOf?: CatalogProperty[];
  allOf?: CatalogProperty[];
  properties?: Record<string, CatalogProperty>;
  additionalProperties?: boolean;
  const?: unknown;
}

/**
 * Schema for a component definition in the catalog.
 */
export interface CatalogComponent {
  description?: string;
  properties?: Record<string, CatalogProperty>;
  children?: boolean; // Kept for backward compatibility, but v0.9 uses ChildList type
  allOf?: unknown[]; // v0.9 uses allOf for inheritance
  unevaluatedProperties?: boolean;
}

/**
 * Full catalog schema.
 */
export interface Catalog {
  id: string; 
  catalogId: string; 
  title: string;
  description?: string;
  $defs?: Record<string, unknown>;
  components: Record<string, CatalogComponent>;
  functions?: Record<string, {
    description?: string;
    args?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    returnType?: string;
  }>;
  /** Freesail SDK version the client catalog was built against. Used for future compatibility checks. */
  freesailSdkVersion?: string;
}

/**
 * MCP Tool definition.
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Converts a catalog to MCP tool schemas.
 */
export function catalogToMCPTools(catalog: Catalog): MCPTool[] {
  const catalogDefs = (catalog.$defs ?? {}) as Record<string, unknown>;
  return Object.entries(catalog.components).map(([name, component]) => ({
    name: `render_${name.toLowerCase()}`,
    description: extractDescription(component) ?? `Render a ${name} component`,
    inputSchema: componentToSchema(name, component, catalogDefs),
  }));
}

/**
 * Converts a component definition to a JSON Schema.
 */
function componentToSchema(
  name: string,
  component: CatalogComponent,
  catalogDefs?: Record<string, unknown>
): MCPTool['inputSchema'] {
  const properties: Record<string, unknown> = {
    id: {
      type: 'string',
      description: 'Unique identifier for this component instance',
    },
  };

  const required: string[] = ['id'];

  // Helper to extract properties from a component definition or its sub-schemas
  const extractProperties = (def: CatalogComponent) => {
    if (def.properties) {
      for (const [propName, prop] of Object.entries(def.properties)) {
        // Skip 'component' property as it is fixed
        if (propName === 'component') continue;

        properties[propName] = propertyToSchema(prop);
        if (prop.required) {
          if (!required.includes(propName)) required.push(propName);
        }
      }
    }

    // Handle standard JSON Schema 'required' array
    if (Array.isArray((def as any).required)) {
      const reqArray = (def as any).required as string[];
      reqArray.forEach(fieldName => {
        if (fieldName !== 'component' && !required.includes(fieldName)) {
          required.push(fieldName);
        }
      });
    }

    if (def.allOf) {
      for (const sub of def.allOf) {
        const subDef = sub as CatalogComponent & { $ref?: string };
        if (subDef.$ref) {
          // Resolve external/internal $ref before recursing
          const resolved = resolveRef(subDef.$ref, catalogDefs);
          if (resolved) extractProperties(resolved as CatalogComponent);
        } else {
          extractProperties(subDef);
        }
      }
    }
  };

  extractProperties(component);

  // Handle children support explicitly
  const supportsChildren =
    component.children === true ||
    (properties['children'] !== undefined);

  if (supportsChildren) {
    // If not already defined by extractProperties (e.g. from allOf), define it
    if (!properties['children']) {
      properties['children'] = {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of child components',
      };
    }
    // Note: children might be required by the component logic, but we make it optional in tool schema 
    // to allow empty containers unless strictly required.
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Converts a property definition to JSON Schema.
 */
function propertyToSchema(prop: CatalogProperty): Record<string, unknown> {
  // Common schemas for data binding and function call forms
  const bindingSchema = {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  };
  // Function call {call: "name", ...} — resolved client-side, passes validation
  const functionCallSchema = {
    type: 'object',
    required: ['call'],
    properties: { call: { type: 'string' } },
  };

  if (prop.$ref) {
    const ref = prop.$ref;
    const refBaseName = ref.split('/').pop() || '';
    if (refBaseName === 'DynamicStringList') {
      return {
        anyOf: [{ type: 'array', items: { type: 'string' } }, bindingSchema, functionCallSchema],
        description: prop.description,
      };
    }
    if (refBaseName === 'DynamicString') {
      return {
        anyOf: [{ type: 'string' }, bindingSchema, functionCallSchema],
        description: prop.description,
      };
    }
    if (refBaseName === 'DynamicNumber') {
      return {
        anyOf: [{ type: 'number' }, bindingSchema, functionCallSchema],
        description: prop.description,
      };
    }
    if (refBaseName === 'DynamicBoolean') {
      return {
        anyOf: [{ type: 'boolean' }, bindingSchema, functionCallSchema],
        description: prop.description,
      };
    }
    if (refBaseName === 'ChildList') {
      return {
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          {
            type: 'object',
            properties: { componentId: { type: 'string' }, path: { type: 'string' } },
            required: ['componentId', 'path'],
          },
        ],
        description: prop.description,
      };
    }
    // Unresolved $ref (e.g. Action, DynamicValue, custom types) — accept any value
    return prop.description ? { description: prop.description } : {};
  }

  // Handle oneOf / anyOf / allOf by recursing into each branch
  if (prop.oneOf) {
    return {
      oneOf: prop.oneOf.map(p => propertyToSchema(p)),
      ...(prop.description ? { description: prop.description } : {}),
    };
  }
  if (prop.anyOf) {
    return {
      anyOf: prop.anyOf.map(p => propertyToSchema(p)),
      ...(prop.description ? { description: prop.description } : {}),
    };
  }
  if (prop.allOf) {
    return {
      allOf: prop.allOf.map(p => propertyToSchema(p)),
      ...(prop.description ? { description: prop.description } : {}),
    };
  }

  if (!prop.type) {
    // No type info — accept any value
    return prop.description ? { description: prop.description } : {};
  }

  const schema: Record<string, unknown> = {
    type: prop.type,
  };

  if (prop.description) {
    schema['description'] = prop.description;
  }

  // NOTE: enum is intentionally NOT copied into the Ajv validation schema.
  // Enums are soft hints for the LLM (shown in the prompt via generateCatalogPrompt)
  // but not hard constraints — e.g. Material Symbols supports thousands of icon
  // names beyond the curated catalog list.

  if (prop.default !== undefined) {
    schema['default'] = prop.default;
  }

  if (prop.const !== undefined) {
    schema['const'] = prop.const;
  }

  if (prop.type === 'array' && prop.items) {
    schema['items'] = propertyToSchema(prop.items);
  }

  // Preserve inner object structure for strict validation of known properties
  if (prop.type === 'object') {
    if (prop.properties) {
      const innerProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prop.properties)) {
        innerProps[k] = propertyToSchema(v);
      }
      schema['properties'] = innerProps;
    }
    const rawProp = prop as Record<string, unknown>;
    if (Array.isArray(rawProp['required'])) {
      schema['required'] = rawProp['required'];
    }
    if (prop.additionalProperties !== undefined) {
      schema['additionalProperties'] = prop.additionalProperties;
    }
  }

  return schema;
}

/**
 * Generates the system prompt injection for the catalog.
 */
const catalogPromptCache = new WeakMap<Catalog, string>();

/**
 * Formats a catalog property type into a compact, TypeScript-like string.
 * @param prop The property schema
 * @param depth Current recursion depth (capped at 2)
 */
function formatPropertyType(prop: CatalogProperty, depth = 0): string {
  if (depth > 2) return 'any';

  // 1. $ref handling
  if (prop.$ref) {
    const base = prop.$ref.split('/').pop() || 'unknown';
    if (base === 'DataBinding') return '{"path":"..."}';
    if (base === 'ChildList') return 'string[] | ChildTemplate';
    if (base === 'ComponentId') return 'ComponentId';
    if (base === 'Action') return 'Action';
    
    if (base.startsWith('Dynamic')) {
      const plainType = base.replace('Dynamic', '').toLowerCase();
      // Special case for DynamicStringList -> array -> string[]
      const t = plainType === 'stringlist' ? 'string[]' : plainType;
      return `${t} | {"path":"..."} | {"call":"..."}`;
    }
    return base;
  }

  // 2. Enum values (if type is string/number)
  if (prop.enum && prop.enum.length > 0) {
    // We handle the values display at the property line level, so just return the base type
    return prop.type || 'string';
  }

  // 3. Arrays
  if (prop.type === 'array') {
    if (prop.items) {
      const itemType = formatPropertyType(prop.items, depth + 1);
      return `array[${itemType}]`;
    }
    return 'array';
  }

  // 4. Objects (inline schema extraction)
  if (prop.type === 'object' && prop.properties) {
    const props: string[] = [];
    for (const [key, val] of Object.entries(prop.properties)) {
      const isReq = prop.required && Array.isArray(prop.required) ? prop.required.includes(key) : false;
      const t = formatPropertyType(val, depth + 1);
      props.push(`${key}${isReq ? '' : '?'}: ${t}`);
    }
    return `{${props.join(', ')}}`;
  }

  // 5. oneOf / anyOf
  if (prop.oneOf || prop.anyOf) {
    const branches = (prop.oneOf ?? prop.anyOf)!;
    const types = branches.map(b => formatPropertyType(b, depth + 1));
    return types.filter(t => t !== 'any').join(' | ') || 'any';
  }

  // 6. allOf
  if (prop.allOf) {
    // allOf in properties is usually used for conditional constraints,
    // find the first branch with actual type information
    const primary = prop.allOf.find(b => b.$ref || b.type);
    if (primary) {
      return formatPropertyType(primary, depth + 1);
    }
  }

  return prop.type || 'any';
}

export function generateCatalogPrompt(catalog: Catalog): string {
  const cached = catalogPromptCache.get(catalog);
  if (cached) return cached;

  const name = catalog.title;
  const id = catalog.catalogId;

  const lines: string[] = [
    `## UI Catalog: ${name}`,
    `**Catalog ID (use this as catalogId in create_surface):** \`${id}\``,
    '',
    catalog.description ?? 'Available UI components for rendering interfaces.',
    '',
    '### Available Components:',
    '',
  ];

  for (const [componentName, component] of Object.entries(catalog.components)) {
    lines.push(`**${componentName}**`);
    const componentDesc = extractDescription(component);
    if (componentDesc) {
      lines.push(`  ${componentDesc}`);
    }
    // Helper to collect all properties including from allOf + $ref resolution
    const allProps: Record<string, CatalogProperty> = {};
    const collectProps = (def: CatalogComponent, depth = 0) => {
      if (depth > 5) return; // guard against circular refs
      if (def.properties) {
        Object.assign(allProps, def.properties);
      }
      if (def.allOf) {
        def.allOf.forEach(sub => {
          const subDef = sub as CatalogComponent & { $ref?: string };
          if (subDef.$ref) {
            const resolved = resolveRef(subDef.$ref, catalog.$defs as Record<string, unknown>);
            if (resolved) collectProps(resolved as CatalogComponent, depth + 1);
          } else {
            collectProps(subDef, depth + 1);
          }
        });
      }
      // Also handle a bare $ref at the top level of a sub-schema
      if ((def as any).$ref && !def.properties && !def.allOf) {
        const resolved = resolveRef((def as any).$ref, catalog.$defs as Record<string, unknown>);
        if (resolved) collectProps(resolved as CatalogComponent, depth + 1);
      }
    };
    collectProps(component);

    // Collect all required fields (also follows $refs)
    const requiredFields = new Set<string>();
    const collectRequired = (def: CatalogComponent, depth = 0) => {
      if (depth > 5) return;
      // Individual property required flag
      if (def.properties) {
        for (const [key, prop] of Object.entries(def.properties)) {
          if (prop.required) requiredFields.add(key);
        }
      }
      // Top-level required array
      if (Array.isArray((def as any).required)) {
        ((def as any).required as string[]).forEach((k: string) => requiredFields.add(k));
      }
      // Recurse
      if (def.allOf) {
        def.allOf.forEach(sub => {
          const subDef = sub as CatalogComponent & { $ref?: string };
          if (subDef.$ref) {
            const resolved = resolveRef(subDef.$ref, catalog.$defs as Record<string, unknown>);
            if (resolved) collectRequired(resolved as CatalogComponent, depth + 1);
          } else {
            collectRequired(subDef, depth + 1);
          }
        });
      }
    };
    collectRequired(component);


    if (Object.keys(allProps).length > 0) {
      lines.push('  Properties:');

      const reqProps: string[] = [];
      const optProps: string[] = [];

      for (const [propName, prop] of Object.entries(allProps)) {
        if (propName === 'component') continue;

        // Get robust compact type string
        const typeStr = formatPropertyType(prop);

        // Extract enum values — check top-level first, then drill into oneOf/anyOf branches
        let enumValues = prop.enum;
        if ((!enumValues || enumValues.length === 0) && (prop.oneOf || prop.anyOf)) {
          for (const branch of (prop.oneOf ?? prop.anyOf)!) {
            if (branch.enum && branch.enum.length > 0) {
              enumValues = branch.enum;
              break;
            }
          }
        }
        
        const enumSuffix = enumValues && enumValues.length > 0 ? ` (values: ${enumValues.join(', ')})` : '';
        const defaultSuffix = prop.default !== undefined ? ` (default: ${JSON.stringify(prop.default)})` : '';
        const desc = prop.description ? ` — ${prop.description}` : '';
        const line = `    - ${propName}: ${typeStr}${enumSuffix}${defaultSuffix}${desc}`;

        if (requiredFields.has(propName)) {
          reqProps.push(line);
        } else {
          optProps.push(line);
        }
      }

      if (reqProps.length > 0) {
        lines.push('    [REQUIRED]');
        lines.push(...reqProps);
      }
      if (optProps.length > 0) {
        lines.push('    [OPTIONAL]');
        lines.push(...optProps);
      }
    }

    // Check for children support
    const supportsChildren =
      component.children === true ||
      (allProps['children'] !== undefined);

    if (supportsChildren) {
      lines.push('  Supports children: yes');
    }
    lines.push('');
  }

  // Include Available Functions
  const funcEntries = catalog.functions ? Object.entries(catalog.functions) : [];
  if (funcEntries.length > 0) {
    lines.push('### Available Functions:', '');
    lines.push('Use the `args` object to pass named arguments to functions. Use the argument names documented below as keys.');
    lines.push('');
    for (const [name, func] of funcEntries) {
      // Build parameter signature from schema
      const argsDef = func.args as Record<string, unknown> | undefined;
      const params = func.parameters as Record<string, unknown> | undefined;

      let sig = '';
      // Prefer new args.properties format
      const argsProps = argsDef?.['properties'] as Record<string, unknown> | undefined;
      const argsRequired = argsDef?.['required'] as string[] | undefined;
      if (argsProps && Object.keys(argsProps).length > 0) {
        const requiredSet = new Set(argsRequired ?? []);
        const paramParts = Object.entries(argsProps).map(([argName, argSchema]) => {
          const schema = argSchema as Record<string, unknown>;
          const desc = schema['description'] as string | undefined;
          const ref = schema['$ref'] as string | undefined;
          let typeName = 'any';
          if (ref) {
            const base = ref.split('/').pop() || 'any';
            typeName = base.startsWith('Dynamic') ? base.replace('Dynamic', '').toLowerCase() : base;
          } else if (schema['type']) {
            typeName = schema['type'] as string;
          }
          const optional = !requiredSet.has(argName);
          return `${argName}: ${typeName}${optional ? '?' : ''}${desc ? ` /* ${desc} */` : ''}`;
        });
        sig = `(${paramParts.join(', ')})`;
      } else if (params) {
        // Fallback: legacy parameters format
        const items = params['items'];
        const allOfParams = params['allOf'];
        const props = params['properties'] as Record<string, unknown>;
        if (Array.isArray(items) && items.length > 0) {
          const paramParts = items.map((item: Record<string, unknown>, i: number) => {
            const paramName = item['name'] as string | undefined;
            const desc = item['description'] as string | undefined;
            const ref = item['$ref'] as string | undefined;
            let typeName = 'any';
            if (ref) {
              const base = ref.split('/').pop() || 'any';
              typeName = base.startsWith('Dynamic') ? base.replace('Dynamic', '').toLowerCase() : base;
            } else if (item['type']) {
              typeName = item['type'] as string;
            }
            const minItems = params?.['minItems'] as number | undefined;
            const optional = minItems !== undefined && i >= minItems;
            const label = paramName ? `${paramName}: ${typeName}` : typeName;
            return `${label}${optional ? '?' : ''}${desc ? ` /* ${desc} */` : ''}`;
          });
          sig = `(${paramParts.join(', ')})`;
        } else if (allOfParams && Array.isArray(allOfParams)) {
          const argsObj = (allOfParams as any[]).find((p: any) => p.type === 'object' && p.properties);
          if (argsObj && argsObj.properties) {
             const keys = Object.keys(argsObj.properties);
             sig = `(${keys.map(k => `${k}: ${(argsObj.properties[k] as any).type || 'any'}`).join(', ')})`;
          } else {
             sig = '()';
          }
        } else if (props) {
          const keys = Object.keys(props);
          sig = `(${keys.map(k => `${k}: ${(props[k] as any).type || 'any'}`).join(', ')})`;
        } else {
          sig = '()';
        }
      } else {
        sig = '()';
      }
      const ret = func.returnType ? ` → ${func.returnType}` : '';
      lines.push(`**${name}**${sig}${ret}`);
      if (func.description) {
        lines.push(`  ${func.description}`);
      }
      lines.push('');
    }
  }

  const result = lines.join('\n');
  catalogPromptCache.set(catalog, result);
  return result;
}

// Ajv singleton — compiled validators are cached per component type per catalog
const ajv = new Ajv({ allErrors: true, strict: false });

// Cache: "catalogId:componentType" → compiled validator
const componentValidators = new Map<string, ValidateFunction>();

function getComponentValidator(catalog: Catalog, componentType: string): ValidateFunction | null {
  const key = `${catalog.catalogId}:${componentType.toLowerCase()}`;
  const cached = componentValidators.get(key);
  if (cached) return cached;

  const entry = Object.entries(catalog.components).find(
    ([name]) => name.toLowerCase() === componentType.toLowerCase()
  );
  if (!entry) return null;

  const [name, component] = entry;
  const catalogDefs = (catalog.$defs ?? {}) as Record<string, unknown>;
  const schema = componentToSchema(name, component, catalogDefs);
  const validator = ajv.compile(schema);
  componentValidators.set(key, validator);
  return validator;
}

/**
 * Validates a component instance against the catalog using ajv.
 * The compiled schema comes from componentToSchema(), which is the same schema
 * projected to the agent as an MCP tool — so the two are always in sync.
 */
export function validateComponent(
  catalog: Catalog,
  componentType: string,
  props: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  if (!Object.entries(catalog.components).find(
    ([name]) => name.toLowerCase() === componentType.toLowerCase()
  )) {
    return { valid: false, errors: [`Unknown component type: ${componentType}`] };
  }

  const validator = getComponentValidator(catalog, componentType);
  if (!validator) {
    return { valid: false, errors: [`Could not build validator for component: ${componentType}`] };
  }

  const errors: string[] = [];

  const valid = validator(props);
  if (!valid) {
    errors.push(
      ...(validator.errors ?? []).map(err => {
        const field = err.instancePath
          ? err.instancePath.replace(/^\//, '')
          : (err.params as any)?.missingProperty ?? 'field';
        return `${field}: ${err.message}`;
      })
    );
  }

  // Validate function calls reference known catalog functions
  const funcErrors = validateFunctionCalls(catalog, props);
  errors.push(...funcErrors);

  return { valid: errors.length === 0, errors };
}

/**
 * Recursively walks component property values and validates that any
 * `{call: "functionName"}` objects reference functions defined in the catalog.
 * Returns error strings for unknown function names.
 */
function validateFunctionCalls(
  catalog: Catalog,
  props: Record<string, unknown>
): string[] {
  const knownFunctions = catalog.functions ? new Set(Object.keys(catalog.functions)) : new Set<string>();
  const errors: string[] = [];

  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) return;

    if (typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (typeof obj['call'] === 'string') {
        const fnName = obj['call'];
        if (knownFunctions.size > 0 && !knownFunctions.has(fnName)) {
          errors.push(`${path}: unknown function '${fnName}' (available: ${[...knownFunctions].join(', ')})`);
        }
      }
      for (const [key, val] of Object.entries(obj)) {
        walk(val, path ? `${path}.${key}` : key);
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
    }
  }

  walk(props, '');
  return errors;
}

// Zod schemas for runtime validation

const catalogPropertySchema: z.ZodType<CatalogProperty> = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'number', 'boolean', 'array', 'object']).optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    enum: z.array(z.string()).optional(),
    default: z.unknown().optional(),
    items: catalogPropertySchema.optional(),
    $ref: z.string().optional(),
  }).passthrough()
);

const catalogComponentSchema = z.object({
  description: z.string().optional(),
  properties: z.record(catalogPropertySchema).optional(),
  children: z.boolean().optional(),
  allOf: z.array(z.unknown()).optional(),
  unevaluatedProperties: z.boolean().optional(),
}).passthrough();

const catalogFunctionSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  parameters: z.record(z.unknown()).optional(),
  returnType: z.string().optional(),
}).passthrough();

export const catalogSchema = z.object({
  id: z.string().optional(),
  catalogId: z.string(),
  title: z.string(),
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  $defs: z.record(z.unknown()).optional(),
  components: z.record(catalogComponentSchema),
  functions: z.record(catalogFunctionSchema).optional(),
  freesailSdkVersion: z.string().optional(),
}).passthrough();

/**
 * Parse and validate a catalog JSON.
 */
export function parseCatalog(json: unknown): Catalog {
  // Normalise legacy field names before validation so older catalogs still work
  const input = (typeof json === 'object' && json !== null)
    ? { ...(json as Record<string, unknown>) }
    : json;
  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>;
    if (!obj['catalogId'] && obj['$id']) obj['catalogId'] = obj['$id'];
    if (!obj['title'] && obj['name']) obj['title'] = obj['name'];
  }

  const result = catalogSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
    throw new Error(`Invalid catalog: ${issues}`);
  }

  const cat = result.data as Catalog;
  if (!cat.id) {
    cat.id = cat.catalogId || (cat as any).$id || 'unknown';
  }
  return cat;
}
