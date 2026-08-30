export interface StoredValidationSnapshot<T> {
  id: string;
  project_uuid: string;
  created_at: string;
  value: T;
  evicted_snapshot_ids: string[];
}

export const MAX_VALIDATION_SNAPSHOTS_PER_PROJECT = 8;
const snapshots = new Map<string, Map<string, StoredValidationSnapshot<unknown>>>();
let sequence = 0;

export function storeValidationSnapshot<T>(
  projectUuid: string,
  digest: string,
  value: T
): StoredValidationSnapshot<T> {
  let perProject = snapshots.get(projectUuid);
  if (!perProject) {
    perProject = new Map();
    snapshots.set(projectUuid, perProject);
  }
  const evictedSnapshotIds: string[] = [];
  while (perProject.size >= MAX_VALIDATION_SNAPSHOTS_PER_PROJECT) {
    const oldest = perProject.keys().next().value as string | undefined;
    if (!oldest) break;
    perProject.delete(oldest);
    evictedSnapshotIds.push(oldest);
  }
  const stored: StoredValidationSnapshot<T> = {
    id: `${projectUuid}:${digest.slice(0, 16)}:${++sequence}`,
    project_uuid: projectUuid,
    created_at: new Date().toISOString(),
    value,
    evicted_snapshot_ids: evictedSnapshotIds,
  };
  perProject.set(stored.id, stored as StoredValidationSnapshot<unknown>);
  return stored;
}

export function getValidationSnapshot<T>(
  snapshotId: string,
  projectUuid: string
): StoredValidationSnapshot<T> {
  const stored = snapshots.get(projectUuid)?.get(snapshotId);
  if (!stored) {
    throw new Error(`Validation snapshot '${snapshotId}' is absent from this project.`);
  }
  return stored as StoredValidationSnapshot<T>;
}

export function clearAllValidationSnapshots(): void {
  snapshots.clear();
}

export function forgetProjectValidationSnapshots(projectUuid: string): void {
  snapshots.delete(projectUuid);
}
