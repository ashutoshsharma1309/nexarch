/**
 * Database Designer & API Contract Generator (Phase 4).
 *
 * Consumes the architecture SDS + requirement spec and produces the design
 * artifacts every later stage treats as the source of truth. It exposes two
 * mount points — `/database` and `/openapi` — backed by one service, so the
 * database design and its OpenAPI contract are always generated together and
 * stay in lockstep.
 */
import type { AppModule } from '../../shared/types/module.js';
import { databaseRouter } from './database.router.js';
import { openapiRouter } from './openapi.router.js';

export const databaseModule: AppModule = {
  name: 'database-designer',
  basePath: '/database',
  description: 'Relational database design, schemas, ER diagram and validation from the SDS',
  router: databaseRouter,
};

export const openapiModule: AppModule = {
  name: 'openapi-generator',
  basePath: '/openapi',
  description: 'OpenAPI 3.1 API contract generated from the SDS and database design',
  router: openapiRouter,
};
