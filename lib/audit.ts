/// <reference types="blockbench-types" />
import {
  checkUndoTravel,
  hashUndoPrefix,
  stringifyAuditValue,
  summarizeAuditValue,
  type AuditSource,
  type AuditStatus,
  type UndoOwnership,
} from "@/lib/auditCore";
import { getProjectRole } from "@/lib/projectRoles";
import { sessionManager } from "@/lib/sessions";
import {
  DEFAULT_AUDIT_RETENTION,
  getAuditRetention,
} from "@/lib/pluginSettings";

export type { AuditSource, AuditStatus } from "@/lib/auditCore";

const DATABASE_NAME = "codex_blockbench_mcp_audit";
const DATABASE_VERSION = 1;
const OPERATIONS_STORE = "operations";
const DETAILS_STORE = "details";
const PRUNE_INTERVAL = 100;

export interface AuditUndoPoint {
  runtimeId: string;
  projectId: string | null;
  projectName: string | null;
  projectRole: string | null;
  index: number;
  total: number;
  prefixHash: string;
  appliedEntryId: string | null;
  redoEntryId: string | null;
}

export interface AuditOperationSummary {
  id: string;
  sortKey: string;
  runtimeId: string;
  source: AuditSource;
  status: AuditStatus;
  toolName: string;
  title: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  sessionId: string | null;
  clientName: string | null;
  readOnly: boolean;
  projectId: string | null;
  projectName: string | null;
  projectRole: string | null;
  argumentsSummary: string;
  resultSummary: string;
  errorSummary: string;
  before: AuditUndoPoint;
  after: AuditUndoPoint;
  undoEntryCount: number;
  undoDelta: number;
  reversible: boolean;
  searchText: string;
}

export interface AuditUndoEntryDetail {
  id: string;
  action: string;
  type: string;
  time: number;
  ownerSource: AuditSource | "unknown";
}

export interface AuditOperationDetails {
  id: string;
  argumentsText: string;
  resultText: string;
  errorText: string;
  undoEntries: AuditUndoEntryDetail[];
}

export interface AuditQuery {
  page: number;
  pageSize: number;
  search?: string;
  source?: AuditSource | "all";
  status?: AuditStatus | "all";
  projectId?: string | "all";
  toolName?: string | "all";
}

export interface AuditPage {
  items: AuditOperationSummary[];
  page: number;
  pageSize: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface AuditTravelPlan {
  operationId: string;
  phase: "before" | "after";
  valid: boolean;
  reason?: string;
  projectId: string | null;
  projectName: string | null;
  currentIndex: number;
  targetIndex: number;
  direction: "undo" | "redo" | "none";
  steps: number;
  unsafeCount: number;
  unsafeActions: string[];
}

export type AuditChange =
  | { type: "records"; operationId?: string }
  | { type: "project"; projectId: string | null }
  | { type: "settings" }
  | { type: "storage"; persistent: boolean; message?: string };

interface RuntimeUndoSnapshot {
  point: AuditUndoPoint;
  entryIds: string[];
}

export interface AuditOperationHandle {
  id: string;
}

interface ActiveOperation {
  summary: AuditOperationSummary;
  details: AuditOperationDetails;
  beforeRuntime: RuntimeUndoSnapshot;
  trackNativeEvents: boolean;
  observedEntryIds: Set<string>;
}

interface BeginOperationOptions {
  source: AuditSource;
  toolName: string;
  title: string;
  args?: unknown;
  sessionId?: string;
  readOnly?: boolean;
  trackNativeEvents?: boolean;
}

function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function matchesAuditQuery(item: AuditOperationSummary, query: AuditQuery): boolean {
  if (query.source && query.source !== "all" && item.source !== query.source) return false;
  if (query.status && query.status !== "all" && item.status !== query.status) return false;
  if (query.projectId && query.projectId !== "all" && item.projectId !== query.projectId) return false;
  if (query.toolName && query.toolName !== "all" && item.toolName !== query.toolName) return false;
  const search = query.search?.trim().toLocaleLowerCase();
  return !search || item.searchText.includes(search);
}

class AuditStore {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private database: IDBDatabase | null = null;
  private memorySummaries = new Map<string, AuditOperationSummary>();
  private memoryDetails = new Map<string, AuditOperationDetails>();
  private persistent = typeof indexedDB !== "undefined";

