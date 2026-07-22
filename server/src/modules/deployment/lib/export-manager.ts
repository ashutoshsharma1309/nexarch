/**
 * Export dispatch — every format resolves to text/JSON content, never a
 * binary response (same "server stays JSON-only, client zips" contract
 * Phase 10's export engine uses). Archive formats return `{kind:'archive',
 * files}` for the client's existing `shared/lib/zip.ts` to compress.
 */
import { AppError } from '../../../shared/utils/app-error.js';
import { generateBackupDocs } from './backup-generator.js';
import { generateCiCdBundle } from './pipeline-generator.js';
import { generateDockerBundle } from './docker-generator.js';
import { generateDeploymentGuide } from './guide-generator.js';
import { generateEnvironmentBundle } from './environment-generator.js';
import { generateHealthBundle } from './health-generator.js';
import { generateLoggingBundle } from './logging-generator.js';
import { generateMonitoringBundle } from './monitoring-generator.js';
import { generateScalabilityDocs } from './scalability-generator.js';
import { generateTargetConfig } from './target-config-generator.js';
import type { ExportFileEntry, ExportRequest, ExportResult } from '../deployment.types.js';

function findProjectDockerfile(
  files: { path: string; content?: string }[] | undefined,
  outputPath: string,
): ExportFileEntry | null {
  const found = files?.find((f) => f.path === 'Dockerfile');
  if (!found?.content) return null;
  return { path: outputPath, content: found.content };
}

