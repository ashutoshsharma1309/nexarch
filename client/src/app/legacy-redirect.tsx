/**
 * Keeps the pre-workspace URLs working.
 *
 * Every internal module used to be a top-level route — `/architecture`,
 * `/database`, `/backend` and so on. Those links exist in bookmarks and in
 * this repo's own history, so they resolve rather than 404: each one lands
 * on the equivalent tab of the user's most recent project, or on the
 * project list when there is nothing to land on.
 *
 * `/preview/:runId` is the one that can do better than "most recent" — the
 * run itself names its project, so that redirect resolves the real one.
 */
import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { PageLoader } from '@/shared/components/loading-screen';
import { fetchRun } from '@/shared/services/pipeline.service';
import { listProjects } from '@/shared/services/workspace.service';

/** Sends to `/<newest project>/<tab>`, or `/projects` if there are none. */
export function LegacyTabRedirect({ tab }: { tab: string }) {
  const [to, setTo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listProjects()
      .then((projects) => {
        if (cancelled) return;
        const newest = projects[0];
        setTo(newest ? `/projects/${newest.id}${tab ? `/${tab}` : ''}` : '/projects');
      })
      .catch(() => {
        if (!cancelled) setTo('/projects');
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  return to ? <Navigate to={to} replace /> : <PageLoader />;
}

/** `/preview/:runId` → that run's project workspace, preview tab. */
export function LegacyPreviewRedirect() {
  const { runId } = useParams<{ runId: string }>();
  const [to, setTo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!runId) {
      setTo('/projects');
      return;
    }
    void fetchRun(runId)
      .then((run) => {
        if (cancelled) return;
        setTo(run.projectId ? `/projects/${run.projectId}/preview` : '/projects');
      })
      .catch(() => {
        if (!cancelled) setTo('/projects');
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return to ? <Navigate to={to} replace /> : <PageLoader />;
}
