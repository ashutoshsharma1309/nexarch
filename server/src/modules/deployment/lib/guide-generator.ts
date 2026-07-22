/**
 * Assembles the top-level `deployment-guide.md` — the one document that
 * ties Docker, environment, CI/CD, health, monitoring, logging, backup,
 * and scalability together for a specific target.
 */
import type {
  CiCdBundle,
  DeploymentArtifacts,
  DeploymentTarget,
  DockerBundle,
  EnvironmentBundle,
} from '../deployment.types.js';

const TARGET_LABEL: Record<DeploymentTarget, string> = {
  docker: 'Docker',
  'docker-compose': 'Docker Compose',
  vercel: 'Vercel',
  netlify: 'Netlify',
  render: 'Render',
  railway: 'Railway',
  'aws-ec2': 'AWS EC2',
  'aws-ecs': 'AWS ECS',
  'gcp-cloud-run': 'Google Cloud Run',
  'azure-app-service': 'Azure App Service',
  digitalocean: 'DigitalOcean',
  local: 'Local',
};

const TARGET_STEPS: Record<DeploymentTarget, string[]> = {
  docker: [
    'Build both images: `docker build -t backend ./backend` and `docker build -t frontend ./frontend`.',
    'Push to your registry of choice and run them on any Docker host.',
  ],
  'docker-compose': [
    'Copy `.env.example` to `.env` and fill in real values.',
    'Run `docker compose up --build` for development, or `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` for production.',
  ],
  vercel: [
    'Import the repository in Vercel; `vercel.json` sets the build command and output directory for the frontend.',
    'The backend is not a serverless-function shape by default — deploy it separately (Railway/Render/ECS) and set `VITE_API_BASE_URL`.',
  ],
  netlify: [
    'Connect the repository; `netlify.toml` points the build at `frontend/`.',
    'Deploy the backend separately and set `VITE_API_BASE_URL` in Netlify site settings.',
  ],
  render: [
    'Connect the repository; `render.yaml` defines both services as Blueprint-managed Docker web services.',
    'Set `DATABASE_URL` and `JWT_SECRET` as secret environment variables in the Render dashboard.',
  ],
  railway: [
    'Connect the repository; `railway.json` points the builder at `backend/Dockerfile`.',
    'Add a Railway-managed database plugin or set `DATABASE_URL` to an external one.',
  ],
  'aws-ec2': [
    'Launch an instance with `deploy/aws-ec2/user-data.sh` as the launch-template user data.',
    'Install `deploy/aws-ec2/app.service` as a systemd unit so the stack restarts on reboot.',
  ],
  'aws-ecs': [
    'Push both images to ECR.',
    'Register `deploy/aws-ecs/task-definition.json` (fill in account/region placeholders) and run it as an ECS Fargate service behind an ALB.',
  ],
  'gcp-cloud-run': [
    'Push the backend image to Artifact Registry / GCR.',
    'Deploy `deploy/gcp-cloud-run/service.yaml` with `gcloud run services replace`.',
  ],
  'azure-app-service': [
    'Create an App Service (Linux, container).',
    'Run the `deploy/azure-app-service/azure-pipelines.yml` pipeline, or push the image manually and point the App Service at it.',
  ],
  digitalocean: [
    'Create an App Platform app from `.do/app.yaml` (`doctl apps create --spec .do/app.yaml`).',
    'Set `DATABASE_URL` and `JWT_SECRET` as encrypted app-level secrets.',
  ],
  local: ['See `deploy/local/README.md` — `docker compose up --build` is the whole story.'],
};

export function generateDeploymentGuide(
  target: DeploymentTarget,
  artifacts: DeploymentArtifacts,
  docker: DockerBundle,
  environment: EnvironmentBundle,
  cicd: CiCdBundle,
): string {
  const lines: string[] = [
    `# Deployment Guide — ${artifacts.projectName}`,
    '',
    `**Target:** ${TARGET_LABEL[target]}`,
    '',
    '## Steps',
    '',
    ...TARGET_STEPS[target].map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Files generated for this deployment',
    '',
    `- \`${docker.dockerignoreBackend.path}\`, \`${docker.dockerignoreFrontend.path}\``,
    `- \`${docker.composeDev.path}\`, \`${docker.composeProd.path}\``,
    `- \`${environment.envExample.path}\`, \`${environment.envDevelopment.path}\`, \`${environment.envProduction.path}\`, \`${environment.docs.path}\``,
    `- \`${cicd.buildWorkflow.path}\`, \`${cicd.deployWorkflow.path}\``,
    '- `backend/src/shared/health/health.routes.ts` — mount before auth middleware',
    '- `backend/src/shared/monitoring/metrics.ts` — mount `metricsMiddleware` app-wide, `metricsHandler` at `GET /metrics`',
    '- `BACKUP.md`, `SCALABILITY.md`, `LOGGING.md`',
    '',
    '## Environment variables',
    '',
    `See \`${environment.docs.path}\` for the full table. At minimum: \`DATABASE_URL\`, \`JWT_SECRET\`, \`CORS_ORIGINS\`.`,
    '',
    '## CI/CD',
    '',
    `\`${cicd.buildWorkflow.path}\` runs lint/build/test/security-scan/docker-build on every push and pull request. \`${cicd.deployWorkflow.path}\` runs on version tags (\`v*.*.*\`): it builds, tests, packages artifacts, creates a GitHub Release, and deploys to ${TARGET_LABEL[target]}.`,
    '',
    '## Health checks',
    '',
    '`GET /health` (full report), `GET /health/live` (liveness), `GET /health/ready` (readiness), `GET /version` (build metadata).',
    '',
    '## Before you go to production',
    '',
    "- [ ] Replace every placeholder secret in `.env.production` with real values, stored in your target's secret manager.",
    '- [ ] Confirm `DATABASE_URL` points at a managed, backed-up database — see `BACKUP.md`.',
    '- [ ] Wire up the health-check and metrics endpoints above.',
    '- [ ] Read `SCALABILITY.md` before your first traffic spike, not during it.',
    '',
  ];

  return lines.join('\n');
}
