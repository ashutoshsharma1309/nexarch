/**
 * Compiles the emitted landing page against its emitted content types.
 *
 * Every generated project failed `tsc` here once: `site.ts` and the page used a
 * `layout` field the emitted `SiteSection` type did not declare. Generated
 * source is plain strings to this repository's compiler, so only compiling the
 * strings can catch it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ts from 'typescript';

import type { SiteDesign, SiteTheme } from './site-content.js';
import { emitLanding } from './emit-landing.js';

const THEME: SiteTheme = {
  mode: 'light',
  temperature: 'warm',
  corners: 'soft',
  fontId: 'inter',
  palette: {} as SiteTheme['palette'],
};

const DESIGN: SiteDesign = {
  brand: 'Test',
  tagline: 'A test.',
  theme: THEME,
  footerNote: '',
  source: 'ai',
  sections: [
    {
      kind: 'hero',
      id: 'top',
      navLabel: 'Home',
      headline: 'Hello',
      subheadline: 'Sub',
      badge: 'Badge',
      primaryCta: 'Go',
      secondaryCta: 'More',
      layout: 'centered',
      art: 'coffee',
      artLabel: 'Art',
    },
    {
      kind: 'catalog',
      id: 'menu',
      navLabel: 'Menu',
      title: 'Menu',
      subtitle: '',
      layout: 'menu',
      items: [{ name: 'Item', description: 'd', price: '', tag: '', art: 'coffee', artLabel: 'a' }],
    },
  ],
};

// Enough of each library for the page to compile: what matters is that every
// field the page reads and every field the content sets is declared.
const LIB_SHIMS = `
declare namespace React { type ReactNode = unknown; }
declare namespace JSX {
  interface Element {}
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: string | number }
  interface IntrinsicElements { [name: string]: any }
}
declare module 'react' { export function useState<T>(value: T): [T, (value: T | ((prior: T) => T)) => void]; }
declare module 'react-router-dom' { export const Link: (props: any) => JSX.Element; }
declare module 'lucide-react' { const icon: (props: any) => JSX.Element; export const ArrowRight: typeof icon; export const Check: typeof icon; export const ChevronDown: typeof icon; export const Menu: typeof icon; export const X: typeof icon; }
declare module '@/components/Art' { export const Art: (props: any) => JSX.Element; }
`;

describe('emitted landing page', () => {
  for (const hasApp of [true, false]) {
    it(`typechecks against its emitted content types (app area: ${String(hasApp)})`, () => {
      const emitted = emitLanding(DESIGN, hasApp);
      const files = new Map<string, string>([['/project/shims.d.ts', LIB_SHIMS]]);
      for (const file of emitted) files.set(`/project/${file.path}`, file.content);

      const options: ts.CompilerOptions = {
        noEmit: true,
        strict: true,
        jsx: ts.JsxEmit.Preserve,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        baseUrl: '/project',
        paths: { '@/*': ['src/*'] },
        allowImportingTsExtensions: true,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      };
      const real = ts.createCompilerHost(options);
      const host: ts.CompilerHost = {
        ...real,
        fileExists: (name) => files.has(name) || real.fileExists(name),
        directoryExists: (name) =>
          name.startsWith('/project') || (real.directoryExists?.(name) ?? false),
        getDirectories: (name) =>
          name.startsWith('/project') ? [] : (real.getDirectories?.(name) ?? []),
        realpath: (name) => (name.startsWith('/project') ? name : (real.realpath?.(name) ?? name)),
        readFile: (name) => files.get(name) ?? real.readFile(name),
        getSourceFile: (name, version) => {
          const content = files.get(name);
          return content === undefined
            ? real.getSourceFile(name, version)
            : ts.createSourceFile(name, content, version, true);
        },
      };
      const program = ts.createProgram([...files.keys()], options, host);
      const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      assert.deepEqual(diagnostics, []);
    });
  }
});
