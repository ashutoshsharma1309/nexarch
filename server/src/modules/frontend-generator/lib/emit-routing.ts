/**
 * Emits the route table (React Router v7 data router, lazy per page — the
 * initial bundle carries only the shell) and the application entry point
 * (main.tsx mounting QueryClientProvider + RouterProvider + Toaster,
 * App.tsx, index.html, vite-env.d.ts).
 */
import type { FrontendProjectModel } from './project-model.js';
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

function routeEntry(
  indent: string,
  routePath: string | null,
  importPath: string,
  componentName: string,
): string {
  const pathLine = routePath === null ? `${indent}index: true,` : `${indent}path: '${routePath}',`;
  return `${indent}{
${pathLine}
${indent}  lazy: async () => {
${indent}    const { ${componentName} } = await import('${importPath}');
${indent}    return { Component: ${componentName} };
${indent}  },
${indent}},`;
}

function router(model: FrontendProjectModel): string {
  const entityRoutes = model.pages
    .map((p) =>
      routeEntry('          ', p.slug, `@/features/${p.slug}/${p.name}Page`, `${p.name}Page`),
    )
    .join('\n');

  const dashboardRoute = routeEntry(
    '          ',
    null,
    '@/features/dashboard/DashboardPage',
    'DashboardPage',
  );
  const settingsRoute = routeEntry(
    '          ',
    'settings',
    '@/features/settings/SettingsPage',
    'SettingsPage',
  );
  const profileRoute = model.authEnabled
    ? `\n${routeEntry('          ', 'profile', '@/features/profile/ProfilePage', 'ProfilePage')}`
    : '';

  const appChildren =
    [dashboardRoute, entityRoutes, settingsRoute].filter(Boolean).join('\n') + profileRoute;

  const authImports = model.authEnabled
    ? `import { AuthLayout } from '@/shared/layouts/auth-layout';\nimport { ProtectedRoute } from '@/shared/layouts/protected-route';\n`
    : '';

  const authRoutesBlock = model.authEnabled
    ? `,
  {
    element: <AuthLayout />,
    children: [
${routeEntry('      ', 'login', '@/features/auth/LoginPage', 'LoginPage')}
${routeEntry('      ', 'register', '@/features/auth/RegisterPage', 'RegisterPage')}
    ],
  }`
    : '';

  const dashboardShell = model.authEnabled
    ? `{
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
${appChildren}
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  }`
    : `{
    element: <AppLayout />,
    children: [
${appChildren}
      { path: '*', element: <NotFoundPage /> },
    ],
  }`;

  return `import { createBrowserRouter } from 'react-router-dom';

import { AppLayout } from '@/shared/layouts/app-layout';
${authImports}import { NotFoundPage } from './NotFoundPage';

export const router = createBrowserRouter([
  ${dashboardShell}${authRoutesBlock},
]);
`;
}

const app = `import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { Toaster } from '@/shared/components/ui/toaster';
import { queryClient } from '@/shared/services/query-client';
import { router } from './router';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}
`;

const main = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';

import '@/shared/styles/globals.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

function indexHtml(projectName: string): string {
  return `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

const viteEnv = `/// <reference types="vite/client" />
`;

export function emitRouting(model: FrontendProjectModel): GeneratedFile[] {
  return [
    file('src/app/router.tsx', 'typescriptreact', router(model)),
    file('src/app/App.tsx', 'typescriptreact', app),
    file('src/main.tsx', 'typescriptreact', main),
    file('index.html', 'html', indexHtml(model.projectName)),
    file('src/vite-env.d.ts', 'typescript', viteEnv),
  ];
}
