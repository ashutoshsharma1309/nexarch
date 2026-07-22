/**
 * In-memory workspace activity feed — project/workspace level events
 * (created, renamed, archived, exported...). Populated by the service layer
 * whenever it mutates a project, a generation, or produces an export. Same
 * in-memory/no-persistence-layer justification as `project-store.ts`.
 */
import type { ActivityEventType, ActivityLogEntry } from '../workspace.types.js';

const entries: ActivityLogEntry[] = [];
let counter = 0;
const MAX_ENTRIES = 500;

function nextId(): string {
  counter += 1;
  return `act_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function logActivity(
  type: ActivityEventType,
  message: string,
  projectId: string | null = null,
  projectName: string | null = null,
): ActivityLogEntry {
  const entry: ActivityLogEntry = {
    id: nextId(),
    type,
    projectId,
    projectName,
    message,
    createdAt: new Date().toISOString(),
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  return entry;
}

export function listActivity(projectId?: string, limit = 50): ActivityLogEntry[] {
  const filtered = projectId ? entries.filter((e) => e.projectId === projectId) : entries;
  return filtered.slice(0, limit);
}

/** Test-only: reset state between test files. */
export function _resetActivityLog(): void {
  entries.length = 0;
  counter = 0;
}
