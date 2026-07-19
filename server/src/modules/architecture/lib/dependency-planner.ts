/**
 * Dependency Planner: the module dependency graph that drives build order
 * and — in the incremental-regeneration phase — impact analysis (change a
 * module, regenerate only its dependents). Edges point from dependent to
 * dependency; a rule only fires when both modules exist in the spec.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { kebabCase } from '../../../shared/utils/strings.js';
import type { DependencyGraph } from '../architecture.types.js';
import { dataModules, hasModule } from './common.js';

interface DependencyRule {
  from: string;
  to: string;
  reason: string;
}

const DEPENDENCY_RULES: readonly DependencyRule[] = [
  { from: 'Cart', to: 'Products', reason: 'cart lines reference products' },
  { from: 'Orders', to: 'Products', reason: 'order lines reference products' },
  { from: 'Orders', to: 'Cart', reason: 'checkout converts a cart into an order' },
  { from: 'Orders', to: 'Menu', reason: 'order lines reference menu items' },
  { from: 'Orders', to: 'Tables', reason: 'dine-in orders attach to a table' },
  { from: 'Payments', to: 'Orders', reason: 'payments settle orders' },
  { from: 'Billing', to: 'Appointments', reason: 'invoices are raised from appointments' },
  { from: 'Billing', to: 'Bookings', reason: 'invoices are raised from bookings' },
  { from: 'Billing', to: 'Orders', reason: 'invoices are raised from orders' },
  { from: 'Reviews', to: 'Products', reason: 'reviews attach to products' },
  { from: 'Appointments', to: 'Doctors', reason: 'appointments are booked with a doctor' },
  { from: 'Appointments', to: 'Patients', reason: 'appointments belong to a patient' },
  {
    from: 'Prescriptions',
    to: 'Appointments',
    reason: 'prescriptions are issued during appointments',
  },
  { from: 'Students', to: 'Classes', reason: 'students are assigned to classes' },
  { from: 'Attendance', to: 'Students', reason: 'attendance records belong to students' },
  { from: 'Attendance', to: 'Employees', reason: 'attendance records belong to employees' },
  { from: 'Exams', to: 'Classes', reason: 'exams are scheduled per class' },
  { from: 'Fees', to: 'Students', reason: 'fees are levied per student' },
  { from: 'Timetable', to: 'Classes', reason: 'timetables are built per class' },
  { from: 'Timetable', to: 'Teachers', reason: 'timetables allocate teachers' },
  { from: 'Deals', to: 'Leads', reason: 'deals are qualified from leads' },
  { from: 'Deals', to: 'Contacts', reason: 'deals attach to contacts' },
  { from: 'Tasks', to: 'Deals', reason: 'tasks track deal follow-ups' },
  { from: 'Enrollments', to: 'Courses', reason: 'enrollments join users to courses' },
  { from: 'Quizzes', to: 'Courses', reason: 'quizzes belong to courses' },
  {
    from: 'Certificates',
    to: 'Enrollments',
    reason: 'certificates issue on completed enrollments',
  },
  { from: 'Inventory', to: 'Products', reason: 'stock levels track products' },
  { from: 'Suppliers', to: 'Inventory', reason: 'purchase orders replenish stock' },
  { from: 'Transactions', to: 'Accounts', reason: 'transactions post to accounts' },
  { from: 'Loans', to: 'Accounts', reason: 'loan disbursement and repayment use accounts' },
  { from: 'Bookings', to: 'Rooms', reason: 'bookings reserve rooms' },
  { from: 'Bookings', to: 'Guests', reason: 'bookings belong to guests' },
  { from: 'Payroll', to: 'Employees', reason: 'payslips are computed per employee' },
  { from: 'Leave Management', to: 'Employees', reason: 'leave balances belong to employees' },
  { from: 'Comments', to: 'Posts', reason: 'comments attach to posts' },
];

/** Modules whose events feed the notification stream. */
const NOTIFICATION_EMITTERS = [
  'Orders',
  'Appointments',
  'Bookings',
  'Payments',
  'Enrollments',
  'Transactions',
  'Leave Management',
];

export function planDependencies(spec: RequirementSpec): DependencyGraph {
  const nodes = spec.modules.map((module) => ({ id: kebabCase(module), label: module }));
  const present = new Set(spec.modules);
  const edges: DependencyGraph['edges'] = [];

  const addEdge = (from: string, to: string, reason: string): void => {
    if (!present.has(from) || !present.has(to) || from === to) return;
    const fromId = kebabCase(from);
    const toId = kebabCase(to);
    if (edges.some((edge) => edge.from === fromId && edge.to === toId)) return;
    edges.push({ from: fromId, to: toId, reason });
  };

  // Everything protected depends on Authentication.
  for (const module of spec.modules) {
    if (module !== 'Authentication') {
      addEdge(module, 'Authentication', 'requires an authenticated user context');
    }
  }

  for (const rule of DEPENDENCY_RULES) {
    addEdge(rule.from, rule.to, rule.reason);
  }

  if (hasModule(spec, 'Reports')) {
    for (const module of dataModules(spec)) {
      addEdge('Reports', module, 'aggregates this module’s data');
    }
  }
  if (hasModule(spec, 'Notifications')) {
    for (const emitter of NOTIFICATION_EMITTERS) {
      addEdge(emitter, 'Notifications', 'emits events into the notification stream');
    }
  }

  return { nodes, edges };
}
