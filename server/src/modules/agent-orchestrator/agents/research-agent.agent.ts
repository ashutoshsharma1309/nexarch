/**
 * Research Agent — a thin caller of the web research engine.
 *
 * The engine is the same one the create path uses, so the mesh cannot end up
 * with a second, weaker idea of what research means. This adapter adds only
 * what the agent contract asks for: the artifact, usage, and a finding when
 * research came back with nothing.
 *
 * Research is an input to design, not a gate on it. An engine failure becomes
 * an `unavailable` artifact that says what went wrong, so the product architect
 * proceeds knowing there is no evidence instead of the run stopping here.
 */
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { logger } from '../../../shared/logger/index.js';
import { researchProduct, RESEARCH_ARTIFACT_VERSION } from '../../web-research/index.js';
import { AgentError } from '../lib/executor.js';
import type { ResearchArtifact } from '../../web-research/index.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
  AgentUsage,
} from '../../../shared/contracts/index.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const definition = getAgentDefinition('research-agent');
if (!definition) throw new Error('research-agent is not declared');

/** URLs the person named. The engine decides which of them are safe to read. */
export function referenceUrlsIn(prompt: string): string[] {
  const found = prompt.match(/https?:\/\/[^\s)\]>"']+/gi) ?? [];
  return [...new Set(found.map((url) => url.replace(/[.,;:!?]+$/, '')))];
}

function unavailableArtifact(spec: RequirementSpec, detail: string): ResearchArtifact {
  return {
    version: RESEARCH_ARTIFACT_VERSION,
    generatedAt: new Date().toISOString(),
    objective: spec.goal ?? `Research for ${spec.projectName}`,
    domainLabel: spec.projectType,
    depth: 'standard',
    status: 'unavailable',
    limitations: [detail],
    questions: [],
    queries: [],
    sources: [],
    findings: [],
    commonPatterns: [],
    visualDirection: [],
    featureRecommendations: [],
    uxPatterns: [],
    interactions: [],
    assetRequirements: [],
    implementationRecommendations: [],
    decisions: [],
    referenceAnalyses: [],
    usage: {
      searches: 0,
      extractions: 0,
      extractionRequests: 0,
      searchCacheHits: 0,
      extractionCacheHits: 0,
      byProvider: { brave: { searches: 0 }, tavily: { searches: 0, extractions: 0 } },
      modelCalls: [],
      durationMs: 0,
      notes: [],
    },
  };
}

/**
 * What the research really spent on models.
 *
 * Cache hits cost nothing this run, and a call whose provider reported no
 * figures adds nothing, so a run with no measured tokens has null usage.
 */
function usageOf(artifact: ResearchArtifact): AgentUsage | null {
  const spent = artifact.usage.modelCalls.filter(
    (call) => !call.cacheHit && (call.inputTokens !== null || call.outputTokens !== null),
  );
  const last = spent.at(-1);
  if (!last) return null;
  return {
    provider: last.provider,
    model: last.model,
    inputTokens: spent.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
    outputTokens: spent.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
    costUsd: Number(spent.reduce((sum, call) => sum + (call.costUsd ?? 0), 0).toFixed(6)),
    ...(spent.some((call) => call.costUsd === null)
      ? { unpricedCalls: spent.filter((call) => call.costUsd === null).length }
      : {}),
    contextTokens: 0,
  };
}

export const researchAgent: Agent<ResearchArtifact> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<ResearchArtifact>> {
    const startedAt = Date.now();

    const spec = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    if (!spec) {
      throw new AgentError('invalid-input', 'The research agent requires a requirement spec');
    }

    let artifact: ResearchArtifact;
    try {
      artifact = await researchProduct({
        prompt: input.prompt,
        spec,
        referenceUrls: referenceUrlsIn(input.prompt),
      });
    } catch (error) {
      logger.warn('research engine failed; continuing without evidence', { error });
      artifact = {
        ...unavailableArtifact(spec, 'The research engine stopped before producing results.'),
        engineFailed: true,
      };
      // Searches and model calls may have been spent; the zeros are unknowns.
      artifact.usage.notes.push(
        'The engine stopped before reporting usage, so these figures are not a measurement.',
      );
    }

    const findings: AgentFinding[] = [];
    if (artifact.status === 'unavailable') {
      findings.push({
        severity: artifact.engineFailed ? 'MEDIUM' : 'LOW',
        category: 'RESEARCH',
        title: artifact.engineFailed
          ? 'The research engine failed'
          : 'Web research produced no evidence',
        description: artifact.limitations.join(' ') || 'Research did not run.',
        targetNodeId: null,
        status: 'OPEN',
      });
    }

    return {
      agentId: 'research-agent',
      status: 'succeeded',
      output: artifact,
      artifacts: { 'research-artifact': artifact },
      findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: usageOf(artifact),
    };
  },
};
