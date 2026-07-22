/**
 * Export dispatch — text/JSON content only, archives as `{kind:'archive',
 * files}` for the client's existing zip utility, same contract every
 * other export engine in this platform uses (Phase 10/11).
 */
import { AppError } from '../../../shared/utils/app-error.js';
import { computeEngineeringBundle, generateTestingReport } from './analyze-orchestrator.js';
import { generateDocumentationBundle } from './documentation-generator.js';
import type { ExportRequest, ExportResult } from '../quality.types.js';

export function runExport(request: ExportRequest): ExportResult {
  const { format, artifacts } = request;

  switch (format) {
    case 'quality-report': {
      const bundle = computeEngineeringBundle(artifacts);
      return {
        kind: 'file',
        filename: 'quality-report.json',
        mimeType: 'application/json',
        content: JSON.stringify(bundle.quality, null, 2),
      };
    }

    case 'testing-report': {
      const testing = generateTestingReport(artifacts);
      return {
        kind: 'file',
        filename: 'testing-report.json',
        mimeType: 'application/json',
        content: JSON.stringify(
          {
            summary: testing.summary,
            coverageEstimatePercent: testing.coverageEstimatePercent,
            openApiValidation: testing.openApiValidation,
          },
          null,
          2,
        ),
      };
    }

    case 'benchmark-report': {
      const bundle = computeEngineeringBundle(artifacts);
      return {
        kind: 'file',
        filename: 'benchmark-report.json',
        mimeType: 'application/json',
        content: JSON.stringify(bundle.benchmark, null, 2),
      };
    }

    case 'engineering-score': {
      const bundle = computeEngineeringBundle(artifacts);
      return {
        kind: 'file',
        filename: 'engineering-score.json',
        mimeType: 'application/json',
        content: JSON.stringify(bundle.score, null, 2),
      };
    }

    case 'release-readiness': {
      const bundle = computeEngineeringBundle(artifacts);
      return {
        kind: 'file',
        filename: 'release-readiness.json',
        mimeType: 'application/json',
        content: JSON.stringify(bundle.readiness, null, 2),
      };
    }

    case 'readme': {
      const docs = generateDocumentationBundle(artifacts);
      const readmeFile = docs.files.find((f) => f.kind === 'readme');
      if (!readmeFile) throw AppError.internal('README generation failed unexpectedly');
      return {
        kind: 'file',
        filename: readmeFile.filename,
        mimeType: 'text/markdown',
        content: readmeFile.content,
      };
    }

    case 'documentation-package': {
      const docs = generateDocumentationBundle(artifacts);
      return {
        kind: 'archive',
        files: docs.files.map((f) => ({ path: f.filename, content: f.content })),
      };
    }

    default: {
      const exhaustive: never = format;
      throw AppError.badRequest(`Unsupported export format: ${String(exhaustive)}`);
    }
  }
}
