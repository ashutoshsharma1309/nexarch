/**
 * Frontend Generation Engine (Phase 6).
 *
 * Consumes the architecture SDS, requirement spec, database design, OpenAPI
 * contract, and the Phase 5 backend manifest and produces a complete,
 * in-memory React 19 + Vite + TypeScript application — feature-first,
 * Tailwind design system, TanStack Query + Zustand + React Hook Form/Zod,
 * every entity the backend actually implements getting a full CRUD page.
 * Public surface: this module definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { frontendGeneratorRouter } from './frontend-generator.router.js';

export const frontendGeneratorModule: AppModule = {
  name: 'frontend-generator',
  basePath: '/frontend',
  description:
    'Generates a production-ready React + Vite frontend from the SDS and backend manifest',
  router: frontendGeneratorRouter,
};
