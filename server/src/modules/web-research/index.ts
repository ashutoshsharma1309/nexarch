/**
 * Web Research engine: real evidence about a product's domain, gathered before
 * design starts. A library with no routes, so it is not an `AppModule`.
 */
export { formatEvidenceBrief, researchProduct } from './web-research.service.js';
export type { EvidenceBriefOptions, ResearchDeps, ResearchInput } from './web-research.service.js';
export { isSafeResearchUrl } from './lib/url-safety.js';
export { RESEARCH_ARTIFACT_VERSION } from './web-research.types.js';
export type {
  ReferenceAnalysis,
  ReferenceMeasurements,
  ResearchArtifact,
  ResearchConfidence,
  ResearchDecision,
  ResearchDepth,
  ResearchFinding,
  ResearchModelCall,
  ResearchProviderId,
  ResearchSource,
  ResearchStatus,
  ResearchUsage,
  RetrievalKind,
} from './web-research.types.js';
