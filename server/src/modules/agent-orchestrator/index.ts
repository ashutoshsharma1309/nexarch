/**
 * Agent Orchestrator — the runtime the pipeline is migrating onto.
 *
 * It coordinates; agents do specialized work; the Context Engine decides
 * what each is told; the Engineering Graph stores what comes out. The
 * existing pipeline is untouched and still the default path — this runs
 * alongside it, so the migration can proceed one agent at a time instead
 * of as a rewrite.
 *
 * Four meshes are registered here. The planning mesh decides what to
 * build; the generation mesh builds it; the review mesh reads what was
 * built; the validation mesh runs it and reports what actually happened.
 *
 * Agent implementations register here, at module assembly. Nothing else in
 * the codebase instantiates an agent.
 */
import type { AppModule } from '../../shared/types/module.js';
import { agentOrchestratorRouter } from './agent-orchestrator.router.js';
import { apiArchitectAgent } from './agents/api-architect.agent.js';
import { architectureAgent } from './agents/architecture-agent.agent.js';
import { backendEngineerAgent } from './agents/backend-engineer.agent.js';
import { codeQualityEngineerAgent } from './agents/code-quality-engineer.agent.js';
import { dependencyEngineerAgent } from './agents/dependency-engineer.agent.js';
import { databaseArchitectAgent } from './agents/database-architect.agent.js';
import { frontendEngineerAgent } from './agents/frontend-engineer.agent.js';
import { productArchitectAgent } from './agents/product-architect.agent.js';
import { repairEngineerAgent } from './agents/repair-engineer.agent.js';
import { requirementAnalystAgent } from './agents/requirement-analyst.agent.js';
import { integrationEngineerAgent } from './agents/integration-engineer.agent.js';
import { runtimeEngineerAgent } from './agents/runtime-engineer.agent.js';
import { securityEngineerAgent } from './agents/security-engineer.agent.js';
import { testEngineerAgent } from './agents/test-engineer.agent.js';
import { uxUiEngineerAgent } from './agents/ux-ui-engineer.agent.js';
import { registerAgent } from './lib/registry.js';

// In dependency order. Registration order is irrelevant — the DAG comes
// from the declarations — but reading it in execution order makes the mesh
// obvious at a glance.
registerAgent(requirementAnalystAgent);
registerAgent(productArchitectAgent);
registerAgent(architectureAgent);
registerAgent(databaseArchitectAgent);
registerAgent(apiArchitectAgent);

registerAgent(backendEngineerAgent);
registerAgent(frontendEngineerAgent);
registerAgent(uxUiEngineerAgent);

// The review mesh. One wave, no order between them — see the note on
// `mutates: []` in the registry.
registerAgent(securityEngineerAgent);
registerAgent(dependencyEngineerAgent);
registerAgent(codeQualityEngineerAgent);

// The validation mesh: a strict chain, because nothing about behaviour is
// worth testing before the project is known to run.
registerAgent(runtimeEngineerAgent);
registerAgent(integrationEngineerAgent);
registerAgent(testEngineerAgent);

// The repair engineer never joins a generation run's DAG (enabled: false);
// it is registered so the repair engine can attribute and invoke it.
registerAgent(repairEngineerAgent);

export {
  startRun,
  getRun,
  cancelRun,
  resumeRun,
  listAgents,
} from './agent-orchestrator.service.js';

export const agentOrchestratorModule: AppModule = {
  name: 'agent-orchestrator',
  basePath: '/projects',
  description:
    'Dependency-aware agent runtime: planning, generation, review, findings, retries, resume',
  router: agentOrchestratorRouter,
};
