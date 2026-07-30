import { describe, it, expect, beforeEach } from 'vitest';
import { html } from 'lit';
import { registry, withCatalog, registerCatalog, type FreesailComponent } from './registry.js';

const Button: FreesailComponent = ({ component }) => html`<button>${component['label'] as string}</button>`;
const Card: FreesailComponent = ({ children }) => html`<div class="card">${children}</div>`;

describe('@freesail/lit registry', () => {
  beforeEach(() => {
    registry.clear();
  });

  it('registers and retrieves a Lit render function via registerCatalog', () => {
    registerCatalog('cat1', { Button });
    expect(registry.getComponent('cat1', 'Button')).toBe(Button);
  });

  it('withCatalog registers the component and returns it unchanged', () => {
    const registered = withCatalog('cat1', 'Card', Card);
    expect(registered).toBe(Card);
    expect(registry.getComponent('cat1', 'Card')).toBe(Card);
  });

  it('a registered render function produces a TemplateResult when called', () => {
    registerCatalog('cat1', { Button });
    const Component = registry.getComponent('cat1', 'Button')!;
    const result = Component({
      component: { id: 'b1', component: 'Button', label: 'Click me' },
      meta: { getBinding: () => undefined, getUpdatedTime: () => 0, getComponentState: () => undefined } as any,
    });
    expect(result.strings.join('')).toContain('<button>');
    expect(result.values).toContain('Click me');
  });

  it('registers functions alongside components', () => {
    const upper = (s: string) => s.toUpperCase();
    registerCatalog('cat1', { Button }, { upper });
    expect(registry.getFunction('cat1', 'upper')).toBe(upper);
  });
});
