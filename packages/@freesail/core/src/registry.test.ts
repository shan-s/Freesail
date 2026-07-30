import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentRegistry } from './registry.js';

type FakeComponent = { name: string };

function fakeComponent(name: string): FakeComponent {
  return { name };
}

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry<FakeComponent>;

  beforeEach(() => {
    registry = new ComponentRegistry<FakeComponent>();
  });

  it('registers a catalog and retrieves its components', () => {
    const Button = fakeComponent('Button');
    registry.registerCatalog('cat1', { Button });
    expect(registry.getComponent('cat1', 'Button')).toBe(Button);
  });

  it('registers a single component into an existing or new catalog', () => {
    const Card = fakeComponent('Card');
    registry.registerComponent('cat1', 'Card', Card);
    expect(registry.getComponent('cat1', 'Card')).toBe(Card);
    expect(registry.hasCatalog('cat1')).toBe(true);
  });

  it('returns null and warns when catalog is not registered and no fallback is set', () => {
    expect(registry.getComponent('missing', 'Button')).toBeNull();
  });

  it('returns null and warns when component is not found in a registered catalog', () => {
    registry.registerCatalog('cat1', { Button: fakeComponent('Button') });
    expect(registry.getComponent('cat1', 'Nope')).toBeNull();
  });

  it('falls back to the fallback component for unknown catalogs/components', () => {
    const Fallback = fakeComponent('Fallback');
    registry.setFallbackComponent(Fallback);
    expect(registry.getComponent('missing', 'Button')).toBe(Fallback);

    registry.registerCatalog('cat1', { Button: fakeComponent('Button') });
    expect(registry.getComponent('cat1', 'Nope')).toBe(Fallback);
  });

  it('registers and retrieves functions by exact name', () => {
    const formatString = (s: string) => s.toUpperCase();
    registry.registerCatalog('cat1', {}, { formatString });
    expect(registry.getFunction('cat1', 'formatString')).toBe(formatString);
  });

  it('falls back from snake_case to camelCase for function lookup', () => {
    const openUrl = (url: string) => url;
    registry.registerCatalog('cat1', {}, { openUrl });
    expect(registry.getFunction('cat1', 'open_url')).toBe(openUrl);
  });

  it('returns null for an unknown function', () => {
    registry.registerCatalog('cat1', {}, { formatString: (s: string) => s });
    expect(registry.getFunction('cat1', 'doesNotExist')).toBeNull();
  });

  it('returns null for functions when the catalog has no functions map', () => {
    registry.registerCatalog('cat1', { Button: fakeComponent('Button') });
    expect(registry.getFunction('cat1', 'formatString')).toBeNull();
  });

  it('extracts positional parameter names from a catalog schema', () => {
    const schema = {
      functions: {
        add: {
          properties: {
            args: {
              properties: { a: { type: 'number' }, b: { type: 'number' } },
            },
          },
        },
      },
    };
    registry.registerCatalog('cat1', {}, { add: (a: number, b: number) => a + b }, schema);
    expect(registry.getParamNames('cat1', 'add')).toEqual(['a', 'b']);
  });

  it('returns undefined param names when no schema was registered', () => {
    registry.registerCatalog('cat1', {}, { add: (a: number, b: number) => a + b });
    expect(registry.getParamNames('cat1', 'add')).toBeUndefined();
  });

  it('lists all registered catalog IDs', () => {
    registry.registerCatalog('cat1', {});
    registry.registerCatalog('cat2', {});
    expect(registry.getCatalogIds().sort()).toEqual(['cat1', 'cat2']);
  });

  it('clear() resets catalogs, functions, param names, and fallback', () => {
    registry.registerCatalog('cat1', { Button: fakeComponent('Button') }, { formatString: (s: string) => s });
    registry.setFallbackComponent(fakeComponent('Fallback'));
    registry.clear();
    expect(registry.getCatalogIds()).toEqual([]);
    expect(registry.getComponent('cat1', 'Button')).toBeNull();
    expect(registry.getFunction('cat1', 'formatString')).toBeNull();
  });
});
