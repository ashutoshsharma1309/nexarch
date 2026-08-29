/**
 * May the machine touch this finding at all?
 *
 * Rules, not a model — Step 2 is explicit, and the reason is structural: a
 * model asked "can you fix this?" is being asked to predict its own
 * competence, and models are systematically optimistic about that. These
 * rules encode the boundary a person would draw: mechanical evidence with
 * a mechanical fix is repairable; anything touching product intent,
 * architecture, credentials, or destructive operations goes to a person.
 *
 * The default is REQUIRES_REVIEW. A category nobody classified is a
 * category nobody thought about, and "unclassified" must never silently
 * mean "go ahead".
 */
import type { FindingRecord } from './finding-store.js';
import type { EligibilityDecision } from '../../../shared/types/repair.js';

interface Rule {
  decision: EligibilityDecision['eligibility'];
  reason: string;
}

/** Keyed `TYPE/CATEGORY`. The reason strings surface in the dashboard. */
const RULES: Record<string, Rule> = {
  /* ── Mechanical evidence, mechanical fix ──────────────────────────── */
  'RUNTIME/TYPECHECK_FAILURE': {
    decision: 'AUTO_REPAIRABLE',
    reason: 'The compiler names the file, line and problem; the fix is checkable by re-running it.',
  },
  'RUNTIME/BUILD_FAILURE': {
    decision: 'AUTO_REPAIRABLE',
    reason: 'The build names what broke; success is a zero exit code, not an opinion.',
  },
  'RUNTIME/LINT_FAILURE': {
    decision: 'AUTO_REPAIRABLE',
    reason: 'Lint failures are mechanical and the linter re-verifies the fix.',
  },
  'INTEGRATION/API_CONTRACT': {
    decision: 'AUTO_REPAIRABLE',
    reason: 'The contract is the source of truth; aligning a caller to it is mechanical.',
  },
  'CODE_QUALITY/CONTRACT_MISMATCH': {
    decision: 'AUTO_REPAIRABLE',
    reason: 'Same ground truth as the integration contract check.',
  },
  'DEPENDENCY/UNUSED_DEPENDENCY': {
    decision: 'AUTO_REPAIRABLE',
    reason:
      'Removing an unused declaration installs nothing and is verified by the manifest audit.',
  },
  'DEPENDENCY/DUPLICATE_DEPENDENCY': {
    decision: 'AUTO_REPAIRABLE',
    reason: 'One of two identical declarations can go; the manifest audit re-verifies.',
  },

  /* ── A person decides ─────────────────────────────────────────────── */
  'DEPENDENCY/MISSING_DEPENDENCY': {
    decision: 'REQUIRES_REVIEW',
    reason:
      'Fixing this installs a package. Step 27: a PACKAGE_CHANGE_REQUEST goes to a person; nothing is installed automatically.',
  },
  'SECURITY/AUTHENTICATION': {
    decision: 'REQUIRES_REVIEW',
    reason: 'Implementing authentication is architecture work, not a patch.',
  },
  'SECURITY/AUTHORIZATION': {
    decision: 'REQUIRES_REVIEW',
    reason:
      'Who may do what is a product decision; an automatic guess could lock users out or let attackers in.',
  },
  'SECURITY/SECRETS': {
    decision: 'REQUIRES_REVIEW',
    reason:
      'The committed value must be rotated by a person; deleting the line alone would hide, not fix.',
  },
  'SECURITY/INJECTION': {
    decision: 'REQUIRES_REVIEW',
    reason:
      'Rewriting query construction needs review; a wrong automatic fix breaks data access silently.',
  },
  'INTEGRATION/AUTHENTICATION': {
    decision: 'REQUIRES_REVIEW',
    reason: 'The auth flow failing live means the handlers are unimplemented — architecture work.',
  },
  'INTEGRATION/DATABASE': {
    decision: 'REQUIRES_REVIEW',
    reason: 'Step 28: schema and connection changes can be destructive; a person decides.',
  },
  'CODE_QUALITY/DUPLICATION': {
    decision: 'REQUIRES_REVIEW',
    reason: 'Extracting shared logic is a refactor; a minimal patch cannot do it safely.',
  },
  'CODE_QUALITY/ARCHITECTURE_DRIFT': {
    decision: 'REQUIRES_REVIEW',
    reason: 'A missing planned module is generation-scale work, not a patch.',
  },

  /* ── Nothing to repair ────────────────────────────────────────────── */
  'DEPENDENCY/VULNERABILITY_SCAN': {
    decision: 'NOT_REPAIRABLE',
    reason: 'Informational: it records that a scan did not run, which no code change alters.',
  },
  'SECURITY/TRANSPORT': {
    decision: 'NOT_REPAIRABLE',
    reason: 'TLS termination is deployment infrastructure, out of scope by the phase rules.',
  },
};

export function classifyFinding(finding: FindingRecord): EligibilityDecision {
  // Nothing informational is worth surgery.
  if (finding.severity === 'INFO') {
    return {
      eligibility: 'NOT_REPAIRABLE',
      reason: 'INFO findings are observations, not defects.',
    };
  }

  // Destructive database language anywhere in the evidence is a hard stop.
  const text = `${finding.title} ${finding.description} ${finding.evidence ?? ''}`;
  if (/\bDROP\s+(TABLE|COLUMN|DATABASE)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(text)) {
    return {
      eligibility: 'REQUIRES_REVIEW',
      reason: 'Step 28: the finding involves destructive database operations; a person decides.',
    };
  }

  const rule = RULES[`${finding.type}/${finding.category}`];
  if (rule) return { eligibility: rule.decision, reason: rule.reason };

  // Test failures repair whatever caused them; the cause has its own
  // finding with its own rule. Repairing the symptom would double-patch.
  if (finding.type === 'TEST_FAILURE') {
    return {
      eligibility: 'REQUIRES_REVIEW',
      reason: 'A failed test is a symptom; its cause carries its own finding and its own rule.',
    };
  }

  return {
    eligibility: 'REQUIRES_REVIEW',
    reason: `No rule covers ${finding.type}/${finding.category}; unclassified never means "go ahead".`,
  };
}

/* ── Priority (Step 3) ─────────────────────────────────────────────────── */

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const TYPE_ORDER = [
  'RUNTIME',
  'INTEGRATION',
  'SECURITY',
  'TEST_FAILURE',
  'DEPENDENCY',
  'CODE_QUALITY',
  'UX',
  'GENERAL',
];

/** Broken build before cosmetics: severity first, then failure class. */
export function orderForRepair(findings: readonly FindingRecord[]): FindingRecord[] {
  return [...findings].sort((a, b) => {
    const severity = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (severity !== 0) return severity;
    return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
  });
}
