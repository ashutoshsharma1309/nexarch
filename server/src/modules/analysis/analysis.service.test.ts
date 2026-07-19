/**
 * Requirement analyzer behavior tests, runnable with the built-in Node test
 * runner (`npm test`). The service is pure and deterministic, so these are
 * exact assertions — no mocks, no network, no database.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeRequirements } from './analysis.service.js';
import type { CompleteAnalysis, IncompleteAnalysis } from './analysis.types.js';

function expectComplete(prompt: string): CompleteAnalysis {
  const result = analyzeRequirements(prompt);
  if (result.status !== 'COMPLETE') {
    assert.fail(`expected COMPLETE for: ${prompt}, got ${result.status}`);
  }
  return result;
}

function expectIncomplete(prompt: string): IncompleteAnalysis {
  const result = analyzeRequirements(prompt);
  if (result.status !== 'INCOMPLETE') {
    assert.fail(`expected INCOMPLETE for: ${prompt}, got ${result.status}`);
  }
  return result;
}

describe('smart requirement detection (incomplete prompts)', () => {
  it('asks clarifying questions for a bare hospital prompt', () => {
    const result = expectIncomplete('Build a Hospital System');
    assert.equal(result.detection.projectType, 'Hospital');
    assert.ok(result.questions.length >= 3);
    assert.ok(result.questions.some((q) => q.toLowerCase().includes('appointment')));
  });

  it('asks generic questions when the domain is unknown and detail is thin', () => {
    const result = expectIncomplete('please build a system for my business idea');
    assert.equal(result.detection.projectType, null);
    assert.ok(result.questions.length >= 3);
  });

  it('never asks about a facet the prompt already covers', () => {
    const result = expectIncomplete('Build a banking system with OTP two factor login');
    // auth is covered — no auth question should remain.
    assert.ok(!result.questions.some((q) => q.toLowerCase().includes('two-factor')));
  });
});

describe('project type detection and synonyms', () => {
  it('maps "shopping website" to Ecommerce', () => {
    const result = expectComplete('A shopping website with cart and stripe payments');
    assert.equal(result.spec.projectType, 'Ecommerce');
    assert.ok(result.spec.integrations.includes('Payment Gateway'));
    assert.ok(!result.spec.missingRequirements.includes('Payment Gateway'));
  });

  it('prefers School over ERP for "school erp"', () => {
    const result = analyzeRequirements('Build a school ERP with attendance and fees');
    assert.equal(result.detection.projectType, 'School');
  });

  it('classifies a restaurant POS', () => {
    const result = expectComplete(
      'Restaurant POS with menu management, table billing and a kitchen display',
    );
    assert.equal(result.spec.projectType, 'Restaurant');
    assert.ok(result.spec.modules.includes('Menu'));
    assert.ok(!result.spec.missingRequirements.includes('Kitchen Order Display'));
  });

  it('falls back to Custom for rich prompts in unknown domains', () => {
    const result = expectComplete(
      'An app for tracking gym workouts with user login, progress charts and payment subscriptions',
    );
    assert.equal(result.spec.projectType, 'Custom');
    assert.ok(result.spec.integrations.includes('Payment Gateway'));
  });
});

describe('specification building', () => {
  it('produces the full spec for a detailed ecommerce prompt', () => {
    const result = expectComplete(
      'Build an E-Commerce Website with JWT authentication, Admin Dashboard, Product Management and Order Tracking',
    );
    const { spec } = result;
    assert.equal(spec.projectType, 'Ecommerce');
    assert.ok(spec.roles.includes('Admin') && spec.roles.includes('Customer'));
    assert.ok(spec.modules.includes('Products') && spec.modules.includes('Orders'));
    assert.ok(spec.authentication.includes('JWT'));
    assert.ok(spec.authentication.includes('RBAC'));
    assert.ok(spec.backend.includes('Product API'));
    assert.ok(spec.database.includes('Orders'));
    // Payments never mentioned — the analyzer should flag the gap.
    assert.ok(spec.missingRequirements.includes('Payment Gateway'));
  });

  it('unions explicit roles with domain defaults', () => {
    const result = expectComplete(
      'An online store with vendors, customer reviews and email notifications',
    );
    assert.ok(result.spec.roles.includes('Vendor'));
    assert.ok(result.spec.roles.includes('Customer'));
  });

  it('honors an explicit project name', () => {
    const result = expectComplete(
      'Build an lms called SkillForge with paid video courses and certificates',
    );
    assert.equal(result.spec.projectName, 'SkillForge');
    assert.equal(result.spec.projectType, 'LMS');
  });

  it('detects integrations for a chat application', () => {
    const result = expectComplete('Build a chat app with socket.io, group chats and file sharing');
    assert.equal(result.spec.projectType, 'Chat');
    assert.ok(result.spec.integrations.includes('Real-time (Socket.io)'));
    assert.ok(result.spec.integrations.includes('File Upload'));
  });

  it('covers domain expectations mentioned in the prompt', () => {
    const result = expectComplete(
      'School management system with attendance tracking and parent sms alerts',
    );
    assert.equal(result.spec.projectType, 'School');
    assert.ok(result.spec.modules.includes('Attendance'));
    assert.ok(!result.spec.missingRequirements.includes('Parent Notifications'));
  });

  it('treats simple domains as complete without extra detail', () => {
    const result = expectComplete('Portfolio Website for a freelance designer');
    assert.equal(result.spec.projectType, 'Portfolio');
    assert.ok(result.spec.frontend.includes('Landing Page'));
  });

  it('produces bank-grade defaults for detailed banking prompts', () => {
    const result = expectComplete(
      'Banking system with accounts, transfers, otp login and transaction sms alerts',
    );
    assert.equal(result.spec.projectType, 'Banking');
    assert.ok(result.spec.authentication.includes('OTP'));
    assert.ok(!result.spec.missingRequirements.includes('Two-Factor Authentication'));
    assert.ok(result.spec.missingRequirements.includes('Audit Logging'));
  });

  it('covers hotel and inventory and CRM and HRMS domains', () => {
    const hotel = expectComplete(
      'Hotel room booking website with online payments and email confirmations',
    );
    assert.equal(hotel.spec.projectType, 'Hotel');

    const inventory = expectComplete(
      'Inventory management system with low stock alerts and excel export',
    );
    assert.equal(inventory.spec.projectType, 'Inventory');
    assert.ok(inventory.spec.missingRequirements.includes('Barcode Support'));

    const crm = expectComplete('CRM for the sales team with leads pipeline and email integration');
    assert.equal(crm.spec.projectType, 'CRM');

    const hrms = expectComplete('HRMS with employee attendance, leave approvals and payroll');
    assert.equal(hrms.spec.projectType, 'HRMS');
    assert.ok(hrms.spec.modules.includes('Payroll'));
  });

  it('always returns the fields the Architecture Planner requires', () => {
    const { spec } = expectComplete('Build a blog platform with markdown posts and comments');
    for (const key of [
      'projectName',
      'projectType',
      'roles',
      'modules',
      'frontend',
      'backend',
      'database',
      'authentication',
    ] as const) {
      const value = spec[key];
      assert.ok(
        typeof value === 'string' ? value.length > 0 : value.length > 0,
        `spec.${key} must be non-empty`,
      );
    }
  });
});
