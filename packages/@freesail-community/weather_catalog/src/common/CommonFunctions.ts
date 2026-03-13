/**
 * @fileoverview Common Functions
 *
 * The shared function set that all Freesail catalogs include.
 * These functions implement the A2UI protocol capabilities described in
 * the system prompt and are available by default in every catalog.
 *
 * `formatString` is MANDATORY — the system prompt relies on it and
 * `freesail validate catalog` will error if it is absent from a catalog's
 * runtime function map.
 *
 * When a developer runs `npx freesail new catalog`, this file is copied
 * into the new catalog's src/ folder. The developer then owns it and can
 * modify or extend it freely.
 */

import type { FunctionImplementation } from '@freesail/react';

// =============================================================================
// Validation Functions
// =============================================================================

export const required: FunctionImplementation = (value: unknown) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

export const regex: FunctionImplementation = (value: unknown, pattern: string) => {
  if (typeof value !== 'string') return false;
  try {
    const re = new RegExp(pattern);
    return re.test(value);
  } catch {
    return false;
  }
};

export const length: FunctionImplementation = (value: unknown, constraints: { min?: number; max?: number }) => {
  if (typeof value !== 'string' && !Array.isArray(value)) return false;
  const len = value.length;
  if (constraints.min !== undefined && len < constraints.min) return false;
  if (constraints.max !== undefined && len > constraints.max) return false;
  return true;
};

export const numeric: FunctionImplementation = (value: unknown, constraints: { min?: number; max?: number }) => {
  const num = Number(value);
  if (isNaN(num)) return false;
  if (constraints.min !== undefined && num < constraints.min) return false;
  if (constraints.max !== undefined && num > constraints.max) return false;
  return true;
};

export const email: FunctionImplementation = (value: unknown) => {
  if (typeof value !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

// =============================================================================
// Formatting Functions
// =============================================================================

export const formatString: FunctionImplementation = (format: string, ...args: unknown[]) => {
  // ${...} interpolation is pre-processed by the evaluator before this function is called.
  // This handles positional {0}, {1} placeholders for any additionally-passed arguments.
  if (args.length > 0) {
    return format.replace(/\{(\d+)\}/g, (_match, index) => {
      const idx = parseInt(index, 10);
      const val = args[idx];
      if (val === undefined || val === null) return '';
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    });
  }
  return format;
};

export const formatNumber: FunctionImplementation = (
  value: unknown,
  fractionDigits: number = 0,
  useGrouping: boolean = true
) => {
  const num = Number(value);
  if (isNaN(num)) return '';
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping,
  }).format(num);
};

export const formatCurrency: FunctionImplementation = (value: unknown, currency: string) => {
  const num = Number(value);
  if (isNaN(num)) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(num);
  } catch {
    return `${currency} ${num}`;
  }
};

export const formatDate: FunctionImplementation = (value: unknown, pattern: string) => {
  const date = new Date(String(value));
  if (isNaN(date.getTime())) return '';

  const d = date;
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  const dayOfWeek = d.getDay();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();

  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthsLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daysLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const pad = (n: number) => n.toString().padStart(2, '0');

  return pattern
    .replace(/yyyy/g, year.toString())
    .replace(/yy/g, year.toString().slice(-2))
    .replace(/MMMM/g, monthsLong[month] || '')
    .replace(/MMM/g, monthsShort[month] || '')
    .replace(/MM/g, pad(month + 1))
    .replace(/M/g, (month + 1).toString())
    .replace(/dd/g, pad(day))
    .replace(/d/g, day.toString())
    .replace(/EEEE/g, daysLong[dayOfWeek] || '')
    .replace(/E/g, daysShort[dayOfWeek] || '')
    .replace(/HH/g, pad(hours))
    .replace(/H/g, hours.toString())
    .replace(/hh/g, pad(hours % 12 || 12))
    .replace(/h/g, (hours % 12 || 12).toString())
    .replace(/mm/g, pad(minutes))
    .replace(/ss/g, pad(seconds))
    .replace(/a/g, hours < 12 ? 'AM' : 'PM');
};

// =============================================================================
// Utility Functions
// =============================================================================

export const pluralize: FunctionImplementation = (
  count: unknown,
  forms: { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }
) => {
  const n = Number(count);
  if (isNaN(n)) return forms.other;
  if (n === 0 && forms.zero) return forms.zero;
  if (n === 1 && forms.one) return forms.one;
  return forms.other;
};

// =============================================================================
// Logical Functions
// =============================================================================

export const not: FunctionImplementation = (value: unknown) => !value;

export const and: FunctionImplementation = (...args: unknown[]) => {
  return args.every((arg) => !!arg);
};

export const or: FunctionImplementation = (...args: unknown[]) => {
  return args.some((arg) => !!arg);
};

export const isEmpty: FunctionImplementation = (value: unknown) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
};

// =============================================================================
// Comparison Functions
// =============================================================================

export const eq: FunctionImplementation = (a: unknown, b: unknown) => a === b;
export const neq: FunctionImplementation = (a: unknown, b: unknown) => a !== b;

function toComparable(v: unknown): number {
  if (typeof v === 'string') {
    const n = Number(v);
    if (!isNaN(n)) return n;
    const ts = Date.parse(v);
    if (!isNaN(ts)) return ts;
  }
  return Number(v);
}

export const gt:  FunctionImplementation = (a: unknown, b: unknown) => toComparable(a) >  toComparable(b);
export const gte: FunctionImplementation = (a: unknown, b: unknown) => toComparable(a) >= toComparable(b);
export const lt:  FunctionImplementation = (a: unknown, b: unknown) => toComparable(a) <  toComparable(b);
export const lte: FunctionImplementation = (a: unknown, b: unknown) => toComparable(a) <= toComparable(b);

export const now: FunctionImplementation = () => new Date().toISOString();

export const openUrl: FunctionImplementation = (url: unknown) => {
  if (typeof url === 'string') {
    window.open(url, '_blank');
  }
};

export const commonFunctions: Record<string, FunctionImplementation> = {
  required,
  regex,
  length,
  numeric,
  email,
  formatString,
  formatNumber,
  formatCurrency,
  formatDate,
  pluralize,
  now,
  openUrl,
  not,
  and,
  or,
  isEmpty,
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
};
