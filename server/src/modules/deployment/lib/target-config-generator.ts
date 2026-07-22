/**
 * Per-target deployment configuration. Every target reads the same
 * `backend/Dockerfile` + `frontend/Dockerfile` Phases 5/6 already emit —
 * this just adds the one config file (or two) each platform needs to build
 * and run them.
 */
import type {
  DeploymentArtifacts,
  DeploymentFile,
  DeploymentTarget,
  TargetConfig,
} from '../deployment.types.js';

function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app'
  );
}

function vercelConfig(): DeploymentFile {
  return {
    path: 'vercel.json',
    language: 'json',
    content:
      JSON.stringify(
        {
          buildCommand: 'cd frontend && npm install && npm run build',
          outputDirectory: 'frontend/dist',
          rewrites: [{ source: '/(.*)', destination: '/index.html' }],
        },
        null,
        2,
      ) + '\n',
  };
}

function netlifyConfig(): DeploymentFile {
  return {
    path: 'netlify.toml',
    language: 'yaml',
    content: `[build]
  base = "frontend"
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`,
  };
}

function renderConfig(name: string): DeploymentFile {
  return {
    path: 'render.yaml',
    language: 'yaml',
    content: `services:
  - type: web
    name: ${name}-backend
    runtime: docker
    dockerfilePath: ./backend/Dockerfile
    dockerContext: ./backend
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        sync: false
      - key: JWT_SECRET
        sync: false

  - type: web
    name: ${name}-frontend
    runtime: docker
    dockerfilePath: ./frontend/Dockerfile
    dockerContext: ./frontend
`,
  };
}

function railwayConfig(): DeploymentFile {
  return {
    path: 'railway.json',
    language: 'json',
    content:
      JSON.stringify(
        {
          $schema: 'https://railway.app/railway.schema.json',
          build: { builder: 'DOCKERFILE', dockerfilePath: 'backend/Dockerfile' },
          deploy: {
            healthcheckPath: '/health',
            healthcheckTimeout: 30,
            restartPolicyType: 'ON_FAILURE',
            restartPolicyMaxRetries: 3,
          },
        },
        null,
        2,
      ) + '\n',
  };
}

function ec2Files(): DeploymentFile[] {
  return [
    {
      path: 'deploy/aws-ec2/user-data.sh',
      language: 'shellscript',
      content: `#!/bin/bash
# EC2 launch-template user-data — installs Docker and starts the stack.
set -euo pipefail
yum update -y || apt-get update -y
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
mkdir -p /opt/app
cd /opt/app
# git clone <your-repo> . (or pull a pre-built image from a registry)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
`,
    },
    {
      path: 'deploy/aws-ec2/app.service',
      language: 'yaml',
      content: `[Unit]
Description=Application stack (Docker Compose)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=true
WorkingDirectory=/opt/app
ExecStart=/usr/local/bin/docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.yml -f docker-compose.prod.yml down

[Install]
WantedBy=multi-user.target
`,
    },
  ];
}

function ecsTaskDefinition(name: string): DeploymentFile {
  return {
    path: 'deploy/aws-ecs/task-definition.json',
    language: 'json',
    content:
      JSON.stringify(
        {
          family: `${name}-backend`,
          networkMode: 'awsvpc',
          requiresCompatibilities: ['FARGATE'],
          cpu: '512',
          memory: '1024',
          containerDefinitions: [
            {
              name: 'backend',
              image: '<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/' + name + '-backend:latest',
              portMappings: [{ containerPort: 4000, protocol: 'tcp' }],
              healthCheck: {
                command: ['CMD-SHELL', 'wget -qO- http://localhost:4000/health || exit 1'],
                interval: 30,
                timeout: 5,
                retries: 3,
              },
              environment: [{ name: 'NODE_ENV', value: 'production' }],
              secrets: [
                {
                  name: 'DATABASE_URL',
                  valueFrom: 'arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:database-url',
                },
                {
                  name: 'JWT_SECRET',
                  valueFrom: 'arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:jwt-secret',
                },
              ],
              logConfiguration: {
                logDriver: 'awslogs',
                options: {
                  'awslogs-group': `/ecs/${name}-backend`,
                  'awslogs-region': '<REGION>',
                  'awslogs-stream-prefix': 'ecs',
                },
              },
            },
          ],
        },
        null,
        2,
      ) + '\n',
  };
}

function cloudRunService(name: string): DeploymentFile {
  return {
    path: 'deploy/gcp-cloud-run/service.yaml',
    language: 'yaml',
    content: `apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: ${name}-backend
spec:
  template:
    spec:
      containers:
        - image: gcr.io/PROJECT_ID/${name}-backend:latest
          ports:
            - containerPort: 4000
          env:
            - name: NODE_ENV
              value: production
          resources:
            limits:
              cpu: '1'
              memory: 512Mi
          startupProbe:
            httpGet:
              path: /health/live
              port: 4000
          livenessProbe:
            httpGet:
              path: /health/live
              port: 4000
`,
  };
}

function azureConfig(name: string): DeploymentFile {
  return {
    path: 'deploy/azure-app-service/azure-pipelines.yml',
    language: 'yaml',
    content: `trigger:
  tags:
    include: ['v*']

pool:
  vmImage: ubuntu-latest

steps:
  - task: Docker@2
    inputs:
      containerRegistry: '<service-connection>'
      repository: '${name}-backend'
      command: buildAndPush
      Dockerfile: backend/Dockerfile
  - task: AzureWebAppContainer@1
    inputs:
      azureSubscription: '<service-connection>'
      appName: '${name}-backend'
      containers: '<registry>/${name}-backend:$(Build.BuildId)'
`,
  };
}

function digitalOceanConfig(name: string): DeploymentFile {
  return {
    path: '.do/app.yaml',
    language: 'yaml',
    content: `name: ${name}
services:
  - name: backend
    dockerfile_path: backend/Dockerfile
    source_dir: backend
    http_port: 4000
    health_check:
      http_path: /health
    envs:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        type: SECRET
      - key: JWT_SECRET
        type: SECRET

  - name: frontend
    dockerfile_path: frontend/Dockerfile
    source_dir: frontend
    http_port: 80
`,
  };
}

function localReadme(): DeploymentFile {
  return {
    path: 'deploy/local/README.md',
    language: 'markdown',
    content: `# Running locally

\`\`\`bash
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET
docker compose up --build
\`\`\`

- Backend: http://localhost:4000
- Frontend: http://localhost:5173
- Health: http://localhost:4000/health
`,
  };
}

export function generateTargetConfig(
  target: DeploymentTarget,
  artifacts: DeploymentArtifacts,
): TargetConfig {
  const name = slug(artifacts.projectName);

  switch (target) {
    case 'vercel':
      return { files: [vercelConfig()] };
    case 'netlify':
      return { files: [netlifyConfig()] };
    case 'render':
      return { files: [renderConfig(name)] };
    case 'railway':
      return { files: [railwayConfig()] };
    case 'aws-ec2':
      return { files: ec2Files() };
    case 'aws-ecs':
      return { files: [ecsTaskDefinition(name)] };
    case 'gcp-cloud-run':
      return { files: [cloudRunService(name)] };
    case 'azure-app-service':
      return { files: [azureConfig(name)] };
    case 'digitalocean':
      return { files: [digitalOceanConfig(name)] };
    case 'local':
      return { files: [localReadme()] };
    case 'docker':
    case 'docker-compose':
      return { files: [] };
    default: {
      const exhaustive: never = target;
      throw new Error(`Unsupported deployment target: ${String(exhaustive)}`);
    }
  }
}
