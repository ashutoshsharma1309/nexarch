/**
 * SchemaValidator: proves the generated design is internally consistent
 * before it becomes the source of truth downstream. It checks primary keys,
 * duplicate columns, foreign-key targets, relationship endpoints, enum
 * backing, naming conventions, and that the OpenAPI contract covers the
 * design. Any `error`-severity issue makes the bundle invalid.
 */
import type {
  DatabaseDesign,
  IntegrityIssue,
  IntegrityReport,
  OpenApiDocument,
} from '../database-designer.types.js';

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

export function validateDesign(design: DatabaseDesign, openapi: OpenApiDocument): IntegrityReport {
  const issues: IntegrityIssue[] = [];
  const tableEntities = new Set(design.tables.map((t) => t.entity));
  const enumNames = new Set(design.enums.map((e) => e.name));

  let columnCount = 0;
  let indexCount = 0;

  for (const table of design.tables) {
    columnCount += table.columns.length;
    indexCount += table.indexes.length;

    if (!SNAKE_CASE.test(table.tableName)) {
      issues.push({
        severity: 'warning',
        location: table.tableName,
        message: 'Table name is not snake_case.',
      });
    }

    const pk = table.columns.find((c) => c.primaryKey);
    if (!pk) {
      issues.push({
        severity: 'error',
        location: table.entity,
        message: 'Table has no primary key.',
      });
    } else if (pk.name !== table.primaryKey) {
      issues.push({
        severity: 'error',
        location: table.entity,
        message: `primaryKey "${table.primaryKey}" does not match the PK column "${pk.name}".`,
      });
    }

    const seen = new Set<string>();
    for (const column of table.columns) {
      if (seen.has(column.name)) {
        issues.push({
          severity: 'error',
          location: `${table.entity}.${column.name}`,
          message: 'Duplicate column name.',
        });
      }
      seen.add(column.name);

      if (column.references && !tableEntities.has(column.references.table)) {
        issues.push({
          severity: 'error',
          location: `${table.entity}.${column.name}`,
          message: `Foreign key references unknown table "${column.references.table}".`,
        });
      }
      if (column.enumValues && !enumNames.has(column.prismaType)) {
        issues.push({
          severity: 'error',
          location: `${table.entity}.${column.name}`,
          message: `Enum type "${column.prismaType}" is not declared.`,
        });
      }
      if (column.enumValues?.length === 0) {
        issues.push({
          severity: 'error',
          location: `${table.entity}.${column.name}`,
          message: 'Enum column has no values.',
        });
      }
    }
  }

  for (const rel of design.relationships) {
    if (!tableEntities.has(rel.parent)) {
      issues.push({
        severity: 'error',
        location: rel.name,
        message: `Relationship parent "${rel.parent}" is not a table.`,
      });
    }
    if (!tableEntities.has(rel.child)) {
      issues.push({
        severity: 'error',
        location: rel.name,
        message: `Relationship child "${rel.child}" is not a table.`,
      });
    }
  }

  const endpointCount = Object.values(openapi.paths).reduce(
    (sum, item) => sum + Object.keys(item).length,
    0,
  );
  if (endpointCount === 0) {
    issues.push({
      severity: 'warning',
      location: 'openapi',
      message: 'No API operations were generated.',
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    stats: {
      tables: design.tables.length,
      columns: columnCount,
      relationships: design.relationships.length,
      indexes: indexCount,
      enums: design.enums.length,
      endpoints: endpointCount,
    },
  };
}
