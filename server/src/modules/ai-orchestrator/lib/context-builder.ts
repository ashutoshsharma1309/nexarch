/**
 * Never sends the whole project. Given the artifacts a workflow step
 * actually needs (requirements/architecture/database summaries, the
 * dependency graph, the security report) plus only the files an impact
 * analysis already marked as affected, this assembles the smallest context
 * package that still has everything a model needs — manifests become one
 * reference line each instead of their full JSON, and files are the only
 * thing sent in full, capped to a token budget.
 */
import type { ContextInputs, ContextPackage, ProjectFileRef } from '../ai-orchestrator.types.js';
import { estimateTokens } from './token-estimator.js';

const DEFAULT_MAX_TOKENS = 100_000;

function summarize(inputs: ContextInputs): string {
  const lines: string[] = [];
  const requirements = inputs.requirements as
    { projectName?: string; projectType?: string } | undefined;
  if (requirements?.projectName) {
    lines.push(
      `Project: ${requirements.projectName} (${requirements.projectType ?? 'unknown type'})`,
    );
  }
  const architecture = inputs.architecture as { apiModules?: unknown[] } | undefined;
  if (Array.isArray(architecture?.apiModules)) {
    lines.push(`Architecture: ${architecture.apiModules.length} API module(s) planned.`);
  }
  const database = inputs.databaseDesign as { tables?: unknown[] } | undefined;
  if (Array.isArray(database?.tables)) {
    lines.push(`Database: ${database.tables.length} table(s).`);
  }
  return lines.join('\n');
}

function manifestReferences(inputs: ContextInputs): string[] {
  const refs: string[] = [];
  if (inputs.dependencyGraph)
    refs.push('dependency-graph.json — see affected node/file list below, not attached in full.');
  if (inputs.projectManifest)
    refs.push('project-manifest.json — version history available, not attached in full.');
  if (inputs.securityReport)
    refs.push('security-report.json — findings available, not attached in full.');
  return refs;
}

function dedupeFiles(files: readonly ProjectFileRef[]): ProjectFileRef[] {
  const seen = new Map<string, ProjectFileRef>();
  for (const file of files) {
    if (!seen.has(file.path)) seen.set(file.path, file);
  }
  return [...seen.values()];
}

export function buildContext(
  inputs: ContextInputs,
  maxTokens: number = DEFAULT_MAX_TOKENS,
): ContextPackage {
  const summary = summarize(inputs);
  const refs = manifestReferences(inputs);
  const dedupedFiles = dedupeFiles(inputs.affectedFiles).sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  const fixedTokens = estimateTokens(summary) + refs.reduce((sum, r) => sum + estimateTokens(r), 0);

  const included: ProjectFileRef[] = [];
  const omitted: string[] = [];
  let runningTokens = fixedTokens;

  for (const file of dedupedFiles) {
    const fileTokens = estimateTokens(file.content);
    if (runningTokens + fileTokens > maxTokens) {
      omitted.push(file.path);
      continue;
    }
    included.push(file);
    runningTokens += fileTokens;
  }

  return {
    summary,
    manifestReferences: refs,
    files: included,
    estimatedTokens: runningTokens,
    truncated: omitted.length > 0,
    omittedFiles: omitted,
  };
}
