/**
 * Emits the generated project's root-level files: package.json, Vite +
 * TypeScript + ESLint config, environment template, .gitignore, Dockerfile,
 * and the README documenting the page map and setup steps.
 */
import type { FrontendProjectModel } from './project-model.js';
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

function packageJson(model: FrontendProjectModel): GeneratedFile {
  const pkg = {
    name:
      model.projectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'generated-frontend',
    version: '0.1.0',
    private: true,
    type: 'module',
    description: `Generated frontend for ${model.projectName} (${model.projectType}) — produced by the NexArch Frontend Generation Engine.`,
    scripts: {
      dev: 'vite',
      build: 'tsc -b && vite build',
      preview: 'vite preview',
      typecheck: 'tsc -b --force',
      lint: 'eslint src',
    },
    dependencies: {
      '@hookform/resolvers': '^5.0.1',
      '@tanstack/react-query': '^5.75.0',
      axios: '^1.9.0',
      clsx: '^2.1.1',
      'framer-motion': '^12.9.0',
      'lucide-react': '^0.525.0',
      react: '^19.1.0',
      'react-dom': '^19.1.0',
      'react-hook-form': '^7.56.0',
      'react-router-dom': '^7.5.0',
      'tailwind-merge': '^3.2.0',
      zod: '^3.25.0',
      zustand: '^5.0.4',
    },
    devDependencies: {
      '@tailwindcss/vite': '^4.1.5',
      '@types/node': '^22.15.0',
      '@types/react': '^19.1.0',
      '@types/react-dom': '^19.1.0',
      '@vitejs/plugin-react': '^4.4.0',
      '@eslint/js': '^9.25.0',
      eslint: '^9.25.0',
      'eslint-plugin-react-hooks': '^5.2.0',
      'eslint-plugin-react-refresh': '^0.4.19',
      globals: '^16.0.0',
      tailwindcss: '^4.1.5',
      typescript: '^5.8.0',
      'typescript-eslint': '^8.31.0',
      vite: '^6.3.0',
    },
  };
  return file('package.json', 'json', JSON.stringify(pkg, null, 2));
}

const viteConfig = `import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // BACKEND_URL lets a supervisor (e.g. the NexArch runner) point the
        // proxy at wherever the backend actually landed — 4000 is only the
        // default when both apps are started by hand.
        target: process.env.BACKEND_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@tanstack/react-query', 'axios', 'zustand'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
`;

const tsconfig = `{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
`;

const tsconfigApp = `{
  "compilerOptions": {
    "composite": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "useDefineForClassFields": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
`;

const tsconfigNode = `{
  "compilerOptions": {
    "composite": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["vite.config.ts"]
}
`;

const eslintConfig = `// @ts-check
import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
`;

function envExample(): GeneratedFile {
  return file(
    '.env.example',
    'env',
    `# The client calls the API at the same origin under /api (proxied by Vite in
# development). VITE_API_BASE_URL is an escape hatch for split deployments.
# VITE_API_BASE_URL=
`,
  );
}

function gitignore(): GeneratedFile {
  return file('.gitignore', 'ignore', `node_modules/\ndist/\n.env\n*.log\n`);
}

function dockerfile(): GeneratedFile {
  return file(
    'Dockerfile',
    'javascript',
    `FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
`,
  );
}

function readme(model: FrontendProjectModel): GeneratedFile {
  const pageRows = model.pages
    .map(
      (p) =>
        `| ${p.navLabel} | \`${p.route}\` | ${p.implemented ? 'Live CRUD' : 'Not implemented yet'} |`,
    )
    .join('\n');

  return file(
    'README.md',
    'markdown',
    `# ${model.projectName} — Console

Generated by the **NexArch Frontend Generation Engine** from the architecture plan, database
design, OpenAPI contract, and backend manifest produced by earlier pipeline stages. Nothing
here was written from the original prompt — every page and service call traces back to a
design artifact.

## Stack

React 19 · Vite · TypeScript (strict) · Tailwind CSS 4 · TanStack Query · React Router 7 ·
Zustand · React Hook Form · Zod · Axios · Framer Motion

## Getting started

\`\`\`bash
npm install
npm run dev   # http://localhost:5173, proxies /api to the backend on :4000
\`\`\`

## Architecture

Feature-first: each module under \`src/features/<module>\` owns its page, service, hooks,
types, and form. Design-system primitives live in \`src/shared/components/ui\`; layouts,
stores, and the API client live in \`src/shared\`.

\`\`\`
src/features/<module>/
  <Module>Page.tsx    page component: table, search, pagination, create/edit dialog
  components/          the module's own form component
  services/             typed Axios calls for this module's endpoints
  hooks/                 TanStack Query hooks (list/detail/create/update/delete)
  types.ts               record + input types
  schema.ts               Zod validation, shared by the form and the hooks
\`\`\`

## Pages

| Page | Route | Backend |
| --- | --- | --- |
${pageRows}

Pages for modules the backend hasn't implemented yet render an honest "not implemented"
panel instead of wiring a table against a route that doesn't exist — once the Backend
Generator implements it, regenerating the frontend turns it into a live page automatically.

## State

- \`shared/store/auth.store.ts\` — session token + user, persisted
- \`shared/store/theme.store.ts\` — dark/light, persisted, applied on load
- \`shared/store/toast.store.ts\` — notification queue
- \`shared/store/settings.store.ts\` — workspace preferences, persisted

## Security

Routes under the dashboard shell are gated by \`ProtectedRoute\`, which checks the auth
store and redirects to \`/login\`. Token verification itself happens on the backend — the
Security Engine (next phase) implements it there; this frontend is already wired to consume
it the moment it exists.
`,
  );
}

export function emitProjectFiles(model: FrontendProjectModel): GeneratedFile[] {
  return [
    packageJson(model),
    file('vite.config.ts', 'typescript', viteConfig),
    file('tsconfig.json', 'json', tsconfig),
    file('tsconfig.app.json', 'json', tsconfigApp),
    file('tsconfig.node.json', 'json', tsconfigNode),
    file('eslint.config.js', 'javascript', eslintConfig),
    envExample(),
    gitignore(),
    dockerfile(),
    readme(model),
  ];
}
