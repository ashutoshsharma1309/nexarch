/**
 * Maps a design column to everything the frontend needs to render it: a
 * TypeScript type, a Zod schema expression (form validation), the HTML
 * input type (or 'select' for enums), a human label, and a mock value for
 * previews. Keeping this in one place is what keeps the generated entity
 * types, forms, and table columns in agreement.
 */
import type { ColumnDesign } from '../../../shared/types/design.js';
import type { FieldInputType } from '../frontend-generator.types.js';

export function tsType(column: ColumnDesign): string {
  let base: string;
  if (column.enumValues) base = column.enumValues.map((v) => `'${v}'`).join(' | ');
  else if (column.prismaType === 'Int' || column.prismaType === 'Decimal') base = 'number';
  else if (column.prismaType === 'Boolean') base = 'boolean';
  else if (column.prismaType === 'DateTime') base = 'string';
  else base = 'string';
  return column.nullable ? `${base} | null` : base;
}

function zodBase(column: ColumnDesign): string {
  if (column.enumValues) return `z.enum([${column.enumValues.map((v) => `'${v}'`).join(', ')}])`;
  if (column.prismaType === 'Int') return 'z.coerce.number().int()';
  if (column.prismaType === 'Decimal') return 'z.coerce.number()';
  if (column.prismaType === 'Boolean') return 'z.boolean()';
  if (column.prismaType === 'DateTime') return 'z.string().min(1)';

  let schema = 'z.string()';
  if (column.format === 'email') schema += '.email()';
  else if (column.format === 'uri') schema += '.url()';
  else if (!column.nullable) schema += '.min(1)';
  const maxLength = /^VARCHAR\((\d+)\)$/.exec(column.sqlType);
  if (maxLength?.[1]) schema += `.max(${maxLength[1]})`;
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

export function inputTypeOf(column: ColumnDesign): FieldInputType {
  if (column.enumValues) return 'select';
  if (column.prismaType === 'Boolean') return 'checkbox';
  if (column.prismaType === 'Int' || column.prismaType === 'Decimal') return 'number';
  if (column.format === 'email') return 'email';
  if (column.prismaType === 'DateTime') return column.format === 'date' ? 'date' : 'datetime-local';
  if (
    column.description.length > 60 ||
    ['description', 'notes', 'bio', 'address', 'content', 'body', 'summary', 'remarks'].includes(
      column.name,
    )
  ) {
    return 'textarea';
  }
  if (column.name === 'password' || column.name === 'password_hash') return 'password';
  return 'text';
}

export function labelOf(column: ColumnDesign): string {
  return column.field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

export function mockValue(column: ColumnDesign): string {
  if (column.enumValues) return `'${column.enumValues[0] ?? 'VALUE'}'`;
  if (column.format === 'email') return `'user@example.com'`;
  if (column.format === 'uuid') return `'00000000-0000-0000-0000-000000000000'`;
  if (column.prismaType === 'Int') return '1';
  if (column.prismaType === 'Decimal') return '9.99';
  if (column.prismaType === 'Boolean') return 'true';
  if (column.prismaType === 'DateTime') return `'${new Date(0).toISOString()}'`;
  return `'${column.name}'`;
}