  constructor(
    private readonly onStorageChange?: (persistent: boolean, message?: string) => void
  ) {}

  isPersistent(): boolean {
    return this.persistent;
  }

  async ready(): Promise<void> {
    if (!this.persistent) throw new Error("IndexedDB is unavailable; audit history is session-only.");
    await this.openDatabase();
  }

  private useSessionStorage(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const changed = this.persistent;
    this.persistent = false;
    this.database?.close();
    this.database = null;
    this.databasePromise = null;
    if (changed) this.onStorageChange?.(false, message);
  }

  private pruneMemory(maximum: number): void {
    const removeCount = this.memorySummaries.size - maximum;
    if (removeCount <= 0) return;
    const oldest = Array.from(this.memorySummaries.values())
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
      .slice(0, removeCount);
    for (const item of oldest) {
      this.memorySummaries.delete(item.id);
      this.memoryDetails.delete(item.id);
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.database) return Promise.resolve(this.database);
    if (this.databasePromise) return this.databasePromise;
    if (typeof indexedDB === "undefined") {
      this.persistent = false;
      return Promise.reject(new Error("IndexedDB is unavailable"));
    }

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
          const operations = database.createObjectStore(OPERATIONS_STORE, { keyPath: "id" });
          operations.createIndex("sortKey", "sortKey", { unique: true });
          operations.createIndex("projectId", "projectId", { unique: false });
          operations.createIndex("source", "source", { unique: false });
          operations.createIndex("status", "status", { unique: false });
          operations.createIndex("toolName", "toolName", { unique: false });
        }
        if (!database.objectStoreNames.contains(DETAILS_STORE)) {
          database.createObjectStore(DETAILS_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        if (!this.persistent) {
          request.result.close();
          return;
        }
        this.database = request.result;
        this.database.onversionchange = () => {
          this.database?.close();
          this.database = null;
          this.databasePromise = null;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        const error = request.error ?? new Error("Unable to open the audit database");
        this.useSessionStorage(error);
        reject(error);
      };
      request.onblocked = () => {
        const error = new Error("The audit database upgrade is blocked");
        this.useSessionStorage(error);
        reject(error);
      };
    });
    return this.databasePromise;
  }

