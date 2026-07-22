/**
 * Quality Assurance, Testing, Benchmarking & Documentation Engine
 * (Phase 12).
 *
 * Validates every previous phase's output rather than adding a new
 * pipeline stage: generates test scaffolding (unit/API/component/e2e/
 * regression/smoke), computes real quality/performance/security/
 * architecture metrics from the generated files and the Dependency
 * Graph's/Security Engine's own analysis, generates the full 10-document
 * package, combines everything into an engineering score and release
 * readiness tiers, and produces a benchmark report. Never touches
 * generated business logic — every artifact here is new: test files,
 * reports, and documentation. Public surface: this module definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { qualityRouter } from './quality.router.js';

export const qualityModule: AppModule = {
  name: 'quality',
  basePath: '/',
  description:
    'Generates tests, quality/performance/security reports, documentation, and engineering scores',
  router: qualityRouter,
};
