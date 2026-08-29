/**
 * Prompt template versions, for cache invalidation (Step 20).
 *
 * A prompt is part of an AI agent's identity: change what the model is
 * asked and its output can change, so a cached result keyed without the
 * prompt version would be served stale after a prompt edit. This map is
 * the one place that version lives; bump an entry whenever its template
 * changes, and every cache that includes it invalidates on the next run.
 *
 * Keyed by agent id rather than prompt id because that is what the cache
 * key has in hand, and each AI agent owns exactly one template.
 */
import type { AgentId } from '../../../shared/contracts/index.js';

export const PROMPT_VERSIONS: Partial<Record<AgentId, string>> = {
  'requirement-analyst': 'v2',
  'product-architect': 'v2',
  'architecture-agent': 'v2',
  'ux-ui-engineer': 'v1',
  'test-engineer': 'v2',
};
