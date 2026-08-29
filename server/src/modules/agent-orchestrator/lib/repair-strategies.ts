/**
 * How a plan becomes edits — the smallest ones that could work.
 *
 * Deterministic strategies first, always: removing an unused dependency,
 * deleting a broken unused import, aligning a wrong path to the contract's
 * nearest declared one. These produce edits computed from the files, so
 * the "minimal change" of Step 8 is not a hope, it is the construction —
 * a strategy that edits by whole-line find/replace cannot rewrite a file.
 *
 * The model is the fallback for compile errors these rules cannot handle,
 * and even there it does not get the project: it gets the plan, the
 * compiler's error, and the authorized files, and must answer with edits
 * that pass the same authorization and uniqueness gate as everything else.
 * Secrets are scrubbed from anything model-bound (Step 26).
 */
import { generateWithContext } from '../../ai-orchestrator/ai-orchestrator.service.js';
import { logger } from '../../../shared/logger/index.js';
import { nearestDeclaredPath, normalizeApiPath } from './contract-audit.js';
import { auditFrontendContract } from './contract-audit.js';
import { apiContractOf } from './repair-analysis.js';
import { locateFile } from './repair-files.js';
import { scrub } from './runtime-validation.js';
import type { AgentUsage } from '../../../shared/contracts/index.js';
import type { FindingRecord } from './finding-store.js';
import type { FileEdit, RepairPlan, RootCauseAnalysis } from '../../../shared/types/repair.js';

export interface StrategyResult {
  edits: FileEdit[];
  strategy: string;
  usage: AgentUsage | null;
  /** Why no edits could be produced, when they could not. */
  error: string | null;
}

const noEdits = (strategy: string, error: string): StrategyResult => ({
  edits: [],
  strategy,
  usage: null,
  error,
});

/* ── remove-unused-dependency ──────────────────────────────────────────── */

function removeUnusedDependency(finding: FindingRecord, plan: RepairPlan): StrategyResult {
  const name = /"([^"]+)"/.exec(finding.title)?.[1];
  const manifestPath = plan.authorizedFiles[0];
  if (!name || !manifestPath) return noEdits(plan.strategy, 'No package name in the finding.');

  const file = locateFile(finding.projectId, manifestPath);
  if (!file) return noEdits(plan.strategy, `${manifestPath} is not in the artifacts.`);

  // The whole declaration line, with whichever comma placement it has.
  const line = new RegExp(`\\n\\s*"${name}":\\s*"[^"]*",?`).exec(file.content)?.[0];
  if (!line) return noEdits(plan.strategy, `${name} is not declared in ${manifestPath}.`);

  // A line that ended the block leaves the previous line's comma dangling;
  // removing `\n "x": "y"` when it had no trailing comma needs the comma
  // before it removed instead.
  const find = line.endsWith(',') ? line : `,${line}`;
  if (!file.content.includes(find))
    return noEdits(plan.strategy, 'The declaration shape was unexpected.');

  return {
    edits: [{ file: manifestPath, find, replace: '' }],
    strategy: plan.strategy,
    usage: null,
    error: null,
  };
}

/* ── align-frontend-call ───────────────────────────────────────────────── */

function alignFrontendCall(finding: FindingRecord, plan: RepairPlan): StrategyResult {
  const api = apiContractOf(finding.projectId);
  if (!api) return noEdits(plan.strategy, 'No API contract to align against.');

  const edits: FileEdit[] = [];

  for (const path of plan.authorizedFiles) {
    const file = locateFile(finding.projectId, path);
    if (!file) continue;

    const audit = auditFrontendContract([{ path: file.innerPath, content: file.content }], api);

    for (const call of audit.undeclared) {
      const right = nearestDeclaredPath(api, call.method, call.resolved);
      // An unresolvable call is out of this repair's scope by construction —
      // the RCA did not authorize its file unless something in it resolves.
      if (!right) continue;
      // The wrong path's base, as it appears in source: `/product-items`.
      const wrongBase = normalizeApiPath(call.raw).split('/:param')[0] ?? '';
      const rightBase = normalizeApiPath(right).split('/:param')[0] ?? '';
      if (!wrongBase || wrongBase === rightBase) continue;

      // Whole lines containing the wrong base become the edit unit —
      // unique in a generated service file, and reviewable as a diff.
      for (const line of file.content.split('\n')) {
        if (
          !line.includes(`'${wrongBase}'`) &&
          !line.includes(`\`${wrongBase}`) &&
          !line.includes(`"${wrongBase}"`)
        ) {
          continue;
        }
        const replaced = line.replaceAll(wrongBase, rightBase);
        if (!edits.some((edit) => edit.file === path && edit.find === line)) {
          edits.push({ file: path, find: line, replace: replaced });
        }
      }
    }
  }

  if (edits.length === 0) {
    return noEdits(plan.strategy, 'No source line carrying an undeclared path was found.');
  }
  return { edits, strategy: plan.strategy, usage: null, error: null };
}

