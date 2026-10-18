/**
 * Project Editor — changing a generated project instead of regenerating it.
 *
 * Mounted at `/projects`, so its routes read `/projects/:projectId/edits/…`
 * beside the graph and the rest of the project-centric v2 surface.
 *
 * The module owns one idea: an edit is a *plan* first and a change second.
 * Planning is cheap and reversible and says what it intends to touch;
 * applying is the only thing that writes, and it writes only after the
 * edited project has actually built and started.
 */
import type { AppModule } from '../../shared/types/module.js';
import { projectEditorRouter } from './project-editor.router.js';

export const projectEditorModule: AppModule = {
  name: 'project-editor',
  basePath: '/projects',
  description: 'Edit an existing project from an instruction and an optional reference image',
  router: projectEditorRouter,
};
