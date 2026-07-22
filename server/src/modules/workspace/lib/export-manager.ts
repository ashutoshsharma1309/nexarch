/**
 * Export dispatch. Every format resolves to text/JSON content — never a
 * binary HTTP response, keeping this module's contract JSON-only like every
 * other module. `zip-project`/`docker-package` return an `{kind: 'archive',
 * files}` list; the client compresses it with its existing hand-rolled
 * `shared/lib/zip.ts` (the same store+CRC32 writer used by earlier phases),
 * so this module never needs a zip dependency of its own.
 */
import { AppError } from '../../../shared/utils/app-error.js';
import type { ExportRequest, ExportResult, Project } from '../workspace.types.js';
import { generateDockerCompose, generateDockerReadme } from './docker-package-generator.js';
import { generateDocumentation } from './documentation-generator.js';
import { generateProjectManifest } from './manifest-generator.js';
import { openApiToPostmanCollection } from './postman-generator.js';

export function runExport(request: ExportRequest, project?: Project): ExportResult {
  const { format, artifacts } = request;

  switch (format) {
    case 'readme': {
      const doc = generateDocumentation('readme', artifacts);
      return {
        kind: 'file',
        filename: doc.filename,
        mimeType: 'text/markdown',
        content: doc.markdown,
      };
    }

    case 'architecture-report': {
      const doc = generateDocumentation('architecture', artifacts);
      return {
        kind: 'file',
        filename: 'ARCHITECTURE_REPORT.md',
        mimeType: 'text/markdown',
        content: doc.markdown,
      };
    }

    case 'security-report': {
      const doc = generateDocumentation('security', artifacts);
      return {
        kind: 'file',
        filename: 'SECURITY_REPORT.md',
        mimeType: 'text/markdown',
        content: doc.markdown,
      };
    }

    case 'openapi': {
      if (!artifacts.openapi) {
        throw AppError.badRequest(
          'No OpenAPI contract available — run the Database Designer first',
        );
      }
      return {
        kind: 'file',
        filename: 'openapi.json',
        mimeType: 'application/json',
        content: JSON.stringify(artifacts.openapi, null, 2),
      };
    }

    case 'postman-collection': {
      if (!artifacts.openapi) {
        throw AppError.badRequest(
          'No OpenAPI contract available — run the Database Designer first',
        );
      }
      return {
        kind: 'file',
        filename: 'postman-collection.json',
        mimeType: 'application/json',
        content: JSON.stringify(openApiToPostmanCollection(artifacts.openapi), null, 2),
      };
    }

    case 'prisma-schema': {
      if (!artifacts.prismaSchema) {
        throw AppError.badRequest('No Prisma schema available — run the Database Designer first');
      }
      return {
        kind: 'file',
        filename: 'schema.prisma',
        mimeType: 'text/plain',
        content: artifacts.prismaSchema,
      };
    }

    case 'sql-schema': {
      if (!artifacts.sqlSchema) {
        throw AppError.badRequest('No SQL schema available — run the Database Designer first');
      }
      return {
        kind: 'file',
        filename: 'schema.sql',
        mimeType: 'text/plain',
        content: artifacts.sqlSchema,
      };
    }

    case 'dependency-graph': {
      if (!artifacts.dependencyGraph) {
        throw AppError.badRequest('No dependency graph available — build it first');
      }
      return {
        kind: 'file',
        filename: 'dependency-graph.json',
        mimeType: 'application/json',
        content: JSON.stringify(artifacts.dependencyGraph, null, 2),
      };
    }

    case 'project-manifest': {
      return {
        kind: 'file',
        filename: 'project-manifest.json',
        mimeType: 'application/json',
        content: JSON.stringify(generateProjectManifest(artifacts, project), null, 2),
      };
    }

    case 'docker-package': {
      return {
        kind: 'archive',
        files: [
          { path: 'docker-compose.yml', content: generateDockerCompose(artifacts) },
          { path: 'DOCKER_README.md', content: generateDockerReadme(artifacts) },
          { path: '.env.example', content: 'DATABASE_URL=\nJWT_SECRET=\n' },
        ],
      };
    }

    case 'zip-project': {
      const backendFiles = artifacts.backend?.files ?? [];
      const frontendFiles = artifacts.frontend?.files ?? [];
      if (backendFiles.length === 0 && frontendFiles.length === 0) {
        throw AppError.badRequest(
          'No generated files available — run the generation pipeline first',
        );
      }
      const missingContent = [...backendFiles, ...frontendFiles].some(
        (f) => f.content === undefined,
      );
      if (missingContent) {
        throw AppError.badRequest(
          'zip-project requires file content for every backend/frontend file',
        );
      }
      return {
        kind: 'archive',
        files: [...backendFiles, ...frontendFiles].map((f) => ({
          path: f.path,
          content: f.content ?? '',
        })),
      };
    }

    default: {
      const exhaustive: never = format;
      throw AppError.badRequest(`Unsupported export format: ${String(exhaustive)}`);
    }
  }
}
