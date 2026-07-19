/**
 * JSON generator: merges domain defaults with the facts extracted from the
 * prompt into the final RequirementSpec. Merge policy is always
 * "profile first, prompt additions after, no duplicates" so output stays
 * stable and predictable for the Architecture Planner downstream.
 */
import type { ExtractedFeatures, RequirementSpec } from '../analysis.types.js';
import type { DomainProfile } from './knowledge-base.js';
import { MODULE_LEXICON } from './lexicon.js';
import { containsPhrase, dedupe, singularize, titleCase } from './normalize.js';

/** Modules that are platform chrome rather than data domains. */
const NON_DATA_MODULES = new Set([
  'Authentication',
  'Dashboard',
  'Settings',
  'Notifications',
  'Reports',
]);

/** Domains whose product is public-facing enough to need a landing page. */
const LANDING_PAGE_DOMAINS = new Set([
  'ecommerce',
  'portfolio',
  'blog',
  'lms',
  'hotel',
  'restaurant',
]);

const NAME_PATTERN =
  /(?:called|named)\s+"?([a-z0-9][a-z0-9 _-]{1,40}?)"?(?:[.,]|\s+(?:with|that|which|for)\b|$)/i;

function extractProjectName(rawPrompt: string): string | null {
  const match = NAME_PATTERN.exec(rawPrompt);
  const candidate = match?.[1]?.trim();
  return candidate ? titleCase(candidate) : null;
}

function entitiesForModules(moduleLabels: readonly string[]): string[] {
  const entities: string[] = [];
  for (const label of moduleLabels) {
    const entry = MODULE_LEXICON.find((candidate) => candidate.label === label);
    if (entry) entities.push(...entry.entities);
  }
  return entities;
}

function buildAuthentication(features: ExtractedFeatures, roleCount: number): string[] {
  const auth = [...features.authMethods];
  // Sensible platform defaults when auth is needed but unspecified.
  if (auth.length === 0) auth.push('JWT', 'Email Login');
  if (!auth.includes('JWT') && !auth.includes('OAuth')) auth.unshift('JWT');
  if (roleCount > 1 && !auth.includes('RBAC')) auth.push('RBAC');
  return dedupe(auth);
}

function buildFrontend(
  profile: DomainProfile | null,
  modules: readonly string[],
  features: ExtractedFeatures,
): string[] {
  const pages: string[] = [];
  if (profile && LANDING_PAGE_DOMAINS.has(profile.id)) pages.push('Landing Page');
  pages.push('Dashboard');
  pages.push(...modules.filter((module) => !NON_DATA_MODULES.has(module)));
  if (
    modules.includes('Reports') ||
    modules.includes('Analytics') ||
    features.frontend.includes('Charts')
  ) {
    pages.push('Reports & Charts');
  }
  pages.push('Settings');
  return dedupe(pages);
}

function buildBackend(modules: readonly string[], features: ExtractedFeatures): string[] {
  const apis: string[] = ['Auth API'];
  for (const module of modules) {
    if (NON_DATA_MODULES.has(module)) continue;
    apis.push(`${singularize(module)} API`);
  }
  if (modules.includes('Reports') || features.backend.includes('Reports API')) {
    apis.push('Reports API');
  }
  if (features.integrations.includes('File Upload')) apis.push('File Upload API');
  if (features.backend.includes('Search')) apis.push('Search API');
  apis.push('Filtering & Pagination');
  return dedupe(apis);
}

function buildMissingRequirements(
  profile: DomainProfile | null,
  normalizedPrompt: string,
): string[] {
  if (!profile) return [];
  return profile.expected
    .filter(
      (feature) => !feature.coveredBy.some((phrase) => containsPhrase(normalizedPrompt, phrase)),
    )
    .map((feature) => feature.label);
}

export function buildSpec(
  rawPrompt: string,
  normalizedPrompt: string,
  profile: DomainProfile | null,
  features: ExtractedFeatures,
): RequirementSpec {
  // Domain roles and explicitly-mentioned roles are unioned: "with vendors"
  // extends the e-commerce defaults rather than replacing them, and a
  // mention of "admin dashboard" can never collapse the spec to Admin-only.
  const roles = dedupe([
    'Admin',
    ...(profile?.roles ?? (features.roles.length > 0 ? [] : ['User'])),
    ...features.roles,
  ]);

  const modules = dedupe([
    'Authentication',
    ...(profile?.modules ?? ['Dashboard', 'Users', 'Settings']),
    ...features.modules,
  ]);

  const database = dedupe([
    'Users',
    ...(profile?.entities ?? []),
    ...entitiesForModules(features.modules),
  ]);

  const integrations = dedupe([...features.integrations, ...(profile?.integrations ?? [])]);

  return {
    projectName: extractProjectName(rawPrompt) ?? profile?.defaultName ?? 'Custom Application',
    projectType: profile?.type ?? 'Custom',
    roles,
    modules,
    frontend: buildFrontend(profile, modules, features),
    backend: buildBackend(modules, features),
    database,
    authentication: buildAuthentication(features, roles.length),
    integrations,
    missingRequirements: buildMissingRequirements(profile, normalizedPrompt),
  };
}
