/**
 * Orchestrates the Security Engine: `analyze()` runs the audit only (no
 * files, fast — for the "how secure is this right now" view), `apply()`
 * runs the same audit and then generates every fix it can, producing the
 * full `SecurityBundle` the API and the Security Dashboard consume.
 */
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type {
  DatabaseDesign,
  EntityMetadataSet,
  OpenApiDocument,
} from '../../shared/types/design.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import { buildFolderTree } from './lib/file-tree.js';
import { emitAuthenticationModule } from './lib/authentication-module.js';
import { emitFileSecurity, buildFileSecurityPolicy } from './lib/file-security.js';
import { emitFrontendSecurity } from './lib/frontend-security.js';
import { emitJwtAuth } from './lib/jwt-generator.js';
import { runOwaspAnalysis } from './lib/owasp-analyzer.js';
import { emitPasswordPolicy, buildPasswordPolicy } from './lib/password-policy.js';
import { emitRbac, buildRbacConfig } from './lib/rbac-generator.js';
import { buildSecurityReport } from './lib/report-generator.js';
import { emitSanitization } from './lib/sanitization.js';
import { emitSecurityConfig, buildSecurityConfig } from './lib/security-config.js';
import { buildSecurityModel } from './lib/security-model.js';
import { runSecurityScanner } from './lib/security-scanner.js';
import type {
  BackendManifest,
  FrontendManifest,
  GeneratedFile,
  SecurityAnalysis,
  SecurityBundle,
  SecurityFinding,
} from './security-engine.types.js';

export interface SecurityInputs {
  requirements: RequirementSpec;
  architecture: ArchitecturePlan;
  database: DatabaseDesign;
  openapi: OpenApiDocument;
  entityMetadata: EntityMetadataSet;
  backendManifest: BackendManifest;
  frontendManifest: FrontendManifest;
}

function frontendManifestFindings(
  inputs: SecurityInputs,
  authEnabled: boolean,
  applied: boolean,
): SecurityFinding[] {
  if (!authEnabled) return [];
  const hasAuthPage = inputs.frontendManifest.pages.some((p) => p.kind === 'auth');
  if (hasAuthPage) return [];
  return [
    {
      id: 'frontend-manifest-missing-auth-page',
      severity: 'low',
      category: 'frontend-consistency',
      owasp: null,
      title: 'Frontend manifest has no auth page for an authentication-enabled project',
      description:
        'The backend plans authentication, but frontend-manifest.json lists no page of kind "auth" — the Login/Register pages the Frontend Generator emits when authEnabled is true.',
      location: 'frontend-manifest.json',
      recommendation:
        'Regenerate the frontend after any change to the authentication plan so its manifest stays in sync.',
      resolved: applied,
    },
  ];
}

function runAudit(inputs: SecurityInputs, applied: boolean) {
  const model = buildSecurityModel(
    inputs.requirements,
    inputs.architecture,
    inputs.database,
    inputs.openapi,
    inputs.entityMetadata,
    inputs.backendManifest,
  );
  const findings = [
    ...runSecurityScanner(model, applied),
    ...frontendManifestFindings(inputs, model.authEnabled, applied),
  ];
  const owasp = runOwaspAnalysis(findings, model, applied);
  const report = buildSecurityReport(model, findings, model.endpoints);
  return { model, findings, owasp, report };
}

export function analyzeSecurity(inputs: SecurityInputs): SecurityAnalysis {
  const { model, owasp, report } = runAudit(inputs, false);
  return {
    meta: {
      projectName: model.projectName,
      projectType: model.projectType,
      generatedAt: new Date().toISOString(),
      generator: 'NexArch Security Engine',
    },
    report,
    owasp,
    recommendations: report.recommendations,
  };
}

export function applySecurity(inputs: SecurityInputs): SecurityBundle {
  const { model, owasp, report } = runAudit(inputs, true);

  const passwordPolicy = buildPasswordPolicy();
  const rbac = buildRbacConfig(model);
  const fileSecurity = buildFileSecurityPolicy();
  const securityConfig = buildSecurityConfig(model);
  const auth = emitAuthenticationModule(inputs.architecture, inputs.database, model);

  const backendFiles: GeneratedFile[] = [
    ...emitJwtAuth(),
    ...emitPasswordPolicy(passwordPolicy),
    ...emitRbac(rbac),
    ...emitSanitization(),
    ...emitFileSecurity(fileSecurity),
    ...emitSecurityConfig(model),
    ...auth.files,
  ];

  const frontendFiles: GeneratedFile[] = emitFrontendSecurity(rbac, model.authEnabled);

  const stats = {
    backendFiles: backendFiles.length,
    frontendFiles: frontendFiles.length,
    findings: report.findings.length,
    resolved: report.summary.resolved,
    critical: report.summary.critical,
    high: report.summary.high,
    medium: report.summary.medium,
    low: report.summary.low,
    owaspPassed: owasp.passed,
    owaspTotal: owasp.categories.length,
    identityTableDetected: model.identity?.entity ?? null,
  };

  return {
    meta: {
      projectName: model.projectName,
      projectType: model.projectType,
      generatedAt: new Date().toISOString(),
      generator: 'NexArch Security Engine',
    },
    backendFiles,
    frontendFiles,
    report,
    owasp,
    rbac,
    permissions: rbac.permissions,
    passwordPolicy,
    fileSecurity,
    securityConfig,
    folderTree: buildFolderTree([...backendFiles, ...frontendFiles]),
    stats,
  };
}
