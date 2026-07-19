/**
 * Entity metadata generator: the human/product view of each table —
 * description, who owns it, which roles may do what, its lifecycle states,
 * and the business rules the schema encodes. Ownership and permissions are
 * derived from the requirement roles and the entity's foreign keys.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type {
  DatabaseDesign,
  EntityMetadata,
  EntityMetadataSet,
  EntityPermission,
  RelationshipCardinality,
  TableDesign,
} from '../database-designer.types.js';

/** FK columns that indicate end-user ownership of a row. */
const OWNER_FKS = ['user_id', 'owner_id', 'created_by', 'author_id', 'uploaded_by'];

function ownershipOf(table: TableDesign, roles: readonly string[]): string {
  const ownerFk = table.columns.find((c) => OWNER_FKS.includes(c.name));
  if (ownerFk) {
    const endUser = roles.find((r) => r !== 'Admin' && r !== 'Manager') ?? 'the owning user';
    return `Owned by ${endUser} (via ${ownerFk.name}); administrable by Admin.`;
  }
  return 'System-owned; managed by Admin.';
}

function permissionsOf(table: TableDesign, roles: readonly string[]): EntityPermission[] {
  const owned = table.columns.some((c) => OWNER_FKS.includes(c.name));
  return roles.map((role) => {
    if (role === 'Admin') {
      return { role, actions: ['create', 'read', 'update', 'delete'] };
    }
    if (role === 'Manager') {
      return { role, actions: ['create', 'read', 'update'] };
    }
    // Non-privileged roles get CRUD on rows they own, read-only otherwise.
    return owned ? { role, actions: ['create', 'read', 'update'] } : { role, actions: ['read'] };
  });
}

function lifecycleOf(table: TableDesign): string[] {
  const statusColumn = table.columns.find(
    (c) => c.enumValues && (c.name === 'status' || c.name === 'state'),
  );
  if (statusColumn?.enumValues) {
    return [...statusColumn.enumValues, table.softDelete ? 'SOFT_DELETED' : 'DELETED'];
  }
  return ['CREATED', 'UPDATED', table.softDelete ? 'SOFT_DELETED' : 'DELETED'];
}

function businessRulesOf(table: TableDesign): string[] {
  const rules: string[] = ['Primary key `id` is a UUID generated on insert.'];
  if (table.softDelete) {
    rules.push('Deletes are soft: `deleted_at` is set and the row is excluded from default reads.');
  }
  rules.push('`created_at` and `updated_at` are managed automatically.');
  for (const column of table.columns) {
    if (column.unique && !column.primaryKey) {
      rules.push(`\`${column.name}\` must be unique across all ${table.entity}.`);
    }
    if (column.references) {
      rules.push(
        `\`${column.name}\` must reference an existing ${column.references.table} (${column.references.onDelete} on delete).`,
      );
    }
    if (column.nonNegative) {
      rules.push(`\`${column.name}\` must be zero or greater.`);
    }
  }
  return rules;
}

function relationshipsOf(design: DatabaseDesign, entity: string): EntityMetadata['relationships'] {
  const result: { related: string; cardinality: RelationshipCardinality; via: string }[] = [];
  for (const rel of design.relationships) {
    if (rel.child === entity) {
      result.push({ related: rel.parent, cardinality: rel.cardinality, via: rel.foreignKey });
    } else if (rel.parent === entity) {
      const inverse: RelationshipCardinality =
        rel.cardinality === 'many-to-one' ? 'one-to-many' : rel.cardinality;
      result.push({ related: rel.child, cardinality: inverse, via: rel.foreignKey });
    }
  }
  return result;
}

export function generateEntityMetadata(
  design: DatabaseDesign,
  requirements: RequirementSpec,
): EntityMetadataSet {
  const roles = requirements.roles.length > 0 ? requirements.roles : ['Admin', 'User'];

  const entities: EntityMetadata[] = design.tables.map((table) => ({
    entity: table.entity,
    tableName: table.tableName,
    description: `${table.entity} in the ${requirements.projectType} domain.`,
    ownership: ownershipOf(table, roles),
    permissions: permissionsOf(table, roles),
    lifecycle: lifecycleOf(table),
    businessRules: businessRulesOf(table),
    relationships: relationshipsOf(design, table.entity),
  }));

  return {
    meta: { projectName: design.meta.projectName, generatedAt: design.meta.generatedAt },
    entities,
  };
}
