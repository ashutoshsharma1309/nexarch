/**
 * Column → TypeScript/Zod mapping, duplicated (not imported) from the
 * Backend Generator's identical helper — "modules are islands". Only what
 * the Authentication module needs (register's extra identity-table fields).
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
