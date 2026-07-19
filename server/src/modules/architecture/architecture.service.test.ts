/**
 * Architecture Planner behavior tests (`npm test`). Plans are built for
 * every required domain and checked structurally; one integration test
 * pipes real Requirement Analyzer output into the planner to guard the
 * cross-stage contract.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RequirementSpec } from '../../shared/types/requirement.js';
import { analyzeRequirements } from '../analysis/analysis.service.js';
import { planArchitecture } from './architecture.service.js';
import type { ArchitectureDecision, ArchitecturePlan } from './architecture.types.js';

function spec(
  partial: Partial<RequirementSpec> &
    Pick<RequirementSpec, 'projectName' | 'projectType' | 'modules'>,
): RequirementSpec {
  return {
    roles: ['Admin', 'User'],
    frontend: [],
    backend: [],
    database: ['Users'],
    authentication: ['JWT', 'RBAC'],
    integrations: [],
    missingRequirements: [],
    ...partial,
  };
}

const hospitalSpec = spec({
  projectName: 'Hospital Management',
  projectType: 'Hospital',
  roles: ['Admin', 'Doctor', 'Patient'],
  modules: [
    'Authentication',
    'Dashboard',
    'Appointments',
    'Patients',
    'Doctors',
    'Billing',
    'Reports',
  ],
  database: ['Users', 'Doctors', 'Patients', 'Appointments', 'Prescriptions', 'Invoices'],
  integrations: ['Email', 'SMS'],
});
const erpSpec = spec({
  projectName: 'ERP System',
  projectType: 'ERP',
  roles: ['Admin', 'Manager', 'Employee'],
  modules: ['Authentication', 'Dashboard', 'Inventory', 'Suppliers', 'Finance', 'HR', 'Reports'],
  database: ['Users', 'Employees', 'Products', 'Suppliers', 'PurchaseOrders', 'Invoices'],
});
const schoolSpec = spec({
  projectName: 'School Management',
  projectType: 'School',
  roles: ['Admin', 'Teacher', 'Student', 'Parent'],
  modules: ['Authentication', 'Students', 'Teachers', 'Classes', 'Attendance', 'Exams', 'Fees'],
  database: [
    'Users',
    'Students',
    'Teachers',
    'Classes',
    'AttendanceRecords',
    'Exams',
    'Grades',
    'FeePayments',
  ],
  integrations: ['SMS'],
});
const crmSpec = spec({
  projectName: 'CRM Platform',
  projectType: 'CRM',
  roles: ['Admin', 'Manager', 'Sales Rep'],
  modules: ['Authentication', 'Dashboard', 'Leads', 'Contacts', 'Deals', 'Tasks', 'Reports'],
  database: ['Users', 'Leads', 'Contacts', 'Companies', 'Deals', 'Tasks'],
  integrations: ['Email'],
});
const restaurantSpec = spec({
  projectName: 'Restaurant POS',
  projectType: 'Restaurant',
  roles: ['Admin', 'Manager', 'Waiter', 'Kitchen Staff'],
  modules: ['Authentication', 'Dashboard', 'Menu', 'Orders', 'Tables', 'Billing', 'Reports'],
  database: ['Users', 'MenuItems', 'Categories', 'Orders', 'OrderItems', 'Tables', 'Invoices'],
  integrations: ['Payment Gateway'],
});
const hotelSpec = spec({
  projectName: 'Hotel Management',
  projectType: 'Hotel',
  roles: ['Admin', 'Receptionist', 'Guest'],
  modules: [
    'Authentication',
    'Dashboard',
    'Rooms',
    'Bookings',
    'Guests',
    'Billing',
    'Notifications',
  ],
  database: ['Users', 'Rooms', 'RoomTypes', 'Bookings', 'Guests', 'Invoices'],
  integrations: ['Payment Gateway', 'Email'],
});
const inventorySpec = spec({
  projectName: 'Inventory Management',
  projectType: 'Inventory',
  roles: ['Admin', 'Manager', 'Employee'],
  modules: [
    'Authentication',
    'Dashboard',
    'Products',
    'Inventory',
    'Suppliers',
    'Reports',
    'Notifications',
  ],
  database: [
    'Users',
    'Products',
    'Warehouses',
    'StockItems',
    'StockMovements',
    'Suppliers',
    'PurchaseOrders',
  ],
  integrations: ['Email', 'Excel Export'],
});
const bankingSpec = spec({
  projectName: 'Banking System',
  projectType: 'Banking',
  roles: ['Admin', 'Customer', 'Teller'],
  modules: [
    'Authentication',
    'Dashboard',
    'Accounts',
    'Transactions',
    'Loans',
    'Reports',
    'Notifications',
  ],
  database: ['Users', 'Accounts', 'Transactions', 'Transfers', 'Cards', 'Loans'],
  authentication: ['JWT', 'OTP', 'RBAC'],
  integrations: ['SMS', 'Email'],
});
const portfolioSpec = spec({
  projectName: 'Portfolio Website',
  projectType: 'Portfolio',
  roles: ['Admin', 'Visitor'],
  modules: ['Authentication', 'Projects', 'About', 'Contact'],
  database: ['Users', 'Projects', 'Skills', 'ContactMessages'],
  integrations: ['Email'],
});
const chatSpec = spec({
  projectName: 'Chat Application',
  projectType: 'Chat',
  roles: ['Admin', 'User'],
  modules: ['Authentication', 'Conversations', 'Contacts', 'Notifications', 'Settings'],
  database: ['Users', 'Conversations', 'Participants', 'Messages', 'Attachments'],
  integrations: ['Real-time (Socket.io)', 'Notifications', 'File Upload'],
});

const DOMAIN_SPECS: readonly RequirementSpec[] = [
  hospitalSpec,
  erpSpec,
  schoolSpec,
  crmSpec,
  restaurantSpec,
  hotelSpec,
  inventorySpec,
  bankingSpec,
  portfolioSpec,
  chatSpec,
];

function assertStructurallySound(plan: ArchitecturePlan, source: RequirementSpec): void {
  // Every decision has a choice and a reasoning.
  const allDecisions: ArchitectureDecision[] = [
    plan.decisions.architecture,
    plan.decisions.frontendArchitecture,
    plan.decisions.backendArchitecture,
    plan.decisions.database,
    plan.decisions.authentication,
  ];
  for (const decision of allDecisions) {
    assert.ok(decision.choice.length > 0);
    assert.ok(decision.reasoning.length > 20, 'decisions must carry real reasoning');
    assert.ok(decision.alternatives.length > 0, 'decisions must record rejected alternatives');
  }
  // Auth endpoints always planned; every data module gets an API surface.
  assert.ok(plan.apiModules.some((m) => m.module === 'Authentication'));
  assert.ok(plan.apiModules.every((m) => m.endpoints.length > 0));
  // Entities carry PKs and snake_case tables.
  for (const entity of plan.database.entities) {
    assert.equal(entity.primaryKey, 'id');
    assert.match(entity.tableName, /^[a-z0-9_]+$/);
  }
  // Dependency graph: every non-auth module depends on Authentication.
  const authEdges = plan.dependencyGraph.edges.filter((e) => e.to === 'authentication');
  assert.equal(authEdges.length, source.modules.filter((m) => m !== 'Authentication').length);
  // Folder tree contains client and server roots.
  const rootNames = plan.folderStructure.map((n) => n.name);
  assert.ok(rootNames.includes('client') && rootNames.includes('server'));
  // Frontend always has auth pages + dashboard.
  const pageNames = plan.frontend.pages.map((p) => p.name);
  assert.ok(pageNames.includes('Login') && pageNames.includes('Dashboard'));
}

describe('architecture planning across domains', () => {
  for (const domainSpec of DOMAIN_SPECS) {
    it(`plans ${domainSpec.projectType} (${domainSpec.projectName})`, () => {
      const { plan, markdown } = planArchitecture(domainSpec);
      assertStructurallySound(plan, domainSpec);
      assert.ok(markdown.includes(`# ${domainSpec.projectName} — Software Design Specification`));
      assert.ok(markdown.includes('## 5. API Overview'));
      assert.ok(markdown.includes('## 6. Database Overview'));
    });
  }
});

describe('domain-specific planning behavior', () => {
  it('infers hospital relationships and audit posture', () => {
    const { plan } = planArchitecture(hospitalSpec);
    const appointments = plan.database.entities.find((e) => e.name === 'Appointments');
    assert.ok(appointments);
    const targets = appointments.relations.map((r) => r.target).sort();
    assert.deepEqual(targets, ['Doctors', 'Patients']);
    assert.ok(plan.middleware.some((m) => m.name === 'auditLogger'));
    assert.ok(plan.database.normalization.some((n) => n.includes('soft deletes')));
  });

  it('adds realtime scaling advice only for realtime specs', () => {
    const chat = planArchitecture(chatSpec);
    assert.ok(chat.plan.futureScalability.some((r) => r.recommendation.includes('Socket.io')));

    const portfolio = planArchitecture(portfolioSpec);
    assert.ok(
      !portfolio.plan.futureScalability.some((r) => r.recommendation.includes('Socket.io')),
    );
  });

  it('raises the security bar for regulated domains', () => {
    const banking = planArchitecture(bankingSpec);
    assert.ok(banking.plan.nonFunctional.security.score >= 9);
    assert.ok(banking.plan.security.passwordPolicy.some((p) => p.includes('12')));
  });

  it('plans OrderItems relations via the items naming convention and rules', () => {
    const shop = planArchitecture(
      spec({
        projectName: 'Storefront',
        projectType: 'Ecommerce',
        modules: ['Authentication', 'Products', 'Orders'],
        database: ['Users', 'Products', 'Orders', 'OrderItems'],
      }),
    );
    const orderItems = shop.plan.database.entities.find((e) => e.name === 'OrderItems');
    assert.ok(orderItems);
    assert.ok(orderItems.relations.some((r) => r.target === 'Orders'));
    assert.ok(orderItems.relations.some((r) => r.target === 'Products'));

    // The convention never invents absent parents: the restaurant spec has
    // MenuItems (no Products), so OrderItems only relates to Orders there.
    const restaurant = planArchitecture(restaurantSpec);
    const posOrderItems = restaurant.plan.database.entities.find((e) => e.name === 'OrderItems');
    assert.ok(posOrderItems);
    assert.deepEqual(
      posOrderItems.relations.map((r) => r.target),
      ['Orders'],
    );
  });
});

describe('pipeline integration (analyzer → planner)', () => {
  it('consumes a real analyzer spec end to end', () => {
    const analysis = analyzeRequirements(
      'Build an E-Commerce Website with JWT authentication, Admin Dashboard, Product Management and Order Tracking',
    );
    if (analysis.status !== 'COMPLETE') {
      assert.fail(`expected COMPLETE analysis, got ${analysis.status}`);
    }

    const { plan, markdown } = planArchitecture(analysis.spec);
    assertStructurallySound(plan, analysis.spec);
    assert.equal(plan.meta.projectType, 'Ecommerce');
    assert.ok(plan.apiModules.some((m) => m.basePath === '/products'));
    assert.ok(markdown.includes('POST | `/auth/login`'));
  });
});
