/**
 * RelationshipEngine: turns the architecture plan's `many-to-one`/`one-to-one`
 * entity relations into a normalized relationship model — one record per
 * foreign key, with the parent/child sides, delete behavior, and the inverse
 * cardinality the ORM and ER diagram both need.
 *
 * Delete behavior is inferred, not guessed: a child that cannot exist without
 * its parent cascades (order items, messages); a reference that must not
 * orphan restricts (an order's customer); an optional link nullifies.
 */
import type { EntityPlan } from '../../../shared/types/architecture.js';
import { pascalCase } from '../../../shared/utils/strings.js';
import type { OnDelete, RelationshipDesign } from '../database-designer.types.js';

/** Children that are meaningless without their parent — deletes cascade. */
const CASCADE_CHILD_SUFFIXES = ['Items', 'Records', 'Movements', 'Lines'];
const CASCADE_CHILDREN = new Set([
  'OrderItems',
  'CartItems',
  'Messages',
  'Participants',
  'Comments',
  'Attachments',
  'Prescriptions',
  'Grades',
  'Submissions',
  'Payslips',
  'Statements',
  'HousekeepingTasks',
  'Notes',
  'Activities',
]);

/** Foreign keys that reference a strong entity which must not be orphaned. */
const RESTRICT_PARENTS = new Set(['Users', 'Products', 'Accounts', 'Doctors', 'Patients']);

function resolveOnDelete(child: string, parent: string, nullable: boolean): OnDelete {
  if (nullable) return 'SET NULL';
  if (CASCADE_CHILDREN.has(child) || CASCADE_CHILD_SUFFIXES.some((s) => child.endsWith(s))) {
    return 'CASCADE';
  }
  if (RESTRICT_PARENTS.has(parent)) return 'RESTRICT';
  return 'RESTRICT';
}

export interface ResolvedForeignKey {
  foreignKey: string;
  parent: string;
  cardinality: 'many-to-one' | 'one-to-one';
  onDelete: OnDelete;
  nullable: boolean;
}

/** Foreign keys that are optional by nature (the link may be absent). */
const OPTIONAL_FK_HINTS = ['assignee', 'owner', 'manager', 'department', 'category', 'parent'];

function isNullableForeignKey(foreignKey: string): boolean {
  return OPTIONAL_FK_HINTS.some((hint) => foreignKey.includes(hint));
}

/** Foreign keys for one entity, derived from its architecture relations. */
export function resolveForeignKeys(entity: EntityPlan): ResolvedForeignKey[] {
  const seen = new Set<string>();
  const resolved: ResolvedForeignKey[] = [];

  for (const relation of entity.relations) {
    if (seen.has(relation.foreignKey)) continue;
    seen.add(relation.foreignKey);
    const nullable = isNullableForeignKey(relation.foreignKey);
    resolved.push({
      foreignKey: relation.foreignKey,
      parent: pascalCase(relation.target),
      cardinality: relation.type,
      onDelete: resolveOnDelete(entity.name, pascalCase(relation.target), nullable),
      nullable,
    });
  }

  return resolved;
}

/** The full relationship set across every entity, for the design + ER diagram. */
export function buildRelationships(entities: readonly EntityPlan[]): RelationshipDesign[] {
  const present = new Set(entities.map((entity) => entity.name));
  const relationships: RelationshipDesign[] = [];

  for (const entity of entities) {
    for (const fk of resolveForeignKeys(entity)) {
      if (!present.has(fk.parent)) continue;
      const cardinality = fk.cardinality === 'one-to-one' ? 'one-to-one' : 'many-to-one';
      relationships.push({
        name: `${entity.name}_${fk.parent}`,
        cardinality,
        parent: fk.parent,
        child: entity.name,
        foreignKey: fk.foreignKey,
        onDelete: fk.onDelete,
        description:
          cardinality === 'one-to-one'
            ? `Each ${entity.name} is linked to exactly one ${fk.parent}.`
            : `Each ${entity.name} belongs to one ${fk.parent}; a ${fk.parent} has many ${entity.name}.`,
      });
    }
  }

  return relationships;
}
