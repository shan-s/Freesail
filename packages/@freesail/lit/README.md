# @freesail/lit

Lit / Web Components bindings for Freesail — connects your app to a Freesail gateway and renders agent-driven UI surfaces using standard custom elements. This is the Lit counterpart to `@freesail/react` — same protocol, same theming, same catalog concept, different rendering layer.

## Installation

```bash
npm install @freesail/lit @freesail/standard-catalog-lit lit
```

## Quick Start

```ts
import '@freesail/lit'; // registers <freesail-provider> and <freesail-surface>
import { StandardCatalog } from '@freesail/standard-catalog-lit';
import type { CatalogDefinition } from '@freesail/lit';

const catalogs: CatalogDefinition[] = [StandardCatalog];
```

```html
<freesail-provider gateway="http://localhost:3001">
  <freesail-surface surface-id="main"></freesail-surface>
</freesail-provider>

<script type="module">
  document.querySelector('freesail-provider').catalogs = catalogs;
</script>
```

`catalogs` (like `theme`, `transportOptions`, and every `onBefore*` interceptor) is a **property, not an attribute** — arrays, objects, and functions can't be expressed as HTML attribute strings, so set them imperatively in JS, never via markup.

## Elements

### `<freesail-provider>`

Root element that manages the gateway connection and surface state. Must be an ancestor of every `<freesail-surface>` (and of any element using the controllers below).

| Property | Type | Attribute? | Description |
|------|------|------|-------------|
| `gateway` | `string` | Yes (`gateway`) | Base gateway URL (e.g. `http://localhost:3001`). Omit for same-origin. |
| `name` | `string` | Yes (`name`) | Scopes this provider's session when two providers share a page/gateway |
| `theme` | `'light' \| 'dark' \| Partial<FreesailThemeTokens>` | No | Property only |
| `catalogs` | `CatalogDefinition[]` | No | Property only — set imperatively |
| `transportOptions` | `object` | No | Property only |
| `additionalCapabilities` | `Record<string, unknown>` | No | Property only |
| `onConnectionChange` | `(connected: boolean) => void` | No | Property only |
| `onError` | `(error: Error) => void` | No | Property only |
| `onBeforeCreateSurface` | interceptor | No | Return `{ allowed: false }` to block an agent `createSurface` |
| `onBeforeUpdateComponents` | interceptor | No | Return `{ allowed: false }` to block an agent `updateComponents` |
| `onBeforeUpdateDataModel` | interceptor | No | Return `{ allowed: false }` to block an agent `updateDataModel` |
| `onBeforeDeleteSurface` | interceptor | No | Return `{ allowed: false }` to block an agent `deleteSurface` |

Renders in the **light DOM** (no shadow root) — its light-DOM children (e.g. nested `<freesail-surface>` elements) are left untouched by the element itself; it only manages the connection lifecycle and publishes context via [`@lit/context`](https://lit.dev/docs/data/context/).

### `<freesail-surface>`

Renders a single agent-driven surface. Subscribes to updates automatically. Must be a descendant of `<freesail-provider>`.

| Property | Type | Attribute? | Description |
|------|------|------|-------------|
| `surfaceId` | `string` | Yes (`surface-id`) | The surface ID to render |
| `theme` | `FreesailThemeProp` | No | Optional per-surface theme override |
| `loadingTemplate` | `() => TemplateResult` | No | Shown while the surface has not yet been created by the agent |
| `errorTemplate` | `() => TemplateResult` | No | Shown when the catalog is not registered |
| `emptyTemplate` | `() => TemplateResult` | No | Shown when the surface exists but has no components |

Also renders in the light DOM, so `class` targeting works via ordinary global CSS (the direct equivalent of React's `className` prop) and components like `TabularGrid` can inject their own scoped `<style>` tag without fighting shadow-root style scoping.

## Reactive Controllers

The Lit analogue of `@freesail/react`'s hooks — each is a plain class implementing Lit's `ReactiveController`, constructed with the host element (`new XController(this, ...)`), calling `host.requestUpdate()` on change.

| Controller | Exposes | Description |
|------|---------|-------------|
| `SurfaceController(host, surfaceId)` | `.surface`, `.context` | Subscribes to a surface and requests a host update on changes |
| `SurfaceDataController(host, surfaceId, path?)` | `.data` | Reads a value from the surface data model at an optional JSON Pointer path |
| `ConnectionStatusController(host)` | `.isConnected` | Current gateway connection state |
| `SurfacesController(host)` | `.surfaces` | All active surfaces |
| `SessionIdController(host)` | `.sessionId` | Session ID assigned by the gateway after connection |

Plus a plain (non-reactive) helper: `dispatchSurfaceAction(context, surfaceId)` returns a `(name, sourceComponentId, context?) => Promise<void>` dispatch function — the Lit analogue of `useAction`.

```ts
import { LitElement, html } from 'lit';
import { ConnectionStatusController } from '@freesail/lit';

class ConnectionIndicator extends LitElement {
  private _connection = new ConnectionStatusController(this);
  override createRenderRoot() { return this; } // light DOM, matches the rest of this package

  override render() {
    return html`<span>${this._connection.isConnected ? 'Connected' : 'Disconnected'}</span>`;
  }
}
customElements.define('connection-indicator', ConnectionIndicator);
```

## Interceptors

Identical semantics to `@freesail/react`. Return `{ allowed: false, message: '...' }` to block — the message is sent back to the agent as an error. Return `{ allowed: true, message: '...' }` to allow and also notify the agent with a validation message.

```ts
const provider = document.querySelector('freesail-provider');
provider.onBeforeCreateSurface = (_surfaceId, _catalogId, _sendDataModel, surfaceManager) => {
  if (surfaceManager.getAllSurfaces().length >= 3) {
    return { allowed: false, message: 'Surface limit reached. Please remove a surface first.' };
  }
  return { allowed: true, message: '' };
};
```

## Writing catalog components

Unlike some Lit component libraries, Freesail catalog components for this package are **plain functions**, not custom elements — `(props: FreesailComponentProps) => TemplateResult`, using lit-html's `html` tag. There's no per-component registration boilerplate; `<freesail-surface>` calls these functions directly as it walks the component tree. See `@freesail/standard-catalog-lit`'s components for real examples, and `packages/freesail/docs/Creating Custom Catalogs.md` for the full guide (covers both React and Lit).

## License

MIT — see [LICENSE](./LICENSE)
