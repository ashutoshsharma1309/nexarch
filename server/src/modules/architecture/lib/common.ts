/**
 * Shared planner vocabulary: which modules are platform chrome versus data
 * domains. Data modules get CRUD APIs, repositories, entities and pages;
 * chrome modules get specialized treatment in each planner.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';

export const CHROME_MODULES: ReadonlySet<string> = new Set([
  'Authentication',
  'Dashboard',
  'Settings',
  'Notifications',
  'Reports',
  'Analytics',
]);

/** Modules that own domain data, in spec order. */
export function dataModules(spec: RequirementSpec): string[] {
  return spec.modules.filter((module) => !CHROME_MODULES.has(module));
}

export function hasModule(spec: RequirementSpec, module: string): boolean {
  return spec.modules.includes(module);
}

export function hasIntegration(spec: RequirementSpec, integration: string): boolean {
  return spec.integrations.some((entry) => entry.startsWith(integration));
}

/** Domains that handle regulated or high-liability data. */
export const REGULATED_TYPES: ReadonlySet<string> = new Set(['Banking', 'Hospital', 'HRMS']);

/** Domains with a public marketing/browsing surface (need a landing page/CDN). */
export const PUBLIC_FACING_TYPES: ReadonlySet<string> = new Set([
  'Ecommerce',
  'Portfolio',
  'Blog',
  'LMS',
  'Hotel',
  'Restaurant',
]);
