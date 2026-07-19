/**
 * Column inference: resolve a single non-key field name into a full column
 * design (SQL type, Prisma type, format, enum values, uniqueness). The
 * semantic rules live in knowledge.ts; this module applies them and layers
 * on enum resolution and the `(unique)` markers carried over from the
 * architecture plan's key-field hints.
 */
import { camelCase } from '../../../shared/utils/strings.js';
import type { ColumnDesign } from '../database-designer.types.js';
import { DEFAULT_COLUMN_SPEC, ENUM_COLUMNS, ENUM_VALUES, INFERENCE_RULES } from './knowledge.js';

/** A key-field hint from the architecture plan, e.g. `email (unique)`. */
export interface ParsedField {
  name: string;
  unique: boolean;
}

/** Domain context that sharpens inference — currently the actual role set,
 * so a `role` column becomes an enum of real roles rather than a generic
 * status. */
export interface InferenceContext {
  roleEnumValues?: string[];
}

/** Split `sku (unique)` → { name: 'sku', unique: true }. */
export function parseKeyField(raw: string): ParsedField {
  const match = /^([a-z0-9_]+)\s*(\(unique\))?$/i.exec(raw.trim());
  if (!match?.[1]) return { name: raw.trim(), unique: false };
  return { name: match[1], unique: Boolean(match[2]) };
}

function resolveEnumValues(entity: string, column: string): string[] | null {
  return ENUM_VALUES[`${entity}.${column}`] ?? ENUM_VALUES[column] ?? null;
}

function humanize(column: string): string {
  return column.replace(/_/g, ' ');
}

export function inferColumn(
  entity: string,
  field: ParsedField,
  context: InferenceContext = {},
): ColumnDesign {
  const { name, unique } = field;

  // Enum-backed state columns come first: they override generic string rules.
  if (ENUM_COLUMNS.has(name)) {
    const roleValues =
      name === 'role' && context.roleEnumValues && context.roleEnumValues.length > 0
        ? context.roleEnumValues
        : null;
    const values = roleValues ?? resolveEnumValues(entity, name) ?? ['ACTIVE', 'INACTIVE'];
    const enumName = `${entity}${name
      .split('_')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')}`;
    // New users default to the least-privileged role (last in the list).
    const firstValue =
      (roleValues ? values[values.length - 1] : values[0]) ?? values[0] ?? 'ACTIVE';
    return {
      name,
      field: camelCase(name),
      sqlType: `ENUM(${values.map((v) => `'${v}'`).join(', ')})`,
      prismaType: enumName,
      nullable: false,
      primaryKey: false,
      unique,
      defaultExpression: firstValue,
      enumValues: values,
      description: `${humanize(name)} of the ${entity} record.`,
    };
  }

  const rule = INFERENCE_RULES.find((candidate) => candidate.match(name));
  const spec = rule?.spec ?? DEFAULT_COLUMN_SPEC;

  return {
    name,
    field: camelCase(name),
    sqlType: spec.sqlType,
    prismaType: spec.prismaType,
    ...(spec.prismaNativeType ? { prismaNativeType: spec.prismaNativeType } : {}),
    nullable: false,
    primaryKey: false,
    unique,
    ...(spec.format ? { format: spec.format } : {}),
    ...(spec.nonNegative ? { nonNegative: true } : {}),
    description: spec.format
      ? `${humanize(name)} (${spec.format}).`
      : `${humanize(name)} of the ${entity} record.`,
  };
}
