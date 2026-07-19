/**
 * Database Planner: entities, keys, relationships, indexes and
 * normalization guidance. Relationships are inferred from a curated rule
 * table plus the `XItems → X` naming convention — a rule only applies when
 * both entities exist in the spec, so the plan never invents tables.
 * Full column design belongs to the Database Designer stage.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { snakeCase } from '../../../shared/utils/strings.js';
import type { DatabasePlan, EntityPlan, EntityRelation } from '../architecture.types.js';
import { REGULATED_TYPES } from './common.js';

interface RelationRule {
  child: string;
  parent: string;
  foreignKey: string;
}

/** child many-to-one parent. Applied only when both entities are present. */
const RELATION_RULES: readonly RelationRule[] = [
  { child: 'Orders', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Carts', parent: 'Users', foreignKey: 'user_id' },
  { child: 'CartItems', parent: 'Products', foreignKey: 'product_id' },
  { child: 'OrderItems', parent: 'Products', foreignKey: 'product_id' },
  { child: 'Payments', parent: 'Orders', foreignKey: 'order_id' },
  { child: 'Reviews', parent: 'Products', foreignKey: 'product_id' },
  { child: 'Reviews', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Addresses', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Appointments', parent: 'Doctors', foreignKey: 'doctor_id' },
  { child: 'Appointments', parent: 'Patients', foreignKey: 'patient_id' },
  { child: 'Prescriptions', parent: 'Appointments', foreignKey: 'appointment_id' },
  { child: 'MedicalRecords', parent: 'Patients', foreignKey: 'patient_id' },
  { child: 'Doctors', parent: 'Departments', foreignKey: 'department_id' },
  { child: 'Invoices', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Students', parent: 'Classes', foreignKey: 'class_id' },
  { child: 'Sections', parent: 'Classes', foreignKey: 'class_id' },
  { child: 'AttendanceRecords', parent: 'Students', foreignKey: 'student_id' },
  { child: 'Grades', parent: 'Exams', foreignKey: 'exam_id' },
  { child: 'Grades', parent: 'Students', foreignKey: 'student_id' },
  { child: 'FeePayments', parent: 'Students', foreignKey: 'student_id' },
  { child: 'Leads', parent: 'Users', foreignKey: 'owner_id' },
  { child: 'Contacts', parent: 'Companies', foreignKey: 'company_id' },
  { child: 'Deals', parent: 'Leads', foreignKey: 'lead_id' },
  { child: 'Tasks', parent: 'Users', foreignKey: 'assignee_id' },
  { child: 'Activities', parent: 'Deals', foreignKey: 'deal_id' },
  { child: 'Notes', parent: 'Contacts', foreignKey: 'contact_id' },
  { child: 'Lessons', parent: 'Courses', foreignKey: 'course_id' },
  { child: 'Enrollments', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Enrollments', parent: 'Courses', foreignKey: 'course_id' },
  { child: 'Quizzes', parent: 'Courses', foreignKey: 'course_id' },
  { child: 'Questions', parent: 'Quizzes', foreignKey: 'quiz_id' },
  { child: 'Submissions', parent: 'Quizzes', foreignKey: 'quiz_id' },
  { child: 'Submissions', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Certificates', parent: 'Enrollments', foreignKey: 'enrollment_id' },
  { child: 'StockItems', parent: 'Products', foreignKey: 'product_id' },
  { child: 'StockItems', parent: 'Warehouses', foreignKey: 'warehouse_id' },
  { child: 'StockMovements', parent: 'StockItems', foreignKey: 'stock_item_id' },
  { child: 'PurchaseOrders', parent: 'Suppliers', foreignKey: 'supplier_id' },
  { child: 'Accounts', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Transactions', parent: 'Accounts', foreignKey: 'account_id' },
  { child: 'Transfers', parent: 'Accounts', foreignKey: 'from_account_id' },
  { child: 'Cards', parent: 'Accounts', foreignKey: 'account_id' },
  { child: 'Loans', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Statements', parent: 'Accounts', foreignKey: 'account_id' },
  { child: 'Employees', parent: 'Departments', foreignKey: 'department_id' },
  { child: 'AttendanceRecords', parent: 'Employees', foreignKey: 'employee_id' },
  { child: 'Leaves', parent: 'Employees', foreignKey: 'employee_id' },
  { child: 'Payslips', parent: 'Employees', foreignKey: 'employee_id' },
  { child: 'Candidates', parent: 'JobPostings', foreignKey: 'job_posting_id' },
  { child: 'Rooms', parent: 'RoomTypes', foreignKey: 'room_type_id' },
  { child: 'Bookings', parent: 'Rooms', foreignKey: 'room_id' },
  { child: 'Bookings', parent: 'Guests', foreignKey: 'guest_id' },
  { child: 'HousekeepingTasks', parent: 'Rooms', foreignKey: 'room_id' },
  { child: 'MenuItems', parent: 'Categories', foreignKey: 'category_id' },
  { child: 'Orders', parent: 'Tables', foreignKey: 'table_id' },
  { child: 'Conversations', parent: 'Users', foreignKey: 'created_by' },
  { child: 'Participants', parent: 'Conversations', foreignKey: 'conversation_id' },
  { child: 'Participants', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Messages', parent: 'Conversations', foreignKey: 'conversation_id' },
  { child: 'Messages', parent: 'Users', foreignKey: 'sender_id' },
  { child: 'Attachments', parent: 'Messages', foreignKey: 'message_id' },
  { child: 'Posts', parent: 'Users', foreignKey: 'author_id' },
  { child: 'Comments', parent: 'Posts', foreignKey: 'post_id' },
  { child: 'Comments', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Media', parent: 'Users', foreignKey: 'uploaded_by' },
  { child: 'Projects', parent: 'Users', foreignKey: 'owner_id' },
  { child: 'Tickets', parent: 'Users', foreignKey: 'user_id' },
  { child: 'Products', parent: 'Categories', foreignKey: 'category_id' },
];

/** Representative key columns per well-known entity (beyond id/FKs/timestamps). */
const KEY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  Users: ['email (unique)', 'password_hash', 'name', 'role'],
  Products: ['name', 'price', 'sku (unique)'],
  Orders: ['status', 'total_amount'],
  Payments: ['status', 'amount', 'provider_ref (unique)'],
  Appointments: ['scheduled_at', 'status'],
  Bookings: ['check_in', 'check_out', 'status'],
  Transactions: ['type', 'amount', 'balance_after'],
  Messages: ['body', 'sent_at'],
  Posts: ['title', 'slug (unique)', 'published_at'],
  Courses: ['title', 'price', 'published'],
  Leads: ['status', 'source'],
  Employees: ['employee_no (unique)', 'designation'],
  Invoices: ['number (unique)', 'status', 'total'],
  Rooms: ['number (unique)', 'status'],
  MenuItems: ['name', 'price', 'available'],
};

function itemsConventionRelation(
  entity: string,
  present: ReadonlySet<string>,
): EntityRelation | null {
  if (!entity.endsWith('Items')) return null;
  const parent = `${entity.slice(0, -'Items'.length)}s`;
  if (!present.has(parent)) return null;
  return {
    type: 'many-to-one',
    target: parent,
    foreignKey: `${snakeCase(parent).replace(/s$/, '')}_id`,
  };
}

function planEntity(entity: string, present: ReadonlySet<string>): EntityPlan {
  const relations: EntityRelation[] = [];

  const conventionRelation = itemsConventionRelation(entity, present);
  if (conventionRelation) relations.push(conventionRelation);

  for (const rule of RELATION_RULES) {
    if (rule.child !== entity || !present.has(rule.parent)) continue;
    if (relations.some((relation) => relation.foreignKey === rule.foreignKey)) continue;
    relations.push({ type: 'many-to-one', target: rule.parent, foreignKey: rule.foreignKey });
  }

  const foreignKeys = relations.map((relation) => relation.foreignKey);
  const indexes = [...foreignKeys];
  if (entity === 'Users') indexes.push('email (unique)');

  return {
    name: entity,
    tableName: snakeCase(entity),
    primaryKey: 'id',
    keyFields: ['id', ...(KEY_FIELDS[entity] ?? []), ...foreignKeys, 'created_at', 'updated_at'],
    relations,
    indexes,
  };
}

export function planDatabase(spec: RequirementSpec): DatabasePlan {
  const entityNames = spec.database.length > 0 ? spec.database : ['Users'];
  const present = new Set(entityNames);
  const entities = entityNames.map((entity) => planEntity(entity, present));

  const hasJoinTables = entityNames.some(
    (entity) => entity.endsWith('Items') || entity === 'Participants' || entity === 'Enrollments',
  );
  const normalization = [
    '3NF baseline: every non-key column depends on the key alone; no repeating groups.',
    hasJoinTables
      ? 'Many-to-many relationships resolve through explicit join tables (already present in the entity list) so line-level attributes have a home.'
      : 'Introduce join tables if any relationship becomes many-to-many; never store ID arrays in columns.',
    'Enumerations (statuses, types) as native ENUM or lookup tables — never free text.',
    'No derived values stored except explicitly-cached aggregates (e.g. order totals), recomputed on write.',
    REGULATED_TYPES.has(spec.projectType)
      ? `${spec.projectType} domain: use soft deletes plus an append-only audit table for regulated records.`
      : 'Hard deletes are acceptable; add soft deletes only where recovery workflows demand them.',
  ];

  return { engine: 'MySQL 8', entities, normalization };
}
