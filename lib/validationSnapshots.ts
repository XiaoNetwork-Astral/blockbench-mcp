export interface StoredValidationSnapshot<T> {
  id: string;
  session_id: string | null;
  project_uuid: string;
  created_at: string;
  value: T;
  evicted_snapshot_ids: string[];
}

const DEFAULT_SESSION_KEY = "__default_mcp_session__";
export const MAX_VALIDATION_SNAPSHOTS_PER_SESSION = 8;
const snapshots = new Map<string, Map<string, StoredValidationSnapshot<unknown>>>();
let sequence = 0;

function sessionKey(sessionId?: string): string {
  return sessionId || DEFAULT_SESSION_KEY;
}

export function storeValidationSnapshot<T>(
  sessionId: string | undefined,
  projectUuid: string,
  digest: string,
  value: T
): StoredValidationSnapshot<T> {
  const key = sessionKey(sessionId);
  let perSession = snapshots.get(key);
  if (!perSession) {
    perSession = new Map();
    snapshots.set(key, perSession);
  }
  const evictedSnapshotIds: string[] = [];
  while (perSession.size >= MAX_VALIDATION_SNAPSHOTS_PER_SESSION) {
    const oldest = perSession.keys().next().value as string | undefined;
    if (!oldest) break;
    perSession.delete(oldest);
    evictedSnapshotIds.push(oldest);
  }
  const stored: StoredValidationSnapshot<T> = {
    id: `${projectUuid}:${digest.slice(0, 16)}:${++sequence}`,
    session_id: sessionId ?? null,
    project_uuid: projectUuid,
    created_at: new Date().toISOString(),
    value,
    evicted_snapshot_ids: evictedSnapshotIds,
  };
  perSession.set(stored.id, stored as StoredValidationSnapshot<unknown>);
  return stored;
}

export function getValidationSnapshot<T>(
  sessionId: string | undefined,
  snapshotId: string,
  projectUuid: string
): StoredValidationSnapshot<T> {
  const stored = snapshots.get(sessionKey(sessionId))?.get(snapshotId);
  if (!stored || stored.project_uuid !== projectUuid) {
    throw new Error(
      `Validation snapshot '${snapshotId}' is absent from this MCP session and project.`
    );
  }
  return stored as StoredValidationSnapshot<T>;
}

export function clearSessionValidationSnapshots(sessionId?: string): void {
  snapshots.delete(sessionKey(sessionId));
}

export function clearAllValidationSnapshots(): void {
  snapshots.clear();
}

export function forgetProjectValidationSnapshots(projectUuid: string): void {
  for (const [key, perSession] of snapshots) {
    for (const [id, snapshot] of perSession) {
      if (snapshot.project_uuid === projectUuid) perSession.delete(id);
    }
    if (perSession.size === 0) snapshots.delete(key);
  }
}
