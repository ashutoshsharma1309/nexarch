/**
 * ValidationGenerator: derives field-level validation rules from the column
 * design. Downstream backend and frontend generators consume this as the
 * single source of truth for input validation, so the rules mirror exactly
 * what the schema enforces (types, lengths, formats, uniqueness, enums,
 * required-ness, referential integrity, non-negativity).
 */
import type {
  ColumnDesign,
  DatabaseDesign,
  EntityValidation,
  FieldValidation,
  FieldValidationRule,
  ValidationRuleSet,
} from '../database-designer.types.js';

/** Columns the server owns — never client-supplied, so no input rules. */
const SERVER_MANAGED = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

const FORMAT_MESSAGE: Record<string, string> = {
  email: 'Must be a valid email address.',
  phone: 'Must be a valid phone number.',
  uuid: 'Must be a valid UUID.',
  date: 'Must be a valid date.',
  uri: 'Must be a valid URL.',
  slug: 'Must be a URL-safe slug (lowercase, hyphenated).',
};

function maxLengthFromType(sqlType: string): number | null {
  const match = /^VARCHAR\((\d+)\)$/.exec(sqlType);
  return match?.[1] ? Number(match[1]) : null;
}

function rulesForColumn(column: ColumnDesign): FieldValidationRule[] {
  const rules: FieldValidationRule[] = [];

  const hasDefault = Boolean(column.defaultExpression) || column.enumValues !== undefined;
  if (!column.nullable && !hasDefault && !column.references) {
    rules.push({ rule: 'required', message: `${column.field} is required.` });
  }
  if (column.references) {
    rules.push({
      rule: 'foreignKey',
      value: column.references.table,
      message: `Must reference an existing ${column.references.table} record.`,
    });
  }

  // Type rule (normalized to the JSON/TS type family).
  const typeName =
    column.prismaType === 'Int'
      ? 'integer'
      : column.prismaType === 'Decimal'
        ? 'number'
        : column.prismaType === 'Boolean'
          ? 'boolean'
          : column.prismaType === 'DateTime'
            ? 'date'
            : column.enumValues
              ? 'enum'
              : 'string';
  rules.push({ rule: 'type', value: typeName, message: `Must be a ${typeName}.` });

  const maxLength = maxLengthFromType(column.sqlType);
  if (maxLength !== null) {
    rules.push({
      rule: 'maxLength',
      value: maxLength,
      message: `Must be at most ${maxLength} characters.`,
    });
  }
  if (column.format) {
    const formatMessage = FORMAT_MESSAGE[column.format];
    if (formatMessage) {
      rules.push({ rule: 'format', value: column.format, message: formatMessage });
    }
  }
  if (column.enumValues) {
    rules.push({
      rule: 'enum',
      value: column.enumValues,
      message: `Must be one of: ${column.enumValues.join(', ')}.`,
    });
  }
  if (column.unique && !column.primaryKey) {
    rules.push({ rule: 'unique', message: `${column.field} must be unique.` });
  }
  if (column.nonNegative) {
    rules.push({ rule: 'min', value: 0, message: `${column.field} must be zero or greater.` });
  }

  return rules;
}

function validateEntity(design: DatabaseDesign, entity: string): EntityValidation {
  const table = design.tables.find((t) => t.entity === entity);
  const fields: FieldValidation[] = [];
  if (table) {
    for (const column of table.columns) {
      if (SERVER_MANAGED.has(column.name)) continue;
      fields.push({
        field: column.field,
        type: column.enumValues ? 'enum' : column.prismaType,
        rules: rulesForColumn(column),
      });
    }
  }
  return { entity, fields };
}

export function generateValidationRules(design: DatabaseDesign): ValidationRuleSet {
  return {
    meta: { projectName: design.meta.projectName, generatedAt: design.meta.generatedAt },
    entities: design.tables.map((table) => validateEntity(design, table.entity)),
  };
}
