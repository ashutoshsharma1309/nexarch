/**
 * The public-MVP shape of a plan: the same application with sign-in taken
 * out, for when generated apps should open straight onto their content.
 *
 * Authentication is planned into every architecture by the individual
 * planners, and everything downstream follows the API contract: the
 * frontend turns login pages and route protection on when the contract has
 * an Authentication module, and the backend guards exactly the operations
 * the contract marks as secured. Removing sign-in here — once, on the
 * finished plan — therefore removes it everywhere, without teaching every
 * planner and generator a second mode.
 */
import type { ArchitecturePlan, FolderNode } from '../../../shared/types/architecture.js';

const isAuthModule = (name: string): boolean => /^authentication$/i.test(name);

/** Routes that only make sense for a signed-in visitor. */
const SIGNED_IN_ROUTES = /^\/(login|register|profile|forgot-password|reset-password|verify)/;

function withoutAuthFolders(nodes: readonly FolderNode[]): FolderNode[] {
  return nodes
    .filter((node) => !(node.type === 'directory' && node.name === 'auth'))
    .map((node) =>
      node.children ? { ...node, children: withoutAuthFolders(node.children) } : node,
    );
}

export function withoutAuthentication(plan: ArchitecturePlan): ArchitecturePlan {
  return {
    ...plan,
    folderStructure: withoutAuthFolders(plan.folderStructure),
    apiModules: plan.apiModules
      .filter((module) => !isAuthModule(module.module))
      .map((module) => ({
        ...module,
        // Public: no guard and, with no signed-in user, no role to check.
        endpoints: module.endpoints.map(({ roles: _roles, ...endpoint }) => ({
          ...endpoint,
          auth: false,
        })),
      })),
    frontend: {
      ...plan.frontend,
      pages: plan.frontend.pages
        .filter((page) => page.layout !== 'AuthLayout' && !SIGNED_IN_ROUTES.test(page.route))
        .map((page) => ({ ...page, access: ['Public'] })),
      layouts: plan.frontend.layouts.filter((layout) => layout !== 'AuthLayout'),
    },
    services: plan.services.filter((service) => !isAuthModule(service.module)),
    middleware: plan.middleware.filter(
      (entry) => entry.name !== 'authGuard' && entry.name !== 'roleGuard',
    ),
    security: {
      ...plan.security,
      authentication: [],
      sessionStrategy: 'None — a public MVP with no sign-in',
      authorization: 'None — every page and endpoint is public',
      passwordPolicy: [],
    },
    dependencyGraph: {
      nodes: plan.dependencyGraph.nodes.filter(
        (node) => !isAuthModule(node.id) && !isAuthModule(node.label),
      ),
      edges: plan.dependencyGraph.edges.filter(
        (edge) => !isAuthModule(edge.from) && !isAuthModule(edge.to),
      ),
    },
  };
}
