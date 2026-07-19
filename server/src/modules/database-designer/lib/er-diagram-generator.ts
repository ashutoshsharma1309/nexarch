/**
 * ER diagram generator: projects the relational design into nodes (entities
 * with their columns) and edges (relationships with cardinality) for the
 * frontend's diagram viewer and any external ERD tool.
 */
import { kebabCase } from '../../../shared/utils/strings.js';
import type { DatabaseDesign, ErDiagram, ErEdge, ErNode } from '../database-designer.types.js';

const CARDINALITY_LABEL: Record<string, string> = {
  'one-to-one': '1 — 1',
  'one-to-many': '1 — N',
  'many-to-one': 'N — 1',
  'many-to-many': 'N — N',
};

/** Compact display type, e.g. `VARCHAR(320)` → `varchar`, `CHAR(36)` → `uuid`. */
function displayType(sqlType: string, isUuid: boolean): string {
  if (isUuid) return 'uuid';
  const base = sqlType.replace(/\(.*\)/, '').toLowerCase();
  return base;
}

export function generateErDiagram(design: DatabaseDesign): ErDiagram {
  const nodes: ErNode[] = design.tables.map((table) => ({
    id: kebabCase(table.entity),
    label: table.entity,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: displayType(column.sqlType, column.format === 'uuid'),
      primaryKey: column.primaryKey,
      foreignKey: Boolean(column.references),
      nullable: column.nullable,
    })),
  }));

  const edges: ErEdge[] = design.relationships.map((rel, index) => ({
    id: `e${index}`,
    from: kebabCase(rel.child),
    to: kebabCase(rel.parent),
    cardinality: rel.cardinality,
    label: CARDINALITY_LABEL[rel.cardinality] ?? rel.cardinality,
    foreignKey: rel.foreignKey,
  }));

  return { nodes, edges };
}
