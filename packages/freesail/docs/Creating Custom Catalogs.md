# Creating Custom Catalogs

This guide explains how to create a custom Freesail catalog — a package that bundles a JSON schema describing UI components with their concrete React implementations. Agents use the schema to know what components exist; the React code renders them in the browser.

## Quick Start

```bash
npx freesail new catalog
```

This scaffolds a complete catalog with all common components and functions pre-populated. You own every file and can modify them freely.

## Generated Structure

```
{name}_catalog/
  package.json
  tsconfig.json
  src/
    {name}_catalog.json   # Full component + function schema
    components.tsx         # Your custom components + common imports
    functions.ts           # Your custom functions + common imports
    index.ts               # Exports CatalogDefinition
    CommonComponents.tsx   # Common component implementations (yours to modify)
    CommonFunctions.ts     # Common function implementations (yours to modify)
    common_types.json      # Shared A2UI type definitions
```

The common files (`CommonComponents.tsx`, `CommonFunctions.ts`, `common_types.json`) are copied from `@freesail/catalogs` at scaffold time. They form the baseline every agent relies on. You can modify them, but `formatString` must always exist.

---

## Step 1: Define the Schema (`{name}_catalog.json`)

The schema is a JSON file that tells the agent which components exist and what properties each one accepts. The gateway uses it to validate agent output before it reaches the browser.

The scaffolded file already includes all 11 common components (Text, Button, Row, Column, Card, etc.) and 22 common functions. Add your custom components alongside them:

```json
{
  "components": {
    "Text": { "..." },
    "Button": { "..." },
    "...all common components...",

    "StatusCard": {
      "type": "object",
      "allOf": [
        { "$ref": "./common_types.json#/$defs/ComponentCommon" },
        { "$ref": "#/$defs/CatalogComponentCommon" },
        {
          "type": "object",
          "description": "A card displaying a status with a title, message, and severity level.",
          "properties": {
            "component": { "const": "StatusCard" },
            "title":    { "type": "string", "description": "Card heading" },
            "message":  { "type": "string", "description": "Body text" },
            "severity": {
              "type": "string",
              "enum": ["info", "warning", "error", "success"],
              "description": "Visual severity level"
            }
          },
          "required": ["component", "title"]
        }
      ]
    }
  },
  "functions": [
    "...all common functions...",
    {
      "name": "truncate",
      "description": "Truncates a string to maxLength characters.",
      "returnType": "string",
      "parameters": { "..." }
    }
  ]
}
```

**Key rules:**
- `$id` and `catalogId` must be the same URL. Use a real published URL before shipping; a placeholder is fine during development.
- `components` keys are the component names agents will use (e.g. `"component": "StatusCard"`).
- `description` fields are included in the agent's system prompt — write them clearly.
- Use `allOf` with `ComponentCommon` and `CatalogComponentCommon` for consistent component structure.

---

## Step 2: Implement Components (`components.tsx`)

The scaffolded file imports common components and spreads them into the export map. Add your custom components alongside:

```tsx
import type { FreesailComponentProps } from '@freesail/react';
import { commonComponents } from './CommonComponents.js';

export function StatusCard({ component, children }: FreesailComponentProps) {
  const title    = (component['title'] as string) ?? '';
  const message  = (component['message'] as string) ?? '';
  const severity = (component['severity'] as string) ?? 'info';

  const colors: Record<string, string> = {
    info:    'var(--freesail-info, #3b82f6)',
    warning: 'var(--freesail-warning, #f59e0b)',
    error:   'var(--freesail-error, #ef4444)',
    success: 'var(--freesail-success, #22c55e)',
  };

  return (
    <div style={{
      padding: '16px',
      borderRadius: '8px',
      border: `1px solid ${colors[severity] ?? colors.info}`,
    }}>
      <strong>{title}</strong>
      {message && <p style={{ margin: '8px 0 0' }}>{message}</p>}
      {children}
    </div>
  );
}

export const myappCatalogComponents = {
  ...commonComponents,
  StatusCard,
};
```

**Conventions:**
- Export each component as a named `export function`.
- Cast props with `as string` — all values arrive as `unknown`.
- Use CSS custom properties (`var(--freesail-*)`) for theming.
- The map keys must exactly match the component names in the JSON schema.

### `FreesailComponentProps` reference

| Prop | Type | Purpose |
|------|------|---------|
| `component` | `A2UIComponent` | All resolved props the agent sent for this component instance |
| `children` | `ReactNode` | Rendered child components (for containers) |
| `scopeData` | `unknown` | Current item data when inside a dynamic list template |
| `dataModel` | `Record<string, unknown>` | Full surface data model (read-only snapshot) |
| `onAction` | `(name, context) => void` | Dispatch a named action to the agent |
| `onDataChange` | `(path, value) => void` | Write a value to the local data model (two-way binding) |
| `onFunctionCall` | `(call) => void` | Execute a client-side function call |

