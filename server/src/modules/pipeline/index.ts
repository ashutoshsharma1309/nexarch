/**
 * Pipeline module — the one endpoint that turns a prompt into a runnable
 * project. Every other generator module stays exactly as it is and remains
 * independently callable; this module composes them, which is why it
 * imports their services rather than re-implementing anything.
 */
import type { AppModule } from '../../shared/types/module.js';
import { wireRunRecorder } from './lib/run-recorder.js';
import { pipelineRouter } from './pipeline.router.js';

// Subscribes the durable run recorder to the generation engine. Done here,
// at module assembly, so the engine stays independent of persistence and
// its tests need no database.
wireRunRecorder();

export const pipelineModule: AppModule = {
  name: 'pipeline',
  basePath: '/pipeline',
  description: 'End-to-end generation: prompt → analysis → plan → code → hardening → graph',
  router: pipelineRouter,
};
