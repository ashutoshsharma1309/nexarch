/**
 * Maps a design column to the three representations the emitters need: a
 * TypeScript type (for entity interfaces and DTOs), a Zod schema expression
 * (for request validation), and a mock value (for test fixtures). Keeping
 * the mapping in one place is what keeps the generated entity types, DTOs,
 * and validators in perfect agreement.
 */
import type { ColumnDesign } from '../../../shared/types/design.js';

export function tsType(column: ColumnDesign): string {
  let base: string;
  if (column.enumValues) base = column.enumValues.map((v) => `'${v}'`).join(' | ');
  else if (column.prismaType === 'Int' || column.prismaType === 'Decimal') base = 'number';
  else if (column.prismaType === 'Boolean') base = 'boolean';
  else if (column.prismaType === 'DateTime') base = 'Date';
  else base = 'string';
  return column.nullable ? `${base} | null` : base;
}

/** Zod expression for a column, without the required/optional wrapper. */
function zodBase(column: ColumnDesign): string {
  if (column.enumValues) {
    return `z.enum([${column.enumValues.map((v) => `'${v}'`).join(', ')}])`;
  }
  if (column.prismaType === 'Int') return 'z.number().int()';
  if (column.prismaType === 'Decimal') return 'z.number()';
  if (column.prismaType === 'Boolean') return 'z.boolean()';
  if (column.prismaType === 'DateTime') return 'z.coerce.date()';

  let schema = 'z.string()';
  if (column.format === 'email') schema += '.email()';
  else if (column.format === 'uuid') schema += '.uuid()';
  else if (column.format === 'uri') schema += '.url()';
  const maxLength = /^VARCHAR\((\d+)\)$/.exec(column.sqlType);
  if (maxLength?.[1]) schema += `.max(${maxLength[1]})`;
  if (!maxLength && column.sqlType.startsWith('VARCHAR')) schema += '.min(1)';
  return schema;
}

export function zodField(column: ColumnDesign, partial: boolean): string {
  let expr = zodBase(column);
  if (column.nonNegative) expr += '.nonnegative()';
  if (column.nullable) expr += '.nullable()';
  const hasDefault = Boolean(column.defaultExpression) || column.enumValues !== undefined;
  if (partial || column.nullable || hasDefault) expr += '.optional()';
  return expr;
}

export function mockValue(column: ColumnDesign): string {
  if (column.enumValues) return `'${column.enumValues[0] ?? 'VALUE'}'`;
  if (column.format === 'email') return `'user@example.com'`;
  if (column.format === 'uuid') return `'00000000-0000-0000-0000-000000000000'`;
  if (column.format === 'uri') return `'https://example.com'`;
  if (column.prismaType === 'Int') return '1';
  if (column.prismaType === 'Decimal') return '9.99';
  if (column.prismaType === 'Boolean') return 'true';
  if (column.prismaType === 'DateTime') return 'new Date()';
  return `'${column.name}-sample'`;
}
