# @freesail/standard-catalog-lit

Freesail Standard UI Component Catalog — Lit (lit-html/Web Components) implementation.

This is the Lit-flavored sibling of [`@freesail/standard-catalog`](../standard-catalog). It implements the exact same `catalogId` and JSON schema (component/function vocabulary), so an agent's UI plan is portable between a React host app (using `@freesail/react` + `@freesail/standard-catalog`) and a Lit host app (using `@freesail/lit` + `@freesail/standard-catalog-lit`) — only the rendering implementation differs.

## Usage

```ts
import { FreesailProviderElement } from '@freesail/lit';
import { StandardCatalog } from '@freesail/standard-catalog-lit';

const provider = document.querySelector('freesail-provider')!;
provider.catalogs = [StandardCatalog];
```

```html
<freesail-provider gateway="/gateway">
  <freesail-surface surface-id="main"></freesail-surface>
</freesail-provider>
```

## Components

Implements the same 30 components as `@freesail/standard-catalog`: `Text`, `Icon`, `Row`, `Column`, `Card`, `Modal`, `Button`, `TextField`, `ChoicePickerSingleSelect`, `ChoicePickerMultiSelect`, `DateInput`, `TimeInput`, `Dropdown`, `CheckBox`, `Slider`, `Spacer`, `Divider`, `Image`, `Video`, `AudioPlayer`, `List`, `TabGroup`, `Tab`, `FluidGrid`, `TabularGrid`, `BarChart`, `LineChart`, `PieChart`, `Sparkline`, `StatCard`.

## Functions

Same runtime function set as `@freesail/standard-catalog` (`formatString`, `formatNumber`, `formatDate`, validation helpers, boolean/comparison helpers, `show`/`hide`, etc.) — the implementations are 100% framework-agnostic and shared verbatim.

## Development

```bash
npm run prepare:catalog   # regenerate standard-catalog.json from components.json/functions.json
npm run build
```
