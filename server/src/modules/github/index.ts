/**
 * GitHub Integration Engine (Phase 13).
 *
 * Pushes generated projects to GitHub: repository creation/selection,
 * branch creation, commit history, README generation, and a Git Data API
 * push flow (blobs → tree → commit → ref) that lands a whole generated
 * project as one reviewable commit. Credentials are a single optional
 * GITHUB_TOKEN resolved in `lib/credentials.ts` — until it is set the
 * module reports itself disabled, planning endpoints keep working, and
 * every network-touching endpoint fails fast with the enable path in the
 * error message. No placeholder responses anywhere: the service layer is
 * the real implementation, gated only by the token. Public surface: this
 * module definition only.
 */
import type { AppModule } from '../../shared/types/module.js';
import { githubRouter } from './github.router.js';

export const githubModule: AppModule = {
  name: 'github',
  basePath: '/github',
  description:
    'GitHub integration: repositories, branches, commit history, and pushing generated projects',
  router: githubRouter,
};