/* ── fix-compile-error ─────────────────────────────────────────────────── */

/**
 * TS2307 (module not found) has one safe mechanical case: the import's
 * bindings are used nowhere else in the file, so the import line can
 * simply go. Anything beyond that goes to the model.
 */
function removeBrokenImport(finding: FindingRecord, plan: RepairPlan): StrategyResult | null {
  const specifier = /Cannot find module '([^']+)'/.exec(finding.evidence ?? '')?.[1];
  const path = plan.authorizedFiles[0];
  if (!specifier || !path) return null;

  const file = locateFile(finding.projectId, path);
  if (!file) return null;

  const importLine = file.content
    .split('\n')
    .find((line) => /^import\b/.test(line.trim()) && line.includes(`'${specifier}'`));
  if (!importLine) return null;

  // Named bindings must be unused outside the import itself.
  const bindings =
    /\{([^}]*)\}/
      .exec(importLine)?.[1]
      ?.split(',')
      .map(
        (name) =>
          name
            .trim()
            .split(/\s+as\s+/)
            .pop() ?? '',
      ) ?? [];
  const rest = file.content.replace(importLine, '');
  const used = bindings.some((name) => name && new RegExp(`\\b${name}\\b`).test(rest));
  if (used) return null;

  return {
    edits: [{ file: path, find: `${importLine}\n`, replace: '' }],
    strategy: 'remove-broken-import',
    usage: null,
    error: null,
  };
}

/**
 * The model path, for compile errors with no mechanical rule.
 *
 * The prompt gets: the compiler's error, the plan's intent, and the
 * authorized files — scrubbed. It answers with JSON edits. Everything it
 * returns still passes the authorization and exactly-once gate in
 * `applyEdits`; the model is a strategy, not an authority.
 */
async function modelEdit(
  finding: FindingRecord,
  rca: RootCauseAnalysis,
  plan: RepairPlan,
  contextText: string,
): Promise<StrategyResult> {
  const files = plan.authorizedFiles
    .map((path) => ({ path, file: locateFile(finding.projectId, path) }))
    .filter((entry) => entry.file !== null);
  if (files.length === 0) return noEdits('model-edit', 'No authorized file could be read.');

  try {
    const response = await generateWithContext(
      { text: contextText, budget: { maxOutputTokens: 2048 } },
      {
        promptId: 'repair-engineer',
        complexity: 'small-file-regen',
        schema: 'generic-json',
        variables: {
          INTENT: plan.intent,
          ROOT_CAUSE: rca.rootCause,
          EVIDENCE: scrub(finding.evidence ?? ''),
          FILES: files
            .map((entry) => `--- ${entry.path} ---\n${scrub(entry.file?.content ?? '')}`)
            .join('\n\n'),
        },
      },
    );

    const parsed = JSON.parse(response.content) as { edits?: unknown };
    const edits: FileEdit[] = [];
    for (const entry of Array.isArray(parsed.edits) ? parsed.edits.slice(0, 8) : []) {
      const edit = entry as Record<string, unknown>;
      if (
        typeof edit.file === 'string' &&
        typeof edit.find === 'string' &&
        typeof edit.replace === 'string' &&
        edit.find.length > 0
      ) {
        edits.push({ file: edit.file, find: edit.find, replace: edit.replace });
      }
    }

    return {
      edits,
      strategy: 'model-edit',
      usage: {
        provider: response.record.provider,
        model: response.record.model,
        inputTokens: response.record.tokens.inputTokens,
        outputTokens: response.record.tokens.outputTokens,
        costUsd: response.record.cost.totalCostUsd,
        contextTokens: 0,
      },
      error: edits.length === 0 ? 'The model returned no usable edits.' : null,
    };
  } catch (error) {
    logger.warn('model repair unavailable', { findingId: finding.id, error });
    return noEdits('model-edit', 'The model was unavailable or returned unusable output.');
  }
}

/* ── Entry point ───────────────────────────────────────────────────────── */

export async function produceEdits(
  finding: FindingRecord,
  rca: RootCauseAnalysis,
  plan: RepairPlan,
  contextText: string,
): Promise<StrategyResult> {
  switch (plan.strategy) {
    case 'remove-unused-dependency':
      return removeUnusedDependency(finding, plan);
    case 'align-frontend-call':
      return alignFrontendCall(finding, plan);
    case 'fix-compile-error': {
      const mechanical = removeBrokenImport(finding, plan);
      if (mechanical) return mechanical;
      return modelEdit(finding, rca, plan, contextText);
    }
    default:
      return modelEdit(finding, rca, plan, contextText);
  }
}
