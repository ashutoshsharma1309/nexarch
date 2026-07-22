/**
 * Quality service — thin wrapper over the `lib/` orchestration. Stateless:
 * every call re-derives its result from the request body, the same
 * contract Dependency Graph's build/analyze and Deployment's generate use.
 * The controller owns the "most recently analyzed" cache the `GET`
 * endpoints serve from.
 */
import { computeEngineeringBundle, generateTestingReport } from './lib/analyze-orchestrator.js';
import { generateDocumentationBundle } from './lib/documentation-generator.js';
import { runExport as runExportInternal } from './lib/export-manager.js';
import type {
  DocumentationBundle,
  EngineeringBundle,
  ExportRequest,
  ExportResult,
  QualityArtifacts,
  TestingReport,
} from './quality.types.js';

export function analyzeQuality(artifacts: QualityArtifacts): EngineeringBundle {
  return computeEngineeringBundle(artifacts);
}

export function runTesting(artifacts: QualityArtifacts): TestingReport {
  return generateTestingReport(artifacts);
}

export function generateDocumentation(artifacts: QualityArtifacts): DocumentationBundle {
  return generateDocumentationBundle(artifacts);
}

export function runExport(request: ExportRequest): ExportResult {
  return runExportInternal(request);
}
