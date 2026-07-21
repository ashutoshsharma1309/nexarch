/**
 * Contracts for the Security Engine (Phase 7).
 *
 * The engine consumes the artifacts already produced by Phases 2-6
 * (requirements, architecture, database design, OpenAPI contract, and the
 * backend/frontend manifests) and emits a `SecurityBundle`: a security
 * report, an OWASP Top 10 assessment, RBAC/permission configuration, secure
 * defaults, and a set of `GeneratedFile`s that harden the *existing*
 * generated backend and frontend in place — same file paths Phase 5/6
 * already used where a file is being replaced, new paths where a capability
 * (JWT, RBAC, sanitization, …) didn't exist yet. Nothing here is written to
 * the platform's own source tree.
 */
import type { FolderNode } from '../../shared/types/architecture.js';

export type FileLanguage =
  'typescript' | 'typescriptreact' | 'json' | 'markdown' | 'env' | 'javascript';

export interface GeneratedFile {
  /** Project-relative path within the generated backend or frontend. */
  path: string;
  content: string;
  language: FileLanguage;
}

/**
 * A single module's summary from Phase 5's backend-manifest.json. Defined
 * locally (structurally, not imported) — modules never reach into a sibling
 * module's internals. Phase 5's real `GeneratedProject` output satisfies
 * this shape.
 */
export interface BackendModuleManifest {
  name: string;
  entity: string | null;
  crud: boolean;
  endpoints: number;
}

export interface BackendRouteManifest {
  method: string;
  path: string;
  auth: boolean;
  implemented: boolean;
}

export interface BackendManifest {
  modules: BackendModuleManifest[];
  routes: BackendRouteManifest[];
}

/** Phase 6's frontend-manifest.json, structurally — see BackendManifest note. */
export interface FrontendPageManifest {
  name: string;
  route: string;
  kind: string;
  entity: string | null;
  implemented: boolean;
}

export interface FrontendManifest {
  pages: FrontendPageManifest[];
}

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SecurityFinding {
  id: string;
  severity: SecuritySeverity;
  category: string;
  owasp: string | null;
  title: string;
  description: string;
  location: string | null;
  recommendation: string;
  /** True once `apply()` generates the fix this finding calls for. */
  resolved: boolean;
}

export interface EndpointSecurityAssessment {
  method: string;
  path: string;
  module: string;
  authRequired: boolean;
  rolesRequired: string[];
  validated: boolean;
  rateLimited: boolean;
  sensitiveData: boolean;
  notes: string[];
}

export type OwaspStatus = 'pass' | 'warn' | 'fail' | 'not-applicable';

export interface OwaspCategoryResult {
  id: string;
  title: string;
  status: OwaspStatus;
  summary: string;
  findingIds: string[];
}

export interface OwaspReport {
  version: '2021';
  categories: OwaspCategoryResult[];
  passed: number;
  warned: number;
  failed: number;
  notApplicable: number;
}

export interface SecurityReport {
  meta: { projectName: string; projectType: string; generatedAt: string; generator: string };
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: { critical: number; high: number; medium: number; low: number; resolved: number };
  findings: SecurityFinding[];
  resolvedFindings: SecurityFinding[];
  recommendations: string[];
  endpoints: EndpointSecurityAssessment[];
}

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  passwordHistory: number;
  expirationDays: number | null;
  bcryptSaltRounds: number;
}

export interface FileSecurityPolicy {
  maxSizeMb: number;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  virusScanEnabled: boolean;
}

export interface RbacRoleDefinition {
  role: string;
  description: string;
}

export type RbacAction = 'create' | 'read' | 'update' | 'delete';

export interface RbacPermissionEntry {
  entity: string;
  role: string;
  actions: RbacAction[];
}

export interface RbacConfig {
  roles: RbacRoleDefinition[];
  permissions: RbacPermissionEntry[];
}

export interface JwtConfig {
  algorithm: 'HS256';
  issuer: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
  refreshTokenStrategy: 'stateless-rotating-cookie';
}

export interface SecurityConfig {
  jwt: JwtConfig;
  passwordPolicy: PasswordPolicy;
  fileSecurity: FileSecurityPolicy;
  cors: { allowedOrigins: string[]; credentials: boolean };
  rateLimits: { windowMs: number; authMax: number; apiMax: number; writeMax: number };
  headers: string[];
  csrfEnabled: boolean;
  secureCookies: boolean;
}

/** The identity table the Authentication module was wired against, if any. */
export interface IdentityTableInfo {
  entity: string;
  tableName: string;
  emailField: string;
  passwordField: string;
  roleField: string | null;
  roleValues: string[] | null;
}

export interface SecurityStats {
  backendFiles: number;
  frontendFiles: number;
  findings: number;
  resolved: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  owaspPassed: number;
  owaspTotal: number;
  identityTableDetected: string | null;
}

export interface SecurityBundle {
  meta: { projectName: string; projectType: string; generatedAt: string; generator: string };
  backendFiles: GeneratedFile[];
  frontendFiles: GeneratedFile[];
  report: SecurityReport;
  owasp: OwaspReport;
  rbac: RbacConfig;
  permissions: RbacPermissionEntry[];
  passwordPolicy: PasswordPolicy;
  fileSecurity: FileSecurityPolicy;
  securityConfig: SecurityConfig;
  folderTree: FolderNode[];
  stats: SecurityStats;
}

/** The read-only output of `analyze()` — audit + score, no file generation. */
export interface SecurityAnalysis {
  meta: SecurityBundle['meta'];
  report: SecurityReport;
  owasp: OwaspReport;
  recommendations: string[];
}
