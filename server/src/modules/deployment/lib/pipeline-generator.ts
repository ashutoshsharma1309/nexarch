/**
 * GitHub Actions workflows. `build.yml` runs on every push/PR (lint, build,
 * test, `npm audit` as the security scan, Docker build validation);
 * `deploy.yml` runs on tags (version tag already implied by the trigger,
 * GitHub Release creation, artifact upload, and a target-specific deploy
 * step).
 */
import type { CiCdBundle, DeploymentArtifacts, DeploymentTarget } from '../deployment.types.js';

function buildWorkflow(): string {
  return `name: Build

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm audit --audit-level=high

  docker-build:
    runs-on: ubuntu-latest
    needs: [lint-and-test]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build backend image
        uses: docker/build-push-action@v5
        with:
          context: ./backend
          push: false
          tags: backend:ci
      - name: Build frontend image
        uses: docker/build-push-action@v5
        with:
          context: ./frontend
          push: false
          tags: frontend:ci
`;
}

const DEPLOY_STEP_BY_TARGET: Record<DeploymentTarget, string> = {
  docker: `      - name: Push images
        run: |
          echo "Log in to your registry and push backend:\${{ github.ref_name }} / frontend:\${{ github.ref_name }}"`,
  'docker-compose': `      - name: Deploy over SSH
        run: |
          echo "ssh into the host and run: docker compose -f docker-compose.yml -f docker-compose.prod.yml pull && up -d"`,
  vercel: `      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: \${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: \${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: \${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'`,
  netlify: `      - name: Deploy to Netlify
        uses: nwtgck/actions-netlify@v3
        with:
          publish-dir: frontend/dist
          production-deploy: true
        env:
          NETLIFY_AUTH_TOKEN: \${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: \${{ secrets.NETLIFY_SITE_ID }}`,
  render: `      - name: Trigger Render deploy hook
        run: curl -fsS "\${{ secrets.RENDER_DEPLOY_HOOK_URL }}"`,
  railway: `      - name: Deploy to Railway
        run: npx @railway/cli up --service backend
        env:
          RAILWAY_TOKEN: \${{ secrets.RAILWAY_TOKEN }}`,
  'aws-ec2': `      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1
        with:
          host: \${{ secrets.EC2_HOST }}
          username: \${{ secrets.EC2_USER }}
          key: \${{ secrets.EC2_SSH_KEY }}
          script: cd /opt/app && git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`,
  'aws-ecs': `      - name: Deploy to Amazon ECS
        run: |
          aws ecs update-service --cluster \${{ secrets.ECS_CLUSTER }} --service \${{ secrets.ECS_SERVICE }} --force-new-deployment
        env:
          AWS_ACCESS_KEY_ID: \${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: \${{ secrets.AWS_REGION }}`,
  'gcp-cloud-run': `      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: backend
          image: gcr.io/\${{ secrets.GCP_PROJECT_ID }}/backend:\${{ github.ref_name }}`,
  'azure-app-service': `      - name: Deploy to Azure App Service
        uses: azure/webapps-deploy@v3
        with:
          app-name: \${{ secrets.AZURE_APP_NAME }}
          publish-profile: \${{ secrets.AZURE_PUBLISH_PROFILE }}`,
  digitalocean: `      - name: Deploy to DigitalOcean App Platform
        run: doctl apps create-deployment \${{ secrets.DO_APP_ID }}
        env:
          DIGITALOCEAN_ACCESS_TOKEN: \${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}`,
  local: `      - name: No remote deploy target
        run: echo "Target is 'local' — build the artifact and run it yourself, e.g. docker compose up --build"`,
};

function deployWorkflow(target: DeploymentTarget, artifacts: DeploymentArtifacts): string {
  const deployStep = DEPLOY_STEP_BY_TARGET[target];
  return `name: Deploy

# Runs on version tags, e.g. "v1.2.0" — the tag itself is the version.
on:
  push:
    tags: ['v*.*.*']

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test

      - name: Package build artifacts
        run: |
          mkdir -p dist-artifacts
          tar -czf dist-artifacts/${artifacts.projectName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')}-\${{ github.ref_name }}.tar.gz backend/dist frontend/dist

      - name: Upload build artifact
        uses: actions/upload-artifact@v4
        with:
          name: build-\${{ github.ref_name }}
          path: dist-artifacts/*

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: dist-artifacts/*
          generate_release_notes: true

  deploy:
    runs-on: ubuntu-latest
    needs: [release]
    steps:
      - uses: actions/checkout@v4
${deployStep}
`;
}

export function generateCiCdBundle(
  target: DeploymentTarget,
  artifacts: DeploymentArtifacts,
): CiCdBundle {
  return {
    buildWorkflow: {
      path: '.github/workflows/build.yml',
      language: 'yaml',
      content: buildWorkflow(),
    },
    deployWorkflow: {
      path: '.github/workflows/deploy.yml',
      language: 'yaml',
      content: deployWorkflow(target, artifacts),
    },
  };
}