### Two-way binding (input components)

For components that let users enter data, read the bound path from `component['__rawValue']` and call `onDataChange` on every change:

```tsx
export function MyInput({ component, onDataChange }: FreesailComponentProps) {
  const value = (component['value'] as string) ?? '';

  const rawValue = component['__rawValue'] as { path?: string } | string | undefined;
  const boundPath = typeof rawValue === 'object' && rawValue?.path
    ? rawValue.path
    : `/input/${component.id}`;

  return (
    <input
      value={value}
      onChange={(e) => onDataChange?.(boundPath, e.target.value)}
    />
  );
}
```

### Validation (`checks`)

The common `validateChecks` helper is available from `CommonComponents.tsx`:

```tsx
import { commonComponents, validateChecks } from './CommonComponents.js';

export function MyInput({ component, onDataChange }: FreesailComponentProps) {
  const checks = (component['checks'] as any[]) ?? [];
  const validationError = validateChecks(checks);

  return (
    <div>
      <input style={{ border: validationError ? '1px solid red' : undefined }} />
      {validationError && (
        <div style={{ color: 'var(--freesail-error, #ef4444)', fontSize: '12px' }}>
          {validationError}
        </div>
      )}
    </div>
  );
}
```

---

## Step 3: Add Custom Functions (`functions.ts`)

The scaffolded file re-exports common functions. Add custom functions alongside:

```ts
import type { FunctionImplementation } from '@freesail/react';
import { commonFunctions } from './CommonFunctions.js';

const truncate: FunctionImplementation = {
  execute: (args) => {
    const value = String(args?.value ?? '');
    const maxLength = Number(args?.maxLength ?? 100);
    return value.length > maxLength ? value.slice(0, maxLength) + '…' : value;
  },
};

export const myappCatalogFunctions = {
  ...commonFunctions,
  truncate,
};
```

Remember to also declare the function in the JSON schema (see Step 1).

---

## Step 4: Wire Up `index.ts`

The scaffolded `index.ts` is ready to use:

```ts
import type { CatalogDefinition } from '@freesail/react';
import { myappCatalogComponents } from './components.js';
import { myappCatalogFunctions } from './functions.js';
import catalogSchema from './myapp_catalog.json';

export const MyappCatalog: CatalogDefinition = {
  namespace: catalogSchema.catalogId,
  schema: catalogSchema,
  components: myappCatalogComponents,
  functions: myappCatalogFunctions,
};
```

> **`formatString` is required.** The agent system prompt relies on it. The `freesail validate catalog` command will error if it is absent from the runtime function map. It's included in `commonFunctions` by default.

---

## Step 5: Register with `FreesailProvider`

```tsx
import { FreesailProvider } from '@freesail/react';
import { MyappCatalog } from 'myapp-catalog';
import { StandardCatalog } from '@freesail/catalogs/standard';

function App() {
  return (
    <FreesailProvider
      sseUrl="/api/sse"
      postUrl="/api/message"
      catalogDefinitions={[StandardCatalog, MyappCatalog]}
    >
      <YourApp />
    </FreesailProvider>
  );
}
```

Multiple catalogs can coexist. Each surface is bound to exactly one catalog, identified by `catalogId`.

---

## Validation

Before building, run:

```bash
npx freesail validate catalog
```

This checks that:
- Every component key in the JSON schema has a matching entry in the components map.
- `formatString` is present in the runtime function map.
- Required schema fields (`catalogId`, `$id`) are set.

The `prebuild` script in the generated `package.json` runs this automatically on every `npm run build`.

---

## Modifying Common Files

Since you own the common files, you can:
- **Add** properties to existing common components
- **Remove** components you don't need (delete from JSON schema and component map)
- **Modify** function behavior (e.g. customize `formatDate` locale handling)
- **Override** theme utilities in `CommonComponents.tsx`

The only hard constraint: **`formatString` must exist** in your function map.

To get the latest common files (e.g. after a Freesail update), run `npx freesail new catalog` into a temporary directory and diff the common files against yours.

---

## `CatalogDefinition` API Reference

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `namespace` | `string` | ✅ | The `catalogId` URI — must match `schema.catalogId` |
| `schema` | `object` | ✅ | The parsed JSON schema object |
| `components` | `Record<string, ComponentType<FreesailComponentProps>>` | ✅ | Component name → React component map |
| `functions` | `Record<string, FunctionImplementation>` | ✅ | Function name → implementation map (must include `formatString`) |