  async put(summary: AuditOperationSummary, details: AuditOperationDetails): Promise<void> {
    this.memorySummaries.set(summary.id, summary);
    this.memoryDetails.set(details.id, details);
    if (!this.persistent) return;
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction([OPERATIONS_STORE, DETAILS_STORE], "readwrite");
      transaction.objectStore(OPERATIONS_STORE).put(summary);
      transaction.objectStore(DETAILS_STORE).put(details);
      await transactionDone(transaction);
    } catch (error) {
      this.useSessionStorage(error);
    }
  }

  async getSummary(id: string): Promise<AuditOperationSummary | undefined> {
    const memory = this.memorySummaries.get(id);
    if (memory) return memory;
    if (!this.persistent) return undefined;
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(OPERATIONS_STORE, "readonly");
      const value = await requestResult(
        transaction.objectStore(OPERATIONS_STORE).get(id) as IDBRequest<AuditOperationSummary | undefined>
      );
      if (value) this.memorySummaries.set(value.id, value);
      return value;
    } catch (error) {
      this.useSessionStorage(error);
      return undefined;
    }
  }

  async getDetails(id: string): Promise<AuditOperationDetails | undefined> {
    const memory = this.memoryDetails.get(id);
    if (memory) return memory;
    if (!this.persistent) return undefined;
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(DETAILS_STORE, "readonly");
      const value = await requestResult(
        transaction.objectStore(DETAILS_STORE).get(id) as IDBRequest<AuditOperationDetails | undefined>
      );
      if (value) this.memoryDetails.set(value.id, value);
      return value;
    } catch (error) {
      this.useSessionStorage(error);
      return undefined;
    }
  }

  private queryMemory(query: AuditQuery): AuditPage {
    const page = Math.max(0, Math.floor(query.page || 0));
    const pageSize = Math.max(1, Math.min(100, Math.floor(query.pageSize || 25)));
    const matching = Array.from(this.memorySummaries.values())
      .filter((item) => matchesAuditQuery(item, query))
      .sort((left, right) => right.sortKey.localeCompare(left.sortKey));
    const offset = page * pageSize;
    return {
      items: matching.slice(offset, offset + pageSize),
      page,
      pageSize,
      hasPrevious: page > 0,
      hasNext: matching.length > offset + pageSize,
    };
  }

  async query(query: AuditQuery): Promise<AuditPage> {
    if (!this.persistent) return this.queryMemory(query);
    const page = Math.max(0, Math.floor(query.page || 0));
    const pageSize = Math.max(1, Math.min(100, Math.floor(query.pageSize || 25)));
    const offset = page * pageSize;
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(OPERATIONS_STORE, "readonly");
      const index = transaction.objectStore(OPERATIONS_STORE).index("sortKey");
      const request = index.openCursor(null, "prev");
      const items = await new Promise<AuditOperationSummary[]>((resolve, reject) => {
        const matches: AuditOperationSummary[] = [];
        let skipped = 0;
        request.onerror = () => reject(request.error ?? new Error("Unable to read audit history"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || matches.length >= pageSize + 1) {
            resolve(matches);
            return;
          }
          const item = cursor.value as AuditOperationSummary;
          if (matchesAuditQuery(item, query)) {
            if (skipped < offset) skipped += 1;
            else matches.push(item);
          }
          cursor.continue();
        };
      });
      items.forEach((item) => this.memorySummaries.set(item.id, item));
      return {
        items: items.slice(0, pageSize),
        page,
        pageSize,
        hasPrevious: page > 0,
        hasNext: items.length > pageSize,
      };
    } catch (error) {
      this.useSessionStorage(error);
      return this.queryMemory(query);
    }
  }

  async clear(): Promise<void> {
    this.memorySummaries.clear();
    this.memoryDetails.clear();
    if (!this.persistent) return;
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction([OPERATIONS_STORE, DETAILS_STORE], "readwrite");
      transaction.objectStore(OPERATIONS_STORE).clear();
      transaction.objectStore(DETAILS_STORE).clear();
      await transactionDone(transaction);
    } catch (error) {
      this.useSessionStorage(error);
    }
  }

  async prune(maximum = DEFAULT_AUDIT_RETENTION): Promise<void> {
    this.pruneMemory(maximum);
    if (!this.persistent) return;
    try {
      const database = await this.openDatabase();
      const countTransaction = database.transaction(OPERATIONS_STORE, "readonly");
      const count = await requestResult(countTransaction.objectStore(OPERATIONS_STORE).count());
      const removeCount = count - maximum;
      if (removeCount <= 0) return;

      const transaction = database.transaction([OPERATIONS_STORE, DETAILS_STORE], "readwrite");
      const operations = transaction.objectStore(OPERATIONS_STORE);
      const details = transaction.objectStore(DETAILS_STORE);
      const request = operations.index("sortKey").openCursor(null, "next");
      await new Promise<void>((resolve, reject) => {
        let removed = 0;
        request.onerror = () => reject(request.error ?? new Error("Unable to prune audit history"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || removed >= removeCount) {
            resolve();
            return;
          }
          const item = cursor.value as AuditOperationSummary;
          this.memorySummaries.delete(item.id);
          this.memoryDetails.delete(item.id);
          cursor.delete();
          details.delete(item.id);
          removed += 1;
          cursor.continue();
        };
      });
      await transactionDone(transaction);
    } catch (error) {
      this.useSessionStorage(error);
    }
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.databasePromise = null;
  }
}

export class AuditConfirmationRequiredError extends Error {
  constructor(public readonly plan: AuditTravelPlan) {
    super("This history move crosses user or unknown edits and requires confirmation.");
    this.name = "AuditConfirmationRequiredError";
  }
}

