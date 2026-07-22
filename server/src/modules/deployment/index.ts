/**
 * DevOps, Deployment & CI/CD Automation Engine (Phase 11).
 *
 * Generates the infrastructure layer a generated project needs to actually
 * ship: Docker Compose (dev/prod), `.dockerignore`, GitHub Actions
 * workflows, environment templates with validation rules, health/
 * readiness/liveness/version route code, a hand-rolled Prometheus metrics
 * endpoint, a log-rotation add-on, backup/scalability documentation, and
 * per-target deployment configuration across 12 targets (Docker, Docker
 * Compose, Vercel, Netlify, Render, Railway, AWS EC2/ECS, Google Cloud
 * Run, Azure App Service, DigitalOcean, local). Never re-generates the
 * Dockerfiles Phases 5/6 already emit, never touches generated business
 * logic — every artifact here is new, standalone infrastructure. Public
 * surface: this module definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { deploymentRouter } from './deployment.router.js';

export const deploymentModule: AppModule = {
  name: 'deployment',
  basePath: '/deployment',
  description:
    'Generates Docker, CI/CD, environment, health, monitoring, and deployment infrastructure',
  router: deploymentRouter,
};