export function runExport(request: ExportRequest): ExportResult {
  const { format, target, artifacts } = request;

  const docker = generateDockerBundle(artifacts);
  const environment = generateEnvironmentBundle(artifacts);
  const cicd = generateCiCdBundle(target, artifacts);

  switch (format) {
    case 'dockerfile': {
      const backendDockerfile = findProjectDockerfile(
        artifacts.backend?.files,
        'backend/Dockerfile',
      );
      const frontendDockerfile = findProjectDockerfile(
        artifacts.frontend?.files,
        'frontend/Dockerfile',
      );
      const files = [backendDockerfile, frontendDockerfile].filter(
        (f): f is ExportFileEntry => f !== null,
      );
      if (files.length === 0) {
        throw AppError.badRequest(
          'No Dockerfile available — generate the backend or frontend first',
        );
      }
      return { kind: 'archive', files };
    }

    case 'docker-compose':
      return {
        kind: 'file',
        filename: 'docker-compose.yml',
        mimeType: 'text/yaml',
        content: docker.composeDev.content,
      };

    case 'docker-compose-prod':
      return {
        kind: 'file',
        filename: 'docker-compose.prod.yml',
        mimeType: 'text/yaml',
        content: docker.composeProd.content,
      };

    case 'github-workflow-build':
      return {
        kind: 'file',
        filename: 'build.yml',
        mimeType: 'text/yaml',
        content: cicd.buildWorkflow.content,
      };

    case 'github-workflow-deploy':
      return {
        kind: 'file',
        filename: 'deploy.yml',
        mimeType: 'text/yaml',
        content: cicd.deployWorkflow.content,
      };

    case 'env-example':
      return {
        kind: 'file',
        filename: '.env.example',
        mimeType: 'text/plain',
        content: environment.envExample.content,
      };

    case 'deployment-guide': {
      const guide = generateDeploymentGuide(target, artifacts, docker, environment, cicd);
      return {
        kind: 'file',
        filename: 'deployment-guide.md',
        mimeType: 'text/markdown',
        content: guide,
      };
    }

    case 'docker-package': {
      const backendDockerfile = findProjectDockerfile(
        artifacts.backend?.files,
        'backend/Dockerfile',
      );
      const frontendDockerfile = findProjectDockerfile(
        artifacts.frontend?.files,
        'frontend/Dockerfile',
      );
      return {
        kind: 'archive',
        files: [
          backendDockerfile,
          frontendDockerfile,
          { path: docker.dockerignoreBackend.path, content: docker.dockerignoreBackend.content },
          { path: docker.dockerignoreFrontend.path, content: docker.dockerignoreFrontend.content },
          { path: docker.composeDev.path, content: docker.composeDev.content },
          { path: docker.composeProd.path, content: docker.composeProd.content },
        ].filter((f): f is ExportFileEntry => f !== null),
      };
    }

    case 'environment-package':
      return {
        kind: 'archive',
        files: [
          { path: environment.envExample.path, content: environment.envExample.content },
          { path: environment.envDevelopment.path, content: environment.envDevelopment.content },
          { path: environment.envProduction.path, content: environment.envProduction.content },
          { path: environment.docs.path, content: environment.docs.content },
        ],
      };

    case 'cicd-package':
      return {
        kind: 'archive',
        files: [
          { path: cicd.buildWorkflow.path, content: cicd.buildWorkflow.content },
          { path: cicd.deployWorkflow.path, content: cicd.deployWorkflow.content },
        ],
      };

    case 'deployment-package': {
      const targetConfig = generateTargetConfig(target, artifacts);
      const backup = generateBackupDocs(artifacts);
      const scalability = generateScalabilityDocs(artifacts);
      const guide = generateDeploymentGuide(target, artifacts, docker, environment, cicd);
      return {
        kind: 'archive',
        files: [
          ...targetConfig.files.map((f) => ({ path: f.path, content: f.content })),
          { path: 'BACKUP.md', content: backup.markdown },
          { path: 'SCALABILITY.md', content: scalability.markdown },
          { path: 'deployment-guide.md', content: guide },
        ],
      };
    }

    case 'complete-zip': {
      const health = generateHealthBundle();
      const monitoring = generateMonitoringBundle();
      const logging = generateLoggingBundle();
      const backup = generateBackupDocs(artifacts);
      const scalability = generateScalabilityDocs(artifacts);
      const targetConfig = generateTargetConfig(target, artifacts);
      const guide = generateDeploymentGuide(target, artifacts, docker, environment, cicd);
      const backendDockerfile = findProjectDockerfile(
        artifacts.backend?.files,
        'backend/Dockerfile',
      );
      const frontendDockerfile = findProjectDockerfile(
        artifacts.frontend?.files,
        'frontend/Dockerfile',
      );

      const files: (ExportFileEntry | null)[] = [
        backendDockerfile,
        frontendDockerfile,
        { path: docker.dockerignoreBackend.path, content: docker.dockerignoreBackend.content },
        { path: docker.dockerignoreFrontend.path, content: docker.dockerignoreFrontend.content },
        { path: docker.composeDev.path, content: docker.composeDev.content },
        { path: docker.composeProd.path, content: docker.composeProd.content },
        { path: environment.envExample.path, content: environment.envExample.content },
        { path: environment.envDevelopment.path, content: environment.envDevelopment.content },
        { path: environment.envProduction.path, content: environment.envProduction.content },
        { path: environment.docs.path, content: environment.docs.content },
        { path: cicd.buildWorkflow.path, content: cicd.buildWorkflow.content },
        { path: cicd.deployWorkflow.path, content: cicd.deployWorkflow.content },
        ...health.files.map((f) => ({ path: f.path, content: f.content })),
        ...monitoring.files.map((f) => ({ path: f.path, content: f.content })),
        ...logging.files.map((f) => ({ path: f.path, content: f.content })),
        { path: 'BACKUP.md', content: backup.markdown },
        { path: 'SCALABILITY.md', content: scalability.markdown },
        ...targetConfig.files.map((f) => ({ path: f.path, content: f.content })),
        { path: 'deployment-guide.md', content: guide },
      ];

      return { kind: 'archive', files: files.filter((f): f is ExportFileEntry => f !== null) };
    }

    default: {
      const exhaustive: never = format;
      throw AppError.badRequest(`Unsupported export format: ${String(exhaustive)}`);
    }
  }
}
