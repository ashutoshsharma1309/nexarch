/**
 * Backend Generation Engine (Phase 5).
 *
 * Consumes the architecture SDS, requirement spec, and the full Phase 4
 * design bundle (database design, Prisma schema, OpenAPI contract,
 * validation rules, entity metadata) and produces a complete, in-memory
 * Express + TypeScript + Prisma backend — feature-first Clean Architecture,
 * every OpenAPI operation implemented as a real or scaffolded handler.
 * Public surface: this module definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { backendGeneratorRouter } from './backend-generator.router.js';

export const backendGeneratorModule: AppModule = {
  name: 'backend-generator',
  basePath: '/backend',
  description: 'Generates a production-ready Express + TypeScript + Prisma backend from the SDS',
  router: backendGeneratorRouter,
};
