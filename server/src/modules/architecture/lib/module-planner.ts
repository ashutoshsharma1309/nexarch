/**
 * Module Planner: the backend building blocks per module — controller,
 * service, repository, DTOs, validators — plus the middleware stack.
 * Naming is convention-driven so generated code is predictable:
 * `ProductsController`, `CreateProductDto`, `UpdateProductValidator`.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { pascalCase, singularize } from '../../../shared/utils/strings.js';
import type { BackendModulePlan, MiddlewarePlan } from '../architecture.types.js';
import { dataModules, hasIntegration, hasModule, REGULATED_TYPES } from './common.js';

function dataModulePlan(module: string): BackendModulePlan {
  const plural = pascalCase(module);
  const singular = pascalCase(singularize(module));
  return {
    module,
    controller: `${plural}Controller`,
    service: `${plural}Service`,
    repository: `${plural}Repository`,
    dtos: [`Create${singular}Dto`, `Update${singular}Dto`, `${singular}ResponseDto`],
    validators: [`Create${singular}Validator`, `Update${singular}Validator`, 'ListQueryValidator'],
  };
}

export function planBackendModules(spec: RequirementSpec): BackendModulePlan[] {
  const plans: BackendModulePlan[] = [
    {
      module: 'Authentication',
      controller: 'AuthController',
      service: 'AuthService (+ TokenService, PasswordHasher)',
      repository: 'UsersRepository',
      dtos: ['RegisterDto', 'LoginDto', 'TokenPairDto'],
      validators: ['RegisterValidator', 'LoginValidator'],
    },
  ];

  for (const module of dataModules(spec)) {
    plans.push(dataModulePlan(module));
  }

  if (hasModule(spec, 'Reports') || hasModule(spec, 'Analytics')) {
    plans.push({
      module: 'Reports',
      controller: 'ReportsController',
      service: 'ReportsService',
      repository: 'none — aggregates through module repositories',
      dtos: ['ReportSummaryDto', 'ReportExportDto'],
      validators: ['ReportQueryValidator'],
    });
  }

  if (hasModule(spec, 'Notifications')) {
    plans.push({
      module: 'Notifications',
      controller: 'NotificationsController',
      service: 'NotificationsService (event consumer)',
      repository: 'NotificationsRepository',
      dtos: ['NotificationResponseDto'],
      validators: ['ListQueryValidator'],
    });
  }

  return plans;
}

export function planMiddleware(spec: RequirementSpec): MiddlewarePlan[] {
  const middleware: MiddlewarePlan[] = [
    { name: 'requestContext', purpose: 'Correlation id on every request, echoed as X-Request-Id' },
    { name: 'helmet', purpose: 'Security headers (CSP, no-sniff, frame denial, HSTS)' },
    { name: 'cors', purpose: 'Origin allow-list from configuration; deny by default' },
    { name: 'rateLimiter', purpose: 'Global per-IP ceiling; stricter window on /auth/*' },
    { name: 'requestLogger', purpose: 'Structured access logs through the app logger' },
    { name: 'validate', purpose: 'DTO validation at the boundary; 422 with field details' },
    { name: 'authGuard', purpose: 'Verifies the access token, attaches the user context' },
    { name: 'roleGuard', purpose: `RBAC checks for ${spec.roles.join('/')} on protected routes` },
    { name: 'errorHandler', purpose: 'Single error → HTTP envelope pathway; no leaked internals' },
  ];

  if (hasIntegration(spec, 'File Upload') || hasIntegration(spec, 'Cloud Storage')) {
    middleware.splice(6, 0, {
      name: 'uploadHandler',
      purpose: 'Multipart parsing with size/type limits before storage upload',
    });
  }
  if (REGULATED_TYPES.has(spec.projectType)) {
    middleware.push({
      name: 'auditLogger',
      purpose: `Append-only audit trail for sensitive ${spec.projectType.toLowerCase()} operations`,
    });
  }
  return middleware;
}
