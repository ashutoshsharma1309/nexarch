/**
 * Runtime Engineer — does the generated project actually build and run?
 *
 * Everything it reports is something that happened: a session the Local
 * Run Engine really started, commands that really exited, ports that
 * really answered. It has no model call and no `requiredContext`, because
 * there is no question in its remit that an exit code does not answer
 * better.
 *
 * On success it leaves the session running and registers it against the
 * run — the integration and test engineers downstream need the live
 * application, and the scheduler stops the session when the run settles.
 * That handoff is the one piece of shared state this agent creates, and
 * it is owned by the run, not by this agent.
 */
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { AgentError } from '../lib/executor.js';
import { runnableFiles } from '../lib/runnable-project.js';
import { validateRuntime } from '../lib/runtime-validation.js';
import { registerValidationSession } from '../lib/validation-session.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { RuntimeResult } from '../../../shared/types/validation.js';

const definition = getAgentDefinition('runtime-engineer');
if (!definition) throw new Error('runtime-engineer is not declared');

/** A runtime fact that failed becomes a finding with its evidence attached. */
function findingsFrom(result: RuntimeResult): AgentFinding[] {
  const findings: AgentFinding[] = [];

  for (const command of result.commands.filter((entry) => entry.status === 'FAIL')) {
    const category = command.command.includes('build')
      ? 'BUILD_FAILURE'
      : command.command.includes('typecheck')
        ? 'TYPECHECK_FAILURE'
        : 'LINT_FAILURE';
    findings.push({
      type: 'RUNTIME',
      severity: category === 'LINT_FAILURE' ? 'MEDIUM' : 'HIGH',
      category,
      title: `${command.command} failed in ${command.area}`,
      description: `The project's own ${command.command} exited ${String(command.exitCode)} in ${command.area}/.`,
      evidence: `${command.command} (${command.area}) → exit ${String(command.exitCode)} in ${String(command.durationMs)}ms\n${command.outputTail.split('\n').slice(-5).join('\n')}`,
      recommendation: 'Read the tail above; the compiler or linter names the file and line.',
      targetNodeId: null,
      targetFile: null,
      confidence: 1,
      status: 'OPEN',
    });
  }

  if (result.startupStatus === 'FAIL') {
    findings.push({
      type: 'RUNTIME',
      severity: 'CRITICAL',
      category: 'STARTUP_FAILURE',
      title: 'The generated application did not start',
      description: 'The Local Run Engine session did not reach the running phase.',
      evidence: result.errors.slice(0, 4).join('\n') || 'no diagnostics captured',
      recommendation: 'The session diagnostics above name the failing step.',
      targetNodeId: null,
      targetFile: null,
      confidence: 1,
      status: 'OPEN',
    });
  }

  for (const signal of result.logSignals) {
    findings.push({
      type: 'RUNTIME',
      severity: /port|module|database|permission/.test(signal.pattern) ? 'HIGH' : 'MEDIUM',
      category: 'RUNTIME_LOG_SIGNAL',
      title: `Runtime logs show: ${signal.pattern}`,
      description: `The pattern "${signal.pattern}" appeared ${String(signal.count)} time(s) in the run logs.`,
      evidence: signal.sample,
      recommendation: 'Read the surrounding log lines in the run session.',
      targetNodeId: null,
      targetFile: null,
      confidence: 1,
      status: 'OPEN',
    });
  }

  return findings;
}

export const runtimeEngineerAgent: Agent<RuntimeResult> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<RuntimeResult>> {
    const startedAt = Date.now();

    const requirements = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    if (!requirements) {
      throw new AgentError('invalid-input', 'The runtime engineer requires the requirement spec');
    }

    const files = runnableFiles(input.inputArtifacts);
    if (files.length === 0) {
      throw new AgentError(
        'invalid-input',
        'The runtime engineer requires generated project files to run',
      );
    }

    const validation = await validateRuntime({
      projectId: input.projectId,
      runId: input.runId,
      projectName: requirements.projectName,
      files,
    });

    // The run owns the live session from here; the scheduler releases it.
    if (validation.result.startupStatus === 'PASS') {
      registerValidationSession(input.runId, validation.sessionId);
    }

    return {
      agentId: 'runtime-engineer',
      status: 'succeeded',
      output: validation.result,
      artifacts: {
        'runtime-report': {
          ...validation.result,
          baseUrls: validation.baseUrls,
        },
      },
      findings: findingsFrom(validation.result),
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: null,
    };
  },
};