class AuditManager {
  readonly runtimeId = createId();
  private readonly listeners = new Set<(change: AuditChange) => void>();
  private readonly store = new AuditStore((persistent, message) => {
    this.emit({ type: "storage", persistent, message });
  });
  private readonly activeOperations = new Map<string, ActiveOperation>();
  private readonly activeOrder: string[] = [];
  private readonly entryIds = new WeakMap<object, string>();
  private readonly ownershipByProject = new Map<string, Map<string, UndoOwnership>>();
  private readonly blockbenchListeners: Array<{ event: string; callback: (data: any) => void }> = [];
  private writeQueue: Promise<void> = Promise.resolve();
  private completedSincePrune = 0;
  private setupComplete = false;

  setup(): void {
    if (this.setupComplete) return;
    this.setupComplete = true;
    this.listen("finished_edit", () => this.onFinishedEdit());
    this.listen("finished_selection_change", () => this.onFinishedEdit());
    this.listen("select_project", () => {
      this.emit({ type: "project", projectId: Project?.uuid ?? null });
    });

    void this.store.ready().then(
      () => this.emit({ type: "storage", persistent: true }),
      (error) =>
        this.emit({
          type: "storage",
          persistent: false,
          message: error instanceof Error ? error.message : String(error),
        })
    );
  }

  teardown(): void {
    const api = Blockbench as unknown as {
      removeListener(event: string, callback: (data: any) => void): void;
    };
    for (const { event, callback } of this.blockbenchListeners.splice(0)) {
      api.removeListener(event, callback);
    }
    this.activeOperations.clear();
    this.activeOrder.length = 0;
    this.listeners.clear();
    this.store.close();
    this.setupComplete = false;
  }

  private listen(event: string, callback: (data: any) => void): void {
    const api = Blockbench as unknown as {
      on(event: string, callback: (data: any) => void): void;
    };
    api.on(event, callback);
    this.blockbenchListeners.push({ event, callback });
  }

