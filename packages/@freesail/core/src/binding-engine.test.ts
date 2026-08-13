import { describe, it, expect } from 'vitest';
import type { A2UIComponent, FunctionCall } from './protocol.js';
import type { FunctionLookup, FunctionImplementation } from './registry.js';
import {
  extractMeta,
  isDataBindingObject,
  resolveSingleBinding,
  resolveDataBindings,
  evaluateFunction,
  resolveActionContext,
  interpolateTemplate,
} from './binding-engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class FakeLookup implements FunctionLookup {
  constructor(
    private fns: Record<string, FunctionImplementation> = {},
    private params: Record<string, string[]> = {}
  ) {}
  getFunction(_catalogId: string, functionName: string): FunctionImplementation | null {
    return this.fns[functionName] ?? null;
  }
  getParamNames(_catalogId: string, functionName: string): string[] | undefined {
    return this.params[functionName];
  }
}

function comp(props: Record<string, unknown>): A2UIComponent {
  return { id: 'c1', component: 'Text', ...props } as A2UIComponent;
}

// ---------------------------------------------------------------------------
// isDataBindingObject
// ---------------------------------------------------------------------------

describe('isDataBindingObject', () => {
  it('recognizes a plain data binding', () => {
    expect(isDataBindingObject({ path: '/foo' })).toBe(true);
  });
  it('rejects a ChildListTemplate (has componentId)', () => {
    expect(isDataBindingObject({ path: '/foo', componentId: 'x' })).toBe(false);
  });
  it('rejects a ServerAction-shaped object (has event)', () => {
    expect(isDataBindingObject({ path: '/foo', event: {} })).toBe(false);
  });
  it('rejects a FunctionCall-shaped object (has call)', () => {
    expect(isDataBindingObject({ path: '/foo', call: 'x' })).toBe(false);
  });
  it('rejects non-objects and objects without a string path', () => {
    expect(isDataBindingObject('nope')).toBe(false);
    expect(isDataBindingObject(null)).toBe(false);
    expect(isDataBindingObject({ path: 5 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveSingleBinding
// ---------------------------------------------------------------------------

describe('resolveSingleBinding', () => {
  it('resolves an absolute path against the data model', () => {
    expect(resolveSingleBinding({ path: '/user/name' }, { user: { name: 'Ada' } })).toBe('Ada');
  });

  it('resolves a relative path against scopeData when provided', () => {
    expect(resolveSingleBinding({ path: 'name' }, {}, { name: 'Item1' })).toBe('Item1');
  });

  it('treats "." and "" as the current scope value', () => {
    expect(resolveSingleBinding({ path: '.' }, {}, 'scoped-value')).toBe('scoped-value');
    expect(resolveSingleBinding({ path: '' }, {}, 'scoped-value')).toBe('scoped-value');
  });

  it('follows chained bindings up to depth 5 then stops', () => {
    // Build a chain of 7 bindings — resolution should stop after 5 hops,
    // leaving a still-unresolved binding object as the final value.
    const dataModel: Record<string, unknown> = { target: 'end' };
    for (let i = 6; i >= 0; i--) {
      dataModel[`hop${i}`] = i === 6 ? { path: '/target' } : { path: `/hop${i + 1}` };
    }
    const result = resolveSingleBinding({ path: '/hop0' }, dataModel);
    // 5 hops resolved (hop0->hop1->hop2->hop3->hop4->hop5), still a binding object at that point
    expect(isDataBindingObject(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveDataBindings
// ---------------------------------------------------------------------------

describe('resolveDataBindings', () => {
  const registry = new FakeLookup();

  it('passes through literal props unchanged, excluding structural keys', () => {
    const resolved = resolveDataBindings(comp({ text: 'hello' }), {}, {}, 'cat1', registry);
    expect(resolved).toEqual({ text: 'hello' });
  });

  it('resolves a data-bound prop and records raw binding + update timestamp', () => {
    const dataModel = { user: { name: 'Ada' } };
    const resolved = resolveDataBindings(
      comp({ text: { path: '/user/name' } }),
      dataModel,
      { '/user/name': 42 },
      'cat1',
      registry
    );
    expect(resolved['text']).toBe('Ada');
    expect(resolved['__rawText']).toEqual({ path: '/user/name' });
    expect(resolved['__textUpdatedAt']).toBe(42);
  });

  it('does not eagerly resolve the "action" key', () => {
    const action = { event: { name: 'submit', context: { value: { path: '/user/name' } } } };
    const resolved = resolveDataBindings(comp({ action }), { user: { name: 'Ada' } }, {}, 'cat1', registry);
    expect(resolved['action']).toBe(action);
  });

  it('resolves double-encoded (stringified) binding objects', () => {
    const resolved = resolveDataBindings(
      comp({ text: '{"path":"/user/name"}' }),
      { user: { name: 'Ada' } },
      {},
      'cat1',
      registry
    );
    expect(resolved['text']).toBe('Ada');
    expect(resolved['__rawText']).toEqual({ path: '/user/name' });
  });

  it('resolves bindings nested inside arrays without adding __raw tracking', () => {
    const resolved = resolveDataBindings(
      comp({ items: [{ path: '/a' }, { path: '/b' }] }),
      { a: 1, b: 2 },
      {},
      'cat1',
      registry
    );
    expect(resolved['items']).toEqual([1, 2]);
    expect(resolved['__rawItems']).toBeUndefined();
  });

  it('does not evaluate FunctionCalls wrapped in a LocalAction (functionCall key)', () => {
    const onTap = { functionCall: { call: 'doStuff', args: {} } };
    const resolved = resolveDataBindings(comp({ onTap }), {}, {}, 'cat1', registry);
    expect(resolved['onTap']).toBe(onTap);
  });

  it('evaluates a FunctionCall prop via the provided registry', () => {
    const shoutRegistry = new FakeLookup({ shout: (s: string) => s.toUpperCase() });
    const resolved = resolveDataBindings(
      comp({ text: { call: 'shout', args: ['hi'] } as unknown as Record<string, unknown> }),
      {},
      {},
      'cat1',
      shoutRegistry
    );
    expect(resolved['text']).toBe('HI');
  });
});

// ---------------------------------------------------------------------------
// evaluateFunction
// ---------------------------------------------------------------------------

describe('evaluateFunction', () => {
  it('calls the resolved function with positional array args', () => {
    const registry = new FakeLookup({ add: (a: number, b: number) => a + b });
    const call: FunctionCall = { call: 'add', args: [2, 3] as any };
    expect(evaluateFunction(call, {}, 'cat1', registry)).toBe(5);
  });

  it('reorders named args to match declared parameter order', () => {
    const registry = new FakeLookup(
      { greet: (greeting: string, name: string) => `${greeting}, ${name}!` },
      { greet: ['greeting', 'name'] }
    );
    const call: FunctionCall = { call: 'greet', args: { name: 'Ada', greeting: 'Hi' } };
    expect(evaluateFunction(call, {}, 'cat1', registry)).toBe('Hi, Ada!');
  });

  it('spreads a single array-valued arg into positional args (robustness case)', () => {
    const registry = new FakeLookup({ add: (a: number, b: number) => a + b });
    const call: FunctionCall = { call: 'add', args: { value: [2, 3] } as any };
    expect(evaluateFunction(call, {}, 'cat1', registry)).toBe(5);
  });

  it('pre-processes formatString args through the template interpolator', () => {
    const registry = new FakeLookup({ formatString: (s: string) => s });
    const call: FunctionCall = { call: 'formatString', args: ['Hello ${/user/name}!'] as any };
    expect(evaluateFunction(call, { user: { name: 'Ada' } }, 'cat1', registry)).toBe('Hello Ada!');
  });

  it('returns undefined and warns when the function is not found', () => {
    const registry = new FakeLookup();
    const call: FunctionCall = { call: 'missing', args: {} };
    expect(evaluateFunction(call, {}, 'cat1', registry)).toBeUndefined();
  });

  it('resolves data-bound and function-call args recursively', () => {
    const registry = new FakeLookup({
      add: (a: number, b: number) => a + b,
      double: (n: number) => n * 2,
    });
    const call: FunctionCall = {
      call: 'add',
      args: [{ path: '/x' }, { call: 'double', args: [3] }] as any,
    };
    expect(evaluateFunction(call, { x: 10 }, 'cat1', registry)).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// resolveActionContext
// ---------------------------------------------------------------------------

describe('resolveActionContext', () => {
  const registry = new FakeLookup({ add: (a: number, b: number) => a + b });

  it('passes through literal values', () => {
    expect(resolveActionContext({ label: 'hi' }, {}, 'cat1', registry)).toEqual({ label: 'hi' });
  });

  it('resolves absolute-path bindings against the data model', () => {
    const resolved = resolveActionContext({ value: { path: '/user/name' } }, { user: { name: 'Ada' } }, 'cat1', registry);
    expect(resolved['value']).toBe('Ada');
  });

  it('resolves relative-path bindings against scopeData', () => {
    const resolved = resolveActionContext({ value: { path: 'name' } }, {}, 'cat1', registry, { name: 'Item1' });
    expect(resolved['value']).toBe('Item1');
  });

  it('evaluates function calls in context values', () => {
    const resolved = resolveActionContext({ total: { call: 'add', args: [1, 2] } as any }, {}, 'cat1', registry);
    expect(resolved['total']).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// extractMeta
// ---------------------------------------------------------------------------

describe('extractMeta', () => {
  it('splits __raw*/__*UpdatedAt keys out of clean props', () => {
    const resolved = { __rawValue: { path: '/foo' }, __valueUpdatedAt: 123, label: 'hi' };
    const { cleanProps, meta } = extractMeta(resolved, {}, 'btn1' as any);
    expect(cleanProps).toEqual({ label: 'hi' });
    expect(meta.getBinding('value')).toEqual({ path: '/foo' });
    expect(meta.getUpdatedTime('value')).toBe(123);
    expect(meta.getUpdatedTime('nonexistent')).toBe(0);
  });

  it('looks up a component-state override from the data model', () => {
    const dataModel = { __componentState: { btn1: { visible: false } } };
    const { meta } = extractMeta({}, dataModel, 'btn1' as any);
    expect(meta.getComponentState('visible')).toBe(false);
  });

  it('defaults component state to an empty lookup when nothing is set', () => {
    const { meta } = extractMeta({}, {}, 'btn1' as any);
    expect(meta.getComponentState('visible')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// interpolateTemplate
// ---------------------------------------------------------------------------

describe('interpolateTemplate', () => {
  const noopEval = () => undefined;

  it('passes through a template with no expressions', () => {
    expect(interpolateTemplate('Hello world', {}, 'cat1', undefined, noopEval)).toBe('Hello world');
  });

  it('unescapes \\${ to a literal ${ without evaluating it', () => {
    const template = 'Price: \\${5}';
    expect(interpolateTemplate(template, {}, 'cat1', undefined, noopEval)).toBe('Price: ${5}');
  });

  it('resolves an absolute data path expression', () => {
    const result = interpolateTemplate('Hello ${/user/name}!', { user: { name: 'Ada' } }, 'cat1', undefined, noopEval);
    expect(result).toBe('Hello Ada!');
  });

  it('resolves a relative data path expression against scopeData', () => {
    const result = interpolateTemplate('Item: ${name}', {}, 'cat1', { name: 'Widget' }, noopEval);
    expect(result).toBe('Item: Widget');
  });

  it('evaluates a function call with a quoted positional arg', () => {
    const evalFn = (call: FunctionCall) =>
      call.call === 'upper' ? String((call.args as any)['0']).toUpperCase() : undefined;
    const result = interpolateTemplate("${upper('hi')}", {}, 'cat1', undefined, evalFn);
    expect(result).toBe('HI');
  });

  it('evaluates a function call with a named arg', () => {
    const evalFn = (call: FunctionCall) =>
      call.call === 'greet' ? `Hi ${(call.args as any)['name']}` : undefined;
    const result = interpolateTemplate("${greet(name:'Ada')}", {}, 'cat1', undefined, evalFn);
    expect(result).toBe('Hi Ada');
  });

  it('evaluates nested ${...} expressions', () => {
    const evalFn = (call: FunctionCall) =>
      call.call === 'upper' ? String((call.args as any)['0']).toUpperCase() : undefined;
    const result = interpolateTemplate(
      '${upper(${/user/name})}',
      { user: { name: 'ada' } },
      'cat1',
      undefined,
      evalFn
    );
    expect(result).toBe('ADA');
  });
});
