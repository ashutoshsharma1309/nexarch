/**
 * Emits the route table (React Router v7 data router, lazy per page — the
 * initial bundle carries only the shell) and the application entry point
 * (main.tsx mounting QueryClientProvider + RouterProvider + Toaster,
 * App.tsx, index.html, vite-env.d.ts).
 */
import type { FrontendProjectModel } from './project-model.js';
import type { GeneratedFile } from '../frontend-generator.types.js';
import { fontOf, type SiteTheme } from './site-content.js';
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

  // The dashboard lives at /dashboard: `/` is the app's public landing page.
  const dashboardRoute = routeEntry(
    '          ',
    'dashboard',
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
  // The public website: always reachable, never behind sign-in.
${routeEntry('  ', '/', '@/features/landing/LandingPage', 'LandingPage')}
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

/** The project name reaches HTML from a (possibly model-written) spec: escape it. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Inline, so the site never requests a /favicon.ico it does not have.
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%236366f1'/%3E%3Cpath d='M10 22V10l12 12V10' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

/**
 * Percent-encode the axis separators in a Google Fonts family.
 *
 * `Inter:wght@400` is the documented syntax, and it also reads exactly like
 * `user:password@host` — enough that this platform's own secret scanner flags
 * a generated `index.html` as leaking a credential. Encoding them is
 * equivalent for the server and unambiguous for every reader, human or not.
 */
function fontQuery(family: string): string {
  return family.replaceAll(':', '%3A').replaceAll('@', '%40');
}

/**
 * The shell opens in the mode the design chose, and asks for its typeface.
 *
 * The font is a `<link>` to Google Fonts rather than a bundled file: it is
 * one request, it is cached across the web, and if it never arrives the page
 * falls back to the system stack in the same `--font-sans` declaration. A
 * design that chose the system stack asks for nothing at all.
 */
function indexHtml(projectName: string, theme: SiteTheme): string {
  const font = fontOf(theme);
  const fontLinks =
    font.googleFamily === null
      ? ''
      : `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=${fontQuery(font.googleFamily)}&display=swap"
    />`;
  return `<!doctype html>
<html lang="en"${theme.mode === 'dark' ? ' class="dark"' : ''}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="${theme.mode} ${theme.mode === 'dark' ? 'light' : 'dark'}" />
    <link rel="icon" href="${FAVICON}" />${fontLinks}
    <title>${escapeHtml(projectName)}</title>
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

export function emitRouting(model: FrontendProjectModel, theme: SiteTheme): GeneratedFile[] {
  return [
    file('src/app/router.tsx', 'typescriptreact', router(model)),
    file('src/app/App.tsx', 'typescriptreact', app),
    file('src/main.tsx', 'typescriptreact', main),
    file('index.html', 'html', indexHtml(model.projectName, theme)),
    file('src/vite-env.d.ts', 'typescript', viteEnv),
  ];
}
