/**
 * Route table.
 *
 * The shape is the product's mental model: a small set of top-level
 * destinations, and everything a project *is* nested under that project's
 * own URL. Workspace tabs are real routes so each one is bookmarkable and
 * survives the back button.
 *
 * Feature pages are code-split via route-level `lazy`, so the initial
 * bundle carries only the shell; the layout renders a PageLoader (via
 * Suspense) while a chunk loads.
 */
import { Navigate, createBrowserRouter } from 'react-router-dom';

import { RequireAuth } from '@/features/auth/require-auth';
import { AppLayout } from '@/shared/layouts/app-layout';
import { LegacyPreviewRedirect, LegacyTabRedirect } from './legacy-redirect';
import { RouteError } from './route-error';
import { NotFoundPage } from './not-found-page';

/**
 * Pre-workspace URLs, kept alive. See `legacy-redirect.tsx`.
 *
 * `/api` is deliberately absent: both the Vite dev server and the
 * production nginx config proxy that prefix to the backend, so a client
 * route there can never receive a request. The API contract it used to
 * show is a view on the Database tab.
 */
const LEGACY: { path: string; tab: string }[] = [
  { path: 'forge', tab: 'build' },
  { path: 'architecture', tab: 'architecture' },
  { path: 'database', tab: 'database' },
  { path: 'backend', tab: 'code' },
  { path: 'frontend', tab: 'code' },
  { path: 'security', tab: 'intelligence' },
  { path: 'dependency-graph', tab: 'intelligence' },
  { path: 'ai-operations', tab: 'intelligence' },
  { path: 'insights', tab: 'intelligence' },
  { path: 'quality', tab: 'intelligence' },
  { path: 'generations', tab: 'build' },
  { path: 'run', tab: 'preview' },
  { path: 'deployment', tab: 'code' },
  { path: 'documentation', tab: 'code' },
  { path: 'exports', tab: 'code' },
  { path: 'logs', tab: '' },
];

export const router = createBrowserRouter([
  // Login has been removed. Old bookmarks to the auth pages redirect home so
  // they never dead-end.
  { path: 'login', element: <Navigate to="/" replace />, errorElement: <RouteError /> },
  { path: 'register', element: <Navigate to="/" replace />, errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            lazy: async () => {
              const { HomePage } = await import('@/features/home/home-page');
              return { Component: HomePage };
            },
          },
          {
            path: 'projects',
            lazy: async () => {
              const { ProjectsPage } = await import('@/features/projects/projects-page');
              return { Component: ProjectsPage };
            },
          },
          {
            path: 'projects/:projectId',
            lazy: async () => {
              const { ProjectWorkspaceLayout } =
                await import('@/features/workspace/project-workspace-layout');
              return { Component: ProjectWorkspaceLayout };
            },
            children: [
              {
                index: true,
                lazy: async () => {
                  const { OverviewTab } = await import('@/features/workspace/tabs/overview-tab');
                  return { Component: OverviewTab };
                },
              },
              {
                path: 'requirements',
                lazy: async () => {
                  const { RequirementsTab } =
                    await import('@/features/workspace/tabs/requirements-tab');
                  return { Component: RequirementsTab };
                },
              },
              {
                path: 'build',
                lazy: async () => {
                  const { BuildTab } = await import('@/features/workspace/tabs/build-tab');
                  return { Component: BuildTab };
                },
              },
              {
                path: 'architecture',
                lazy: async () => {
                  const { ArchitectureTab } =
                    await import('@/features/workspace/tabs/architecture-tab');
                  return { Component: ArchitectureTab };
                },
              },
              {
                path: 'database',
                lazy: async () => {
                  const { DatabaseTab } = await import('@/features/workspace/tabs/database-tab');
                  return { Component: DatabaseTab };
                },
              },
              {
                path: 'code',
                lazy: async () => {
                  const { CodeTab } = await import('@/features/workspace/tabs/code-tab');
                  return { Component: CodeTab };
                },
              },
              {
                path: 'intelligence',
                lazy: async () => {
                  const { IntelligenceTab } =
                    await import('@/features/workspace/tabs/intelligence-tab');
                  return { Component: IntelligenceTab };
                },
                children: [
                  {
                    index: true,
                    lazy: async () => {
                      const { ReviewSection } =
                        await import('@/features/workspace/tabs/intelligence/review-section');
                      return { Component: ReviewSection };
                    },
                  },
                  {
                    path: 'validation',
                    lazy: async () => {
                      const { ValidationSection } =
                        await import('@/features/workspace/tabs/intelligence/validation-section');
                      return { Component: ValidationSection };
                    },
                  },
                  {
                    path: 'repairs',
                    lazy: async () => {
                      const { RepairSection } =
                        await import('@/features/workspace/tabs/intelligence/repair-section');
                      return { Component: RepairSection };
                    },
                  },
                  {
                    path: 'security',
                    lazy: async () => {
                      const { SecuritySection } =
                        await import('@/features/workspace/tabs/intelligence/security-section');
                      return { Component: SecuritySection };
                    },
                  },
                  {
                    path: 'dependencies',
                    lazy: async () => {
                      const { DependenciesSection } =
                        await import('@/features/workspace/tabs/intelligence/dependencies-section');
                      return { Component: DependenciesSection };
                    },
                  },
                  {
                    path: 'graph',
                    lazy: async () => {
                      const { GraphSection } =
                        await import('@/features/workspace/tabs/intelligence/graph-section');
                      return { Component: GraphSection };
                    },
                  },
                  {
                    // The old Roadmap section promised capabilities that now
                    // exist; its bookmarks land on the review index.
                    path: 'roadmap',
                    element: <Navigate to=".." replace />,
                  },
                ],
              },
              {
                path: 'preview',
                lazy: async () => {
                  const { PreviewTab } = await import('@/features/workspace/tabs/preview-tab');
                  return { Component: PreviewTab };
                },
              },
            ],
          },
          {
            path: 'settings',
            lazy: async () => {
              const { SettingsPage } = await import('@/features/settings/settings-page');
              return { Component: SettingsPage };
            },
          },

          /* Pre-workspace URLs. */
          { path: 'preview/:runId', element: <LegacyPreviewRedirect /> },
          ...LEGACY.map(({ path, tab }) => ({
            path,
            element: <LegacyTabRedirect tab={tab} />,
          })),

          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
