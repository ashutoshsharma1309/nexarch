/**
 * Route table. Feature pages are code-split via route-level `lazy` so the
 * initial bundle carries only the shell; the layout renders a PageLoader
 * (via Suspense) while a chunk loads.
 */
import { createBrowserRouter } from 'react-router-dom';

import { AppLayout } from '@/shared/layouts/app-layout';
import { NotFoundPage } from './not-found-page';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        index: true,
        lazy: async () => {
          const { DashboardPage } = await import('@/features/dashboard/dashboard-page');
          return { Component: DashboardPage };
        },
      },
      {
        path: 'forge',
        lazy: async () => {
          const { PromptPage } = await import('@/features/prompt/prompt-page');
          return { Component: PromptPage };
        },
      },
      {
        path: 'architecture',
        lazy: async () => {
          const { ArchitecturePage } = await import('@/features/architecture/architecture-page');
          return { Component: ArchitecturePage };
        },
      },
      {
        path: 'database',
        lazy: async () => {
          const { DatabasePage } = await import('@/features/database/database-page');
          return { Component: DatabasePage };
        },
      },
      {
        path: 'api',
        lazy: async () => {
          const { ApiContractPage } = await import('@/features/database/api-contract-page');
          return { Component: ApiContractPage };
        },
      },
      {
        path: 'backend',
        lazy: async () => {
          const { BackendPage } = await import('@/features/backend/backend-page');
          return { Component: BackendPage };
        },
      },
      {
        path: 'frontend',
        lazy: async () => {
          const { FrontendPage } = await import('@/features/frontend/frontend-page');
          return { Component: FrontendPage };
        },
      },
      {
        path: 'security',
        lazy: async () => {
          const { SecurityPage } = await import('@/features/security/security-page');
          return { Component: SecurityPage };
        },
      },
      {
        path: 'dependency-graph',
        lazy: async () => {
          const { DependencyGraphPage } =
            await import('@/features/dependency-graph/dependency-graph-page');
          return { Component: DependencyGraphPage };
        },
      },
      {
        path: 'ai-operations',
        lazy: async () => {
          const { AiOrchestratorPage } =
            await import('@/features/ai-orchestrator/ai-orchestrator-page');
          return { Component: AiOrchestratorPage };
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
        path: 'generations',
        lazy: async () => {
          const { GenerationsPage } = await import('@/features/generation/generations-page');
          return { Component: GenerationsPage };
        },
      },
      {
        path: 'settings',
        lazy: async () => {
          const { SettingsPage } = await import('@/features/settings/settings-page');
          return { Component: SettingsPage };
        },
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
