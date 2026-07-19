/**
 * Folder Planner: the generated project's tree, mirroring the platform's
 * own proven layout — feature-first client, module-island server. Returned
 * as a recursive node structure the UI renders and the exporter prints.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { kebabCase } from '../../../shared/utils/strings.js';
import type { FolderNode } from '../architecture.types.js';
import { dataModules, hasModule } from './common.js';

function dir(name: string, children: FolderNode[] = []): FolderNode {
  return { name, type: 'directory', children };
}

function file(name: string): FolderNode {
  return { name, type: 'file' };
}

function serverModuleFolder(module: string): FolderNode {
  const slug = kebabCase(module);
  return dir(slug, [
    file(`${slug}.router.ts`),
    file(`${slug}.controller.ts`),
    file(`${slug}.service.ts`),
    file(`${slug}.repository.ts`),
    dir('dto'),
    file('index.ts'),
  ]);
}

function clientFeatureFolder(module: string): FolderNode {
  const slug = kebabCase(module);
  return dir(slug, [file(`${slug}-page.tsx`), dir('components'), file(`use-${slug}.ts`)]);
}

export function planFolders(spec: RequirementSpec): FolderNode[] {
  const modules = dataModules(spec);

  const serverModules: FolderNode[] = [
    dir('auth', [
      file('auth.router.ts'),
      file('auth.controller.ts'),
      file('auth.service.ts'),
      file('token.service.ts'),
      dir('dto'),
      file('index.ts'),
    ]),
    ...modules.map(serverModuleFolder),
  ];
  if (hasModule(spec, 'Reports')) serverModules.push(serverModuleFolder('Reports'));
  if (hasModule(spec, 'Notifications')) serverModules.push(serverModuleFolder('Notifications'));

  const clientFeatures: FolderNode[] = [
    dir('auth', [file('login-page.tsx'), file('register-page.tsx'), dir('components')]),
    dir('dashboard', [file('dashboard-page.tsx'), dir('components')]),
    ...modules.map(clientFeatureFolder),
    dir('settings', [file('settings-page.tsx')]),
  ];

  return [
    dir('client', [
      dir('src', [
        dir('app', [file('router.tsx'), file('providers.tsx')]),
        dir('features', clientFeatures),
        dir('shared', [
          dir('components', [dir('ui')]),
          dir('layouts'),
          dir('hooks'),
          dir('services'),
          dir('store'),
          dir('styles'),
        ]),
        file('main.tsx'),
      ]),
      file('index.html'),
      file('package.json'),
    ]),
    dir('server', [
      dir('src', [
        dir('modules', serverModules),
        dir('shared', [
          dir('config'),
          dir('middleware'),
          dir('database'),
          dir('logger'),
          dir('utils'),
          dir('types'),
        ]),
        file('app.ts'),
        file('index.ts'),
      ]),
      dir('prisma', [file('schema.prisma')]),
      file('package.json'),
    ]),
    file('docker-compose.yml'),
    file('README.md'),
  ];
}
