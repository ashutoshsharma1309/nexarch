/**
 * Routes for the execution timeline.
 *
 * Authenticated because the timelines are owner-scoped, and metered as
 * polled reads would be wrong here: this is a diagnostic a human opens, not
 * something a live view polls, so it spends the ordinary API budget.
 */
import { Router } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { getTimelineHandler, listTimelinesHandler } from './observability.controller.js';

export const observabilityRouter: Router = Router();

observabilityRouter.use(requireAuth);

observabilityRouter.get('/timelines', listTimelinesHandler);
observabilityRouter.get('/timelines/:key', getTimelineHandler);
