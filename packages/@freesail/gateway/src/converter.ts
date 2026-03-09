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
  functions?: Array<{
    name: string;
    description?: string;
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
    description: component.description ?? `Render a ${name} component`,
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

  if (prop.enum) {
    schema['enum'] = prop.enum;
  }

  if (prop.default !== undefined) {
    schema['default'] = prop.default;
  }

  if (prop.type === 'array' && prop.items) {
    schema['items'] = propertyToSchema(prop.items);
  }

  return schema;
}

/**
 * Generates the system prompt injection for the catalog.
 */
const catalogPromptCache = new WeakMap<Catalog, string>();

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
    if (component.description) {
      lines.push(`  ${component.description}`);
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

        // Handle $ref types for display
        let typeStr: string | undefined = prop.type as string | undefined;
        if (!typeStr && (prop.oneOf || prop.anyOf)) {
          const branches = (prop.oneOf ?? prop.anyOf)!;
          typeStr = branches
            .map(b => {
              if (b.$ref) {
                const base = b.$ref.split('/').pop() || 'unknown';
                if (base === 'DataBinding') return '{"path":"..."}';
                if (base.startsWith('Dynamic')) return base.replace('Dynamic', '').toLowerCase();
                return base;
              }
              if (b.type === 'array') return 'array[object]';
              return b.type ?? 'any';
            })
            .join(' | ');
        } else if (!typeStr && prop.allOf) {
          // allOf: find the first branch with a meaningful $ref or type (other branches are typically constraints)
          const primary = prop.allOf.find((b: CatalogProperty) => b.$ref || b.type);
          if (primary?.$ref) {
            const base = primary.$ref.split('/').pop() || 'unknown';
            if (base.startsWith('Dynamic')) {
              const plainType = base.replace('Dynamic', '').toLowerCase();
              typeStr = `${plainType} | {"path":"..."} | {"call":"..."}`;
            } else {
              typeStr = base;
            }
          } else if (primary?.type) {
            typeStr = primary.type as string;
          }
        } else if (!typeStr && prop.$ref) {
          const ref = prop.$ref;
          const baseType = ref.split('/').pop() || 'unknown';

          if (baseType.startsWith('Dynamic')) {
            const plainType = baseType.replace('Dynamic', '').toLowerCase();
            typeStr = `${plainType} | {"path":"..."} | {"call":"..."}`;
          } else if (baseType === 'ChildList') {
            typeStr = 'string[] | ChildTemplate';
          } else {
            typeStr = baseType;
          }
        } else if (typeStr === 'array' && prop.items) {
          let itemTypeStr: string | undefined = prop.items.type as string | undefined;
          if (!itemTypeStr && prop.items.$ref) {
            const ref = prop.items.$ref;
            const baseType = ref.split('/').pop() || 'unknown';
            if (baseType.startsWith('Dynamic')) {
              itemTypeStr = `${baseType.replace('Dynamic', '').toLowerCase()} | {"path":"..."} | {"call":"..."}`;
            } else if (baseType === 'ChildList') {
              itemTypeStr = 'string[] | ChildTemplate';
            } else {
              itemTypeStr = baseType;
            }
          }
          typeStr = `array[${itemTypeStr || 'unknown'}]`;
        }

        const enumSuffix = prop.enum && prop.enum.length > 0 ? ` (values: ${prop.enum.join(', ')})` : '';
        const desc = prop.description ? ` — ${prop.description}` : '';
        const line = `    - ${propName}: ${typeStr}${enumSuffix}${desc}`;

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
  if (catalog.functions && catalog.functions.length > 0) {
    lines.push('### Available Functions:', '');
    for (const func of catalog.functions) {
      lines.push(`**${func.name}**`);
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

  const valid = validator(props);
  if (valid) return { valid: true, errors: [] };

  const errors = (validator.errors ?? []).map(err => {
    const field = err.instancePath
      ? err.instancePath.replace(/^\//, '')
      : (err.params as any)?.missingProperty ?? 'field';
    return `${field}: ${err.message}`;
  });

  return { valid: false, errors };
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
  name: z.string(),
  description: z.string().optional(),
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
  functions: z.array(catalogFunctionSchema).optional(),
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
