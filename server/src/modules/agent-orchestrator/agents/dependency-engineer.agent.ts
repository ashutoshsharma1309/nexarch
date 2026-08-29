/**
 * Dependency Engineer — what the project declares against what it uses.
 *
 * Entirely deterministic, and that is the right answer rather than a
 * limitation. Every question Step 10 asks — unused, missing, duplicated,
 * drifting, on the wrong side of the stack — is settled by reading a
 * manifest and a set of import statements. A model asked the same question
 * would be guessing at facts already written down.
 *
 * The honest part of this agent is what it refuses to claim. Step 11 says
 * to use a package audit if one is available and not to invent
 * vulnerability data otherwise. `npm audit` needs a lockfile and a
 * reachable advisory database; the generated project ships with neither at
 * review time. So the report carries an explicit
 * `vulnerabilityScan.performed: false` with the reason, and the agent
 * raises an INFO finding saying so — because a security-adjacent report
 * that is silent about known CVEs reads as "none found", and that is a
 * claim this cannot make.
 */
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { AgentError } from '../lib/executor.js';
import { reviewDependencies } from '../lib/dependency-review.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import type { DependencyArea, PackageManifest } from '../lib/dependency-review.js';

const definition = getAgentDefinition('dependency-engineer');
if (!definition) throw new Error('dependency-engineer is not declared');

interface FileArtifact {
  files: { path: string; content: string }[];
}

function filesOf(artifact: unknown): { path: string; content: string }[] {
  return (artifact as FileArtifact | undefined)?.files ?? [];
}

/**
 * Reads a manifest out of an area's config artifact.
 *
 * Returns null rather than throwing on unparseable JSON: one malformed
 * manifest should cost the review that area, not the whole agent.
 */
function manifestOf(files: readonly { path: string; content: string }[]): PackageManifest | null {
  const manifest = files.find((file) => file.path === 'package.json');
  if (!manifest) return null;
  try {
    return JSON.parse(manifest.content) as PackageManifest;
  } catch {
    return null;
  }
}

export const dependencyEngineerAgent: Agent<ReturnType<typeof reviewDependencies>> = {
  definition,

  async execute(
    input: AgentExecutionInput,
  ): Promise<AgentResult<ReturnType<typeof reviewDependencies>>> {
    const startedAt = Date.now();
    await Promise.resolve();

    const areas: DependencyArea[] = [];
    const findings: AgentFinding[] = [];

    for (const area of ['backend', 'frontend'] as const) {
      const config = filesOf(input.inputArtifacts[`${area}-config`]);
      const source = filesOf(input.inputArtifacts[`${area}-source`]);
      const manifest = manifestOf(config);

      if (!manifest) {
        findings.push({
          type: 'DEPENDENCY',
          severity: 'HIGH',
          category: 'MISSING_MANIFEST',
          title: `No readable package.json for ${area}`,
          description: `The ${area} config artifact contains no parseable package.json, so its dependencies could not be reviewed.`,
          evidence: `${area}-config — ${String(config.length)} file(s), no valid package.json`,
          recommendation: 'Regenerate the project; a manifest is required to install or run it.',
          targetNodeId: null,
          targetFile: `${area}/package.json`,
          confidence: 1,
          status: 'OPEN',
        });
        continue;
      }

      areas.push({
        area,
        manifest,
        files: [...config, ...source],
        hasLockfile: config.some((file) =>
          /package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$/.test(file.path),
        ),
      });
    }

    if (areas.length === 0) {
      throw new AgentError(
        'invalid-input',
        'The dependency engineer requires at least one readable package manifest',
      );
    }

    const review = reviewDependencies(areas);
    // The review carries its own vulnerability-scan disclosure at INFO.
    findings.push(...review.findings);

    return {
      agentId: 'dependency-engineer',
      status: 'succeeded',
      output: review,
      artifacts: { 'dependency-report': review },
      findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: null,
    };
  },
};
