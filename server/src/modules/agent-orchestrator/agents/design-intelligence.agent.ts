/**
 * Design Intelligence — a thin caller of the create path's design services.
 *
 * `buildDesignIntelligence` turns evidence into a brief, `writeSiteDesign` does
 * the writing and `auditDomainRelevance` checks it against the request. The
 * one retry, with the missing items named, is the same bounded retry the
 * create path makes; the better attempt is kept, not the later one.
 *
 * Research and design briefs derive from web content, so they go to the model
 * as untrusted data, separate from its instructions.
 */
import { SITE_DESIGN_ARTIFACT } from '../../../shared/contracts/agent-registry.js';
import { getAgentDefinition } from '../../../shared/contracts/index.js';
import { writeSiteDesign } from '../../pipeline/lib/ai-stages.js';
import {
  buildDesignIntelligence,
  formatDesignBrief,
} from '../../pipeline/lib/design-intelligence.js';
import { auditDomainRelevance } from '../../pipeline/lib/domain-relevance.js';
import { formatEvidenceBrief } from '../../web-research/index.js';
import { productDecisionFor } from '../lib/agent-selection.js';
import { sumUsage, toAgentUsage } from '../lib/agent-usage.js';
import { AgentError } from '../lib/executor.js';
import type { DesignIntelligence } from '../../pipeline/lib/design-intelligence.js';
import type { RelevanceReport } from '../../pipeline/lib/domain-relevance.js';
import type { SiteDesign } from '../../frontend-generator/lib/site-content.js';
import type { ResearchArtifact } from '../../web-research/index.js';
import type {
  Agent,
  AgentExecutionInput,
  AgentFinding,
  AgentResult,
} from '../../../shared/contracts/index.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const definition = getAgentDefinition('design-intelligence');
if (!definition) throw new Error('design-intelligence is not declared');

export interface SiteDesignArtifact {
  siteDesign: SiteDesign;
  intelligence: DesignIntelligence;
  relevance: RelevanceReport;
  /** True when the page came from the spec because no model produced one. */
  degraded: boolean;
  note: string | null;
}

export const designIntelligenceAgent: Agent<SiteDesignArtifact> = {
  definition,

  async execute(input: AgentExecutionInput): Promise<AgentResult<SiteDesignArtifact>> {
    const startedAt = Date.now();

    const spec = input.inputArtifacts['requirement-spec'] as RequirementSpec | undefined;
    if (!spec) {
      throw new AgentError('invalid-input', 'Design intelligence requires a requirement spec');
    }

    const { prompt } = input;
    const decision = productDecisionFor(prompt);
    const research = input.inputArtifacts['research-artifact'] as ResearchArtifact | undefined;
    const intelligence = buildDesignIntelligence(prompt, research, decision);
    const evidence = [
      ...(research ? [formatEvidenceBrief(research)] : []),
      formatDesignBrief(intelligence),
    ].join('\n\n');
    const stageInput = {
      evidence,
      researchIncluded: research ? research.findings.length + research.decisions.length > 0 : false,
      hasApplication: decision.backend,
    };

    let site = await writeSiteDesign(prompt, spec, [], stageInput);
    let relevance = auditDomainRelevance(prompt, site.value, { modelAvailable: !site.degraded });
    const calls = [toAgentUsage(site.usage)];

    if (relevance.status === 'INCOMPLETE' && !site.degraded) {
      const retry = await writeSiteDesign(prompt, spec, relevance.gaps, stageInput);
      calls.push(toAgentUsage(retry.usage));
      const retried = auditDomainRelevance(prompt, retry.value, {
        modelAvailable: !retry.degraded,
      });
      if (!retry.degraded && retried.passed >= relevance.passed) {
        site = retry;
        relevance = retried;
      }
    }

    if (site.value.sections.length === 0) {
      throw new AgentError('invalid-output', 'The site design contains no sections');
    }

    const findings: AgentFinding[] = [];
    if (site.degraded) {
      findings.push({
        severity: 'MEDIUM',
        category: 'RELIABILITY',
        title: 'The site design fell back to the requirement spec',
        description: site.note ?? 'No model produced a design, so the page was derived instead.',
        targetNodeId: null,
        status: 'OPEN',
      });
    }
    if (relevance.status === 'INCOMPLETE') {
      findings.push({
        severity: 'MEDIUM',
        category: 'DOMAIN_RELEVANCE',
        title: 'The site design leaves out things the request asked for',
        description: relevance.gaps.join(' '),
        targetNodeId: null,
        status: 'OPEN',
      });
    }

    const artifact: SiteDesignArtifact = {
      siteDesign: site.value,
      intelligence,
      relevance,
      degraded: site.degraded,
      note: site.note,
    };

    return {
      agentId: 'design-intelligence',
      status: 'succeeded',
      output: artifact,
      artifacts: { [SITE_DESIGN_ARTIFACT]: artifact },
      findings,
      error: null,
      failureKind: null,
      durationMs: Date.now() - startedAt,
      usage: sumUsage(calls),
    };
  },
};
