/**
 * HTTP for project edits.
 *
 * The body limit is raised here and nowhere else. The platform's global cap
 * is 1 MB because prompts are text, and that is the right default for every
 * other route; a reference image is the one payload that legitimately is not
 * text, so the exception is scoped to the two routes that accept one rather
 * than loosened for the whole API.
 */
import { Router, json } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { applyHandler, planHandler, planDetailHandler } from './project-editor.controller.js';

export const projectEditorRouter: Router = Router();

projectEditorRouter.use(requireAuth);

/** A 4 MB image is ~5.5 MB of base64; 8 MB leaves room for the instruction. */
const imageBody = json({ limit: '8mb' });

projectEditorRouter.post('/:projectId/edits/plan', imageBody, planHandler);
projectEditorRouter.get('/:projectId/edits/:planId', planDetailHandler);
projectEditorRouter.post('/:projectId/edits/:planId/apply', applyHandler);
