/**
 * Evidence a reader can act on.
 *
 * Both of these rows had the evidence on the wire already and threw it away:
 * a test case showed "PASSED" without saying what it ran against, and a
 * repair showed what it changed without saying which finding asked for it.
 * The tests cover the three shapes the data really comes in — complete,
 * partial, and absent — because the absent case is the one where a UI is
 * most tempted to imply something it does not know.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { RepairRecordView, ValidationTestCase } from '@/shared/types/api';
import { TestRow } from './validation-section';
import { RepairRow } from './repair-section';

function testCase(overrides: Partial<ValidationTestCase> = {}): ValidationTestCase {
  return {
    id: 'case-1',
    name: 'Create a product',
    type: 'API',
    priority: 'CRITICAL',
    target: 'products',
    steps: [{ action: 'POST /api/v1/products', expect: '201' }],
    expectedResult: 'the product is created',
    status: 'PASSED',
    duration: 42,
    error: null,
    evidence: 'POST /api/v1/products → 201',
    ...overrides,
  };
}

function repair(overrides: Partial<RepairRecordView> = {}): RepairRecordView {
  return {
    id: 'repair-1',
    findingId: 'f-9f2c11',
    findingTitle: 'Unused dependency left in package.json',
    severity: 'LOW',
    eligibility: { eligibility: 'ELIGIBLE', reason: 'deterministic strategy available' },
    rootCause: {
      rootCause: 'dependency never imported',
      confidence: 0.9,
      affectedFiles: ['backend/package.json'],
    },
    plan: {
      strategy: 'removeUnusedDependency',
      intent: 'drop the dependency',
      authorizedFiles: ['backend/package.json'],
      validation: ['MANIFEST_AUDIT'],
      rollback: 'restore the previous version',
    },
    attempts: [],
    changeset: null,
    result: 'ACCEPTED',
    rolledBack: false,
    tokens: { input: 0, output: 0 },
    ...overrides,
  } as RepairRecordView;
}

function show(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('validation evidence', () => {
  it('says what a passing case ran against', async () => {
    const user = (await import('@testing-library/user-event')).default;
    show(<TestRow testCase={testCase()} />);
    await user.click(screen.getByRole('button'));

    expect(screen.getByText('products')).toBeInTheDocument();
    expect(screen.getByText(/POST \/api\/v1\/products → 201/)).toBeInTheDocument();
  });

  it('never lets a skipped case read as a pass', async () => {
    const user = (await import('@testing-library/user-event')).default;
    const { container } = show(
      <TestRow testCase={testCase({ status: 'SKIPPED', evidence: null, duration: null })} />,
    );

    const row = container.querySelector('[data-status="SKIPPED"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toMatch(/skipped/);
    expect(row?.textContent).not.toMatch(/passed/);

    await user.click(screen.getByRole('button'));
    expect(screen.getByText(/did not run/)).toBeInTheDocument();
  });

  it('says plainly when a case recorded no target', async () => {
    const user = (await import('@testing-library/user-event')).default;
    show(<TestRow testCase={testCase({ target: '' })} />);
    await user.click(screen.getByRole('button'));

    expect(screen.getByText(/not recorded for this case/)).toBeInTheDocument();
  });
});

describe('repair evidence', () => {
  it('names the finding the repair addressed, and the file it concerns', async () => {
    const user = (await import('@testing-library/user-event')).default;
    show(<RepairRow repair={repair()} />);
    await user.click(screen.getByRole('button'));

    expect(screen.getAllByText(/Unused dependency left in package.json/).length).toBeGreaterThan(0);
    expect(screen.getByText(/f-9f2c11/)).toBeInTheDocument();
    // It appears twice on purpose: once as the file the finding concerns,
    // once as a file the repair plan was authorized to touch.
    expect(screen.getAllByText(/backend\/package.json/).length).toBeGreaterThan(0);
  });

  it('does not invent a file when the root cause identified none', async () => {
    const user = (await import('@testing-library/user-event')).default;
    show(<RepairRow repair={repair({ rootCause: null })} />);
    await user.click(screen.getByRole('button'));

    expect(screen.getByText(/no file was identified for this finding/)).toBeInTheDocument();
  });
});
