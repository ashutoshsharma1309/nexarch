/**
 * The Architecture Planner's types.
 *
 * The Software Design Specification itself is the cross-stage pipeline
 * contract and lives in shared/types/architecture.ts (Phase 4+ consume it).
 * It is re-exported here so this module's public surface is unchanged;
 * only the API envelope below is module-specific.
 */
export type * from '../../shared/types/architecture.js';

import type { ArchitecturePlan } from '../../shared/types/architecture.js';

/** API response: the plan plus its Markdown rendering for export. */
export interface ArchitectureResponse {
  plan: ArchitecturePlan;
  markdown: string;
}
