/**
 * Repair sessions and history — "what did NexArch change, and why?"
 *
 * Process-local and bounded, like the finding and validation stores. The
 * history is also where loop detection lives: a finding that was FIXED in
 * an earlier session and is back again is a repair loop, and the answer to
 * "have we been here before" has to come from a record, not a memory.
 */
import type { RepairRecord, RepairSessionState } from '../../../shared/types/repair.js';

const sessions = new Map<string, RepairSessionState[]>();
const history = new Map<string, RepairRecord[]>();

const MAX_PROJECTS = 40;
const MAX_SESSIONS = 5;
const MAX_RECORDS = 50;

export function saveSession(state: RepairSessionState): void {
  const list = sessions.get(state.projectId) ?? [];
  const index = list.findIndex((entry) => entry.id === state.id);
  if (index >= 0) list[index] = state;
  else list.push(state);
  while (list.length > MAX_SESSIONS) list.shift();
  sessions.set(state.projectId, list);
  evict(sessions);
}

export function latestSession(projectId: string): RepairSessionState | null {
  return sessions.get(projectId)?.at(-1) ?? null;
}

export function activeSession(projectId: string): RepairSessionState | null {
  const latest = latestSession(projectId);
  return latest?.status === 'RUNNING' ? latest : null;
}

export function saveRepair(record: RepairRecord): void {
  const list = history.get(record.projectId) ?? [];
  const index = list.findIndex((entry) => entry.id === record.id);
  if (index >= 0) list[index] = record;
  else list.push(record);
  while (list.length > MAX_RECORDS) list.shift();
  history.set(record.projectId, list);
  evict(history);
}

export function listRepairs(projectId: string): RepairRecord[] {
  return [...(history.get(projectId) ?? [])];
}

export function getRepair(projectId: string, repairId: string): RepairRecord | null {
  return history.get(projectId)?.find((entry) => entry.id === repairId) ?? null;
}

/**
 * Loop detection (Step 16): a finding fixed before that needs fixing again
 * means the fix does not hold — repairing it a third time is the doomed
 * surgery the spec names.
 */
export function wasFixedBefore(projectId: string, findingId: string): boolean {
  return (history.get(projectId) ?? []).some(
    (record) => record.findingId === findingId && record.result === 'FIXED',
  );
}

function evict(map: Map<string, unknown[]>): void {
  while (map.size > MAX_PROJECTS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function resetRepairStoreForTests(): void {
  sessions.clear();
  history.clear();
}