  subscribe(listener: (change: AuditChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: AuditChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        // A panel subscriber must never break MCP operations.
      }
    }
  }

  isPersistent(): boolean {
    return this.store.isPersistent();
  }

  queryPage(query: AuditQuery): Promise<AuditPage> {
    return this.store.query(query);
  }

  getDetails(id: string): Promise<AuditOperationDetails | undefined> {
    return this.store.getDetails(id);
  }

  async clearHistory(): Promise<void> {
    await this.store.clear();
    this.emit({ type: "records" });
  }

  settingsChanged(): void {
    this.emit({ type: "settings" });
    this.enqueueWrite(() => this.store.prune(this.retentionLimit()));
  }

  beginMcpOperation(options: {
    toolName: string;
    title: string;
    args: unknown;
    sessionId?: string;
    readOnly: boolean;
  }): AuditOperationHandle {
    const session = options.sessionId ? sessionManager.get(options.sessionId) : undefined;
    return this.beginOperation({
      source: "mcp",
      toolName: options.toolName,
      title: options.title,
      args: options.args,
      sessionId: options.sessionId,
      readOnly: options.readOnly,
      trackNativeEvents: !options.readOnly,
    }, session?.clientName);
  }

  finishMcpOperation(handle: AuditOperationHandle, result?: unknown, error?: unknown): void {
    this.finishOperation(handle, result, error);
  }

  private beginOperation(options: BeginOperationOptions, clientName?: string): AuditOperationHandle {
    const id = createId();
    const startedAt = Date.now();
    const beforeRuntime = this.captureUndoSnapshot(Project ?? null);
    const summary: AuditOperationSummary = {
      id,
      sortKey: `${startedAt.toString().padStart(13, "0")}:${id}`,
      runtimeId: this.runtimeId,
      source: options.source,
      status: "running",
      toolName: options.toolName,
      title: options.title,
      startedAt,
      finishedAt: null,
      durationMs: null,
      sessionId: options.sessionId ?? null,
      clientName: clientName ?? null,
      readOnly: options.readOnly ?? false,
      projectId: beforeRuntime.point.projectId,
      projectName: beforeRuntime.point.projectName,
      projectRole: beforeRuntime.point.projectRole,
      argumentsSummary: summarizeAuditValue(options.args ?? {}),
      resultSummary: "",
      errorSummary: "",
      before: beforeRuntime.point,
      after: beforeRuntime.point,
      undoEntryCount: 0,
      undoDelta: 0,
      reversible: false,
      searchText: "",
    };
    const details: AuditOperationDetails = {
      id,
      argumentsText: stringifyAuditValue(options.args ?? {}),
      resultText: "",
      errorText: "",
      undoEntries: [],
    };
    this.refreshSearchText(summary);
    const active: ActiveOperation = {
      summary,
      details,
      beforeRuntime,
      trackNativeEvents: options.trackNativeEvents ?? false,
      observedEntryIds: new Set<string>(),
    };
    this.activeOperations.set(id, active);
    if (active.trackNativeEvents) this.activeOrder.push(id);
    this.persist(active);
    return { id };
  }

  private finishOperation(handle: AuditOperationHandle, result?: unknown, error?: unknown): void {
    const active = this.activeOperations.get(handle.id);
    if (!active) return;
    const afterRuntime = this.captureUndoSnapshot(Project ?? null);
    const finishedAt = Date.now();
    const sameProject =
      active.beforeRuntime.point.projectId !== null &&
      active.beforeRuntime.point.projectId === afterRuntime.point.projectId;

    if (sameProject && active.summary.projectId) {
      const beforeIds = new Set(active.beforeRuntime.entryIds);
      for (const entryId of afterRuntime.entryIds) {
        if (!beforeIds.has(entryId)) active.observedEntryIds.add(entryId);
      }
      const ownership = this.getOwnership(active.summary.projectId);
      for (const entryId of active.observedEntryIds) {
        ownership.set(entryId, { source: active.summary.source, operationId: active.summary.id });
      }
    }

    active.summary.status = error === undefined ? "success" : "error";
    active.summary.finishedAt = finishedAt;
    active.summary.durationMs = Math.max(0, finishedAt - active.summary.startedAt);
    active.summary.after = afterRuntime.point;
    active.summary.projectId = afterRuntime.point.projectId ?? active.beforeRuntime.point.projectId;
    active.summary.projectName = afterRuntime.point.projectName ?? active.beforeRuntime.point.projectName;
    active.summary.projectRole = afterRuntime.point.projectRole ?? active.beforeRuntime.point.projectRole;
    active.summary.resultSummary = error === undefined ? summarizeAuditValue(result ?? "") : "";
    active.summary.errorSummary = error === undefined ? "" : summarizeAuditValue(error);
    active.summary.undoEntryCount = active.observedEntryIds.size;
    active.summary.undoDelta = sameProject
      ? afterRuntime.point.index - active.beforeRuntime.point.index
      : 0;
    active.summary.reversible =
      sameProject &&
      active.beforeRuntime.point.runtimeId === this.runtimeId &&
      active.beforeRuntime.point.index !== afterRuntime.point.index;
    active.details.resultText = error === undefined ? stringifyAuditValue(result ?? "") : "";
    active.details.errorText = error === undefined ? "" : stringifyAuditValue(error);
    active.details.undoEntries = this.describeEntries(
      active.summary.projectId,
      afterRuntime,
      active.observedEntryIds
    );
    this.refreshSearchText(active.summary);

    this.activeOperations.delete(handle.id);
    const orderIndex = this.activeOrder.lastIndexOf(handle.id);
    if (orderIndex >= 0) this.activeOrder.splice(orderIndex, 1);
    this.persist(active);
    this.completedSincePrune += 1;
    if (this.completedSincePrune >= PRUNE_INTERVAL) {
      this.completedSincePrune = 0;
      this.enqueueWrite(() => this.store.prune(this.retentionLimit()));
    }
  }

  private refreshSearchText(summary: AuditOperationSummary): void {
    summary.searchText = [
      summary.toolName,
      summary.title,
      summary.projectName ?? "",
      summary.projectRole ?? "",
      summary.clientName ?? "",
      summary.argumentsSummary,
      summary.resultSummary,
      summary.errorSummary,
      summary.source,
      summary.status,
    ]
      .join(" ")
      .toLocaleLowerCase();
  }

  private persist(active: ActiveOperation): void {
    const summary = { ...active.summary };
    const details = {
      ...active.details,
      undoEntries: active.details.undoEntries.map((entry) => ({ ...entry })),
    };
    this.enqueueWrite(async () => {
      await this.store.put(summary, details);
      this.emit({ type: "records", operationId: summary.id });
    });
  }

  private enqueueWrite(task: () => Promise<void>): void {
    this.writeQueue = this.writeQueue.then(task, task).catch(() => undefined);
  }

  private entryId(entry: UndoEntry): string {
    const object = entry as unknown as object;
    let id = this.entryIds.get(object);
    if (!id) {
      id = createId();
      this.entryIds.set(object, id);
    }
    return id;
  }

  private captureUndoSnapshot(project: ModelProject | null, indexOverride?: number): RuntimeUndoSnapshot {
    if (!project) {
      return {
        point: {
          runtimeId: this.runtimeId,
          projectId: null,
          projectName: null,
          projectRole: null,
          index: 0,
          total: 0,
          prefixHash: hashUndoPrefix([]),
          appliedEntryId: null,
          redoEntryId: null,
        },
        entryIds: [],
      };
    }
    const history = project.undo?.history ?? [];
    const entryIds = history.map((entry) => this.entryId(entry));
    const index = Math.max(0, Math.min(history.length, indexOverride ?? project.undo?.index ?? 0));
    return {
      point: {
        runtimeId: this.runtimeId,
        projectId: project.uuid,
        projectName: project.name || "Untitled",
        projectRole: getProjectRole(project),
        index,
        total: history.length,
        prefixHash: hashUndoPrefix(entryIds.slice(0, index)),
        appliedEntryId: index > 0 ? entryIds[index - 1] ?? null : null,
        redoEntryId: index < entryIds.length ? entryIds[index] ?? null : null,
      },
      entryIds,
    };
  }

  private getOwnership(projectId: string): Map<string, UndoOwnership> {
    let ownership = this.ownershipByProject.get(projectId);
    if (!ownership) {
      ownership = new Map<string, UndoOwnership>();
      this.ownershipByProject.set(projectId, ownership);
    }
    return ownership;
  }

  private retentionLimit(): number {
    return getAuditRetention();
  }

  private findActiveForProject(projectId: string): ActiveOperation | undefined {
    for (let index = this.activeOrder.length - 1; index >= 0; index -= 1) {
      const active = this.activeOperations.get(this.activeOrder[index]);
      if (
        active?.trackNativeEvents &&
        (active.beforeRuntime.point.projectId === projectId || active.summary.projectId === projectId)
      ) {
        return active;
      }
    }
    return undefined;
  }

  private onFinishedEdit(): void {
    const project = Project ?? null;
    if (!project) return;
    const history = project.undo?.history ?? [];
    const index = project.undo?.index ?? 0;
    const entry = history[index - 1];
    if (!entry) return;
    const entryId = this.entryId(entry);
    const active = this.findActiveForProject(project.uuid);
    if (active) {
      active.observedEntryIds.add(entryId);
      this.getOwnership(project.uuid).set(entryId, {
        source: active.summary.source,
        operationId: active.summary.id,
      });
      return;
    }

    this.getOwnership(project.uuid).set(entryId, { source: "user" });
  }

  private describeEntries(
    projectId: string | null,
    snapshot: RuntimeUndoSnapshot,
    entryIds: ReadonlySet<string>
  ): AuditUndoEntryDetail[] {
    if (!projectId || entryIds.size === 0) return [];
    const project = ModelProject.all.find((candidate) => candidate.uuid === projectId);
    if (!project) return [];
    const ownership = this.getOwnership(projectId);
    const details: AuditUndoEntryDetail[] = [];
    project.undo.history.forEach((entry, index) => {
      const id = snapshot.entryIds[index] ?? this.entryId(entry);
      if (!entryIds.has(id)) return;
      details.push({
        id,
        action: entry.action || "unnamed edit",
        type: entry.type || "edit",
        time: entry.time || 0,
        ownerSource: ownership.get(id)?.source ?? "unknown",
      });
    });
    return details;
  }

  async planTravel(operationId: string, phase: "before" | "after"): Promise<AuditTravelPlan> {
    const summary = await this.store.getSummary(operationId);
    if (!summary) return this.invalidPlan(operationId, phase, "Audit operation not found.");
    const targetPoint = phase === "before" ? summary.before : summary.after;
    if (!targetPoint.projectId) {
      return this.invalidPlan(operationId, phase, "This operation is not attached to a model project.");
    }
    if (targetPoint.runtimeId !== this.runtimeId || summary.runtimeId !== this.runtimeId) {
      return this.invalidPlan(
        operationId,
        phase,
        "This restore point expired after the plugin or Blockbench restarted.",
        targetPoint
      );
    }
    const project = ModelProject.all.find((candidate) => candidate.uuid === targetPoint.projectId);
    if (!project) {
      return this.invalidPlan(operationId, phase, "The model project is no longer open.", targetPoint);
    }
    const current = this.captureUndoSnapshot(project);
    const ownership = this.getOwnership(project.uuid);
    const check = checkUndoTravel({
      currentEntryIds: current.entryIds,
      currentIndex: current.point.index,
      targetIndex: targetPoint.index,
      targetPrefixHash: targetPoint.prefixHash,
      ownership,
    });
    const unsafeActions = check.unsafeEntryIds.map((entryId) => {
      const index = current.entryIds.indexOf(entryId);
      return project.undo.history[index]?.action || "unknown edit";
    });
    return {
      operationId,
      phase,
      valid: check.compatible,
      reason: check.reason,
      projectId: project.uuid,
      projectName: project.name || "Untitled",
      currentIndex: current.point.index,
      targetIndex: targetPoint.index,
      direction: check.direction,
      steps: check.steps,
      unsafeCount: check.unsafeEntryIds.length,
      unsafeActions,
    };
  }

  async applyTravel(
    operationId: string,
    phase: "before" | "after",
    allowUnsafe = false
  ): Promise<AuditTravelPlan> {
    const plan = await this.planTravel(operationId, phase);
    if (!plan.valid) throw new Error(plan.reason || "This history state is no longer available.");
    if (plan.unsafeCount > 0 && !allowUnsafe) throw new AuditConfirmationRequiredError(plan);
    if (!plan.projectId) throw new Error("The history record has no model project.");
    const project = ModelProject.all.find((candidate) => candidate.uuid === plan.projectId);
    if (!project) throw new Error("The model project is no longer open.");
    if (!project.selected && !project.select()) {
      throw new Error(`Blockbench refused to select model \"${project.name}\".`);
    }
    if (plan.steps === 0) return plan;

    const handle = this.beginOperation({
      source: "panel",
      toolName: `audit_restore_${phase}`,
      title: `${phase === "before" ? "Restore before" : "Restore after"} recorded operation`,
      args: { operationId, phase, allowUnsafe },
      readOnly: false,
      trackNativeEvents: true,
    });
    try {
      for (let step = 0; step < plan.steps; step += 1) {
        if (plan.direction === "undo") project.undo.undo();
        else if (plan.direction === "redo") project.undo.redo();
      }
      if (project.undo.index !== plan.targetIndex) {
        throw new Error(
          "Blockbench stopped before reaching the requested restore point."
        );
      }
      this.finishOperation(handle, {
        project: project.name,
        direction: plan.direction,
        steps: plan.steps,
        targetIndex: plan.targetIndex,
      });
      return plan;
    } catch (error) {
      this.finishOperation(handle, undefined, error);
      throw error;
    }
  }

  private invalidPlan(
    operationId: string,
    phase: "before" | "after",
    reason: string,
    point?: AuditUndoPoint
  ): AuditTravelPlan {
    return {
      operationId,
      phase,
      valid: false,
      reason,
      projectId: point?.projectId ?? null,
      projectName: point?.projectName ?? null,
      currentIndex: 0,
      targetIndex: point?.index ?? 0,
      direction: "none",
      steps: 0,
      unsafeCount: 0,
      unsafeActions: [],
    };
  }
}

export const auditManager = new AuditManager();
