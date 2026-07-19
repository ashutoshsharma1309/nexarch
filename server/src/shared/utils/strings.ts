/**
 * Pure string utilities shared across modules (naming conventions for
 * planners, canonicalization for the analyzer).
 */

/** Stable de-duplication that preserves first-seen order. */
export function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Naive singular form ("Appointments" → "Appointment"). Deliberately
 * conservative: words where stripping "s" would be wrong (Analytics,
 * Status, Address) are left untouched.
 */
export function singularize(word: string): string {
  if (/(?:ics|us|ss)$/i.test(word)) return word;
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** "Leave Management" → "leave-management" */
export function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** "leave management" / "LeaveManagement" → "LeaveManagement" */
export function pascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join('');
}

/** "OrderItems" → "order_items" */
export function snakeCase(value: string): string {
  return kebabCase(value).replace(/-/g, '_');
}

/** "order_items" / "OrderItems" → "orderItems" */
export function camelCase(value: string): string {
  const pascal = pascalCase(value);
  return pascal.length > 0 ? `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}` : pascal;
}
