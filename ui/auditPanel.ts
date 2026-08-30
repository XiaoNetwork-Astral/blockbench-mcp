/// <reference types="blockbench-types" />
import {
  AuditConfirmationRequiredError,
  auditManager,
  type AuditChange,
  type AuditOperationDetails,
  type AuditOperationSummary,
  type AuditStatus,
  type AuditTravelPlan,
} from "@/lib/audit";
import { PLUGIN_ID, SETTINGS_CATEGORY_ID } from "@/lib/constants";
import type { IMCPTool } from "@/types";
import { getProjectRole } from "@/lib/projectRoles";
import {
  getAuditDefaultScope,
  getAuditPageSize,
} from "@/lib/pluginSettings";
import auditPanelCss from "@/ui/auditPanel.css";
import auditPanelTemplate from "@/ui/auditPanel.html";

let panel: EventfulPanel | undefined;
let showAction: Action | undefined;
let cssHandle: Deletable | undefined;
let rawDataDialog: Dialog | undefined;
let movedToListener: Deletable | undefined;
let layoutTimer: ReturnType<typeof setTimeout> | undefined;
let sidebarResizeObserver: ResizeObserver | undefined;
let sidebarMutationObserver: MutationObserver | undefined;
const AUDIT_PANEL_LAYOUT_EPSILON = 8;

type ProjectScope = "current" | "all" | string;
type EventfulPanel = Panel & {
  on(event: string, callback: () => void): Deletable;
};
const NO_PROJECT_SCOPE = "__blockbench_mcp_no_project__";

interface AuditPanelProject {
  id: string;
  name: string;
  role: string;
}

interface AuditPanelVm {
  items: AuditOperationSummary[];
  details: Record<string, AuditOperationDetails | null>;
  expanded: Record<string, boolean>;
  loading: boolean;
  error: string;
  page: number;
  pageSize: number;
  hasPrevious: boolean;
  hasNext: boolean;
  projectScope: ProjectScope;
  projects: AuditPanelProject[];
  filters: { search: string; toolName: string };
  toolOptions: Array<{ name: string; label: string; title: string }>;
  rawDataLoading: Record<string, boolean>;
  loadRevision: number;
  searchTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  unsubscribeAudit: (() => void) | null;
  timelineProjectId: string | null;
  timelineUndoIndex: number | null;
  timelineAnchorId: string | null;
  timelineAnchorPhase: "before" | "after" | null;
  readonly viewingAllProjects: boolean;
  readonly currentProjectLabel: string;
  readonly timelineStates: Record<string, AuditTimelineState>;
  $nextTick(callback: () => void): void;
  $set(target: Record<string, unknown>, key: string, value: unknown): void;
  applyAuditSettings(): void;
  refreshProjects(): void;
  scheduleRefresh(delay?: number): void;
  onSearchInput(): void;
  onFilterChanged(): void;
  loadPage(): Promise<void>;
  toggleDetails(item: AuditOperationSummary): void;
  showRawData(item: AuditOperationSummary): Promise<void>;
  refreshTimelineCursor(): void;
  timelineState(item: AuditOperationSummary): AuditTimelineState;
  statusLabel(status: AuditStatus): string;
  canRestore(item: AuditOperationSummary): boolean;
}

export type AuditTimelineState = "applied" | "current" | "undone";

export interface AuditTimelineAnchor {
  id: string;
  phase: "before" | "after";
}

export function buildAuditTimelineStates(
  items: AuditOperationSummary[],
  projectId: string | null,
  currentUndoIndex: number | null,
  anchor: AuditTimelineAnchor | null = null
): Record<string, AuditTimelineState> {
  const states: Record<string, AuditTimelineState> = {};
  let foundCurrent = false;

  const anchorIndex = anchor
    ? items.findIndex((item) => item.id === anchor.id && item.projectId === projectId)
    : -1;
  if (anchorIndex >= 0) {
    const currentIndex = anchor?.phase === "after"
      ? anchorIndex
      : items.findIndex((item, index) => index > anchorIndex && item.projectId === projectId);

    for (const [index, item] of items.entries()) {
      if (!projectId || item.projectId !== projectId) {
        states[item.id] = "applied";
      } else if (currentIndex >= 0 && index === currentIndex) {
        states[item.id] = "current";
      } else if (currentIndex < 0 || index < currentIndex) {
        // Everything newer than the selected boundary is visually undone,
        // including read-only, failed, and otherwise non-reversible records.
        states[item.id] = "undone";
      } else {
        states[item.id] = "applied";
      }
    }
    return states;
  }

  for (const item of items) {
    if (!projectId || currentUndoIndex === null || item.projectId !== projectId) {
      states[item.id] = "applied";
      continue;
    }

    // Use the state after each operation. This also puts read-only and failed
    // operations on the same visual timeline as reversible edits: if they ran
    // beyond the current native Undo cursor, they are shown as undone too.
    if (item.after.index > currentUndoIndex) {
      states[item.id] = "undone";
      continue;
    }

    if (!foundCurrent) {
      states[item.id] = "current";
      foundCurrent = true;
      continue;
    }

    states[item.id] = "applied";
  }

  return states;
}

function selectedProject(): ModelProject | null {
  if (typeof Project !== "undefined" && Project) return Project;
  if (typeof ModelProject === "undefined") return null;
  return ModelProject.all.find((project) => project.selected) ?? null;
}

function currentProjectId(): string | null {
  return selectedProject()?.uuid ?? null;
}

function projectOptions(): AuditPanelProject[] {
  const projects = typeof ModelProject === "undefined" ? [] : ModelProject.all;
  return projects.map((project) => ({
    id: project.uuid,
    name: project.name || tl("mcp.audit.untitled"),
    role: getProjectRole(project),
  }));
}

function selectedScopeProjectId(scope: ProjectScope): string | "all" {
  if (scope === "all") return "all";
  if (scope === "current") return currentProjectId() ?? NO_PROJECT_SCOPE;
  return scope;
}

function configuredPageSize(): number {
  return getAuditPageSize();
}

function configuredProjectScope(): ProjectScope {
  return getAuditDefaultScope();
}

function timelineCursor(scope: ProjectScope): { projectId: string | null; undoIndex: number | null } {
  const scopeId = selectedScopeProjectId(scope);
  if (scopeId === "all" || scopeId === NO_PROJECT_SCOPE) {
    return { projectId: null, undoIndex: null };
  }
  const project = ModelProject.all.find((candidate) => candidate.uuid === scopeId);
  return {
    projectId: project?.uuid ?? null,
    undoIndex: project?.undo?.index ?? null,
  };
}

export function hasRecoverableAuditPanelSlack(
  sidebarHeight: number,
  visiblePanelHeights: readonly number[],
  fixedHeight: boolean
): boolean {
  if (!fixedHeight || sidebarHeight <= 0) return false;
  const occupiedHeight = visiblePanelHeights.reduce(
    (total, height) => total + Math.max(0, height),
    0
  );
  return sidebarHeight - occupiedHeight > AUDIT_PANEL_LAYOUT_EPSILON;
}

function releaseConstrainedAuditPanelHeight(): void {
  if (!panel || !panel.isInSidebar() || panel.attached_to || panel.folded || !panel.fixed_height) return;
  const sidebar = panel.container.parentElement;
  if (!sidebar || !sidebar.clientHeight) return;

  const visiblePanelHeights = Array.from(sidebar.children)
    .filter((child): child is HTMLElement =>
      child instanceof HTMLElement &&
      !child.classList.contains("hidden") &&
      child.getBoundingClientRect().height > 0
    )
    .map((child) => child.getBoundingClientRect().height);
  if (!hasRecoverableAuditPanelSlack(sidebar.clientHeight, visiblePanelHeights, true)) return;

  // Blockbench pins a fixed-height bottom panel below any unused flex space.
  // Releasing the override lets this growable panel consume newly available
  // sidebar height without requiring an undock/redock cycle.
  panel.customizePosition({ fixed_height: false });
  panel.update();
}

function scheduleAuditPanelLayout(): void {
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    layoutTimer = undefined;
    releaseConstrainedAuditPanelHeight();
  }, 0);
}

function disconnectAuditPanelLayoutObservers(): void {
  sidebarResizeObserver?.disconnect();
  sidebarResizeObserver = undefined;
  sidebarMutationObserver?.disconnect();
  sidebarMutationObserver = undefined;
}

function observeAuditPanelSidebar(): void {
  disconnectAuditPanelLayoutObservers();
  if (!panel || !panel.isInSidebar() || panel.attached_to) return;
  const sidebar = panel.container.parentElement;
  if (!sidebar) return;

  if (typeof ResizeObserver !== "undefined") {
    sidebarResizeObserver = new ResizeObserver(scheduleAuditPanelLayout);
    sidebarResizeObserver.observe(sidebar);
  }
  if (typeof MutationObserver !== "undefined") {
    sidebarMutationObserver = new MutationObserver((records) => {
      const ownContainer = panel?.container;
      if (records.some((record) => !ownContainer?.contains(record.target))) {
        scheduleAuditPanelLayout();
      }
    });
    sidebarMutationObserver.observe(sidebar, {
      attributes: true,
      attributeFilter: ["class", "style"],
      childList: true,
      subtree: true,
    });
  }
}

function handleAuditPanelMoved(): void {
  observeAuditPanelSidebar();
  scheduleAuditPanelLayout();
}

function showPanel(): void {
  if (!selectedProject()) {
    Blockbench.showMessageBox({
      title: tl("mcp.audit.open_project_title"),
      message: tl("mcp.audit.open_project_message"),
      icon: "info",
      buttons: ["dialog.ok"],
    });
    return;
  }
  if (!panel) return;
  if (panel.slot === "hidden") {
    const previous = panel.previous_slot;
    panel.moveTo(previous && previous !== "hidden" ? previous : "right_bar");
  }
  panel.fold(false);
  panel.selectTab();
  panel.moveToFront();
}

function hidePanel(): void {
  panel?.moveTo("hidden");
}

function confirmMessage(options: MessageBoxOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Blockbench.showMessageBox(
      {
        confirm: 0,
        cancel: 1,
        ...options,
      },
      (button) => resolve(button === 0)
    );
  });
}

function unsafeTravelMessage(plan: AuditTravelPlan): string {
  const examples = plan.unsafeActions
    .slice(0, 4)
    .map((action) => `• ${action}`)
    .join("\n");
  const omitted = Math.max(0, plan.unsafeActions.length - 4);
  return [
    tl("mcp.audit.confirm_cross_manual", [plan.unsafeCount, plan.projectName ?? ""]),
    examples,
    omitted > 0 ? tl("mcp.audit.more_edits", [omitted]) : "",
    tl("mcp.audit.confirm_cross_manual_tail"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseStoredAuditValue(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function buildAuditRawData(
  item: AuditOperationSummary,
  details: AuditOperationDetails
): Record<string, unknown> {
  return {
    operation: {
      id: item.id,
      title: item.title,
      toolName: item.toolName,
      source: item.source,
      status: item.status,
      startedAt: new Date(item.startedAt).toISOString(),
      finishedAt: item.finishedAt === null ? null : new Date(item.finishedAt).toISOString(),
      durationMs: item.durationMs,
      readOnly: item.readOnly,
    },
    model: item.projectId
      ? {
          id: item.projectId,
          name: item.projectName,
          role: item.projectRole,
        }
      : null,
    sanitized: {
      arguments: parseStoredAuditValue(details.argumentsText),
      result: parseStoredAuditValue(details.resultText),
      error: parseStoredAuditValue(details.errorText),
    },
    undo: {
      reversible: item.reversible,
      changedEntryCount: item.undoEntryCount,
      before: item.before,
      after: item.after,
      entries: details.undoEntries,
    },
  };
}

function showRawDataDialog(item: AuditOperationSummary, details: AuditOperationDetails): void {
  rawDataDialog?.delete();
  rawDataDialog = new Dialog({
    id: "blockbench_mcp_audit_raw_data",
    title: tl("mcp.audit.raw_data_title"),
    icon: "data_object",
    width: 720,
    resizable: "xy",
    component: {
      name: "blockbench_mcp_audit_raw_data",
      data: () => ({
        note: tl("mcp.audit.raw_data_note"),
        jsonText: JSON.stringify(buildAuditRawData(item, details), null, 2),
      }),
      template: `
        <div class="blockbench-audit-raw-dialog">
          <p>{{note}}</p>
          <pre>{{jsonText}}</pre>
        </div>
      `,
    },
    singleButton: true,
    buttons: [tl("mcp.dialog.close")],
  });
  rawDataDialog.show();
}

export function auditPanelSetup(tools: Record<string, IMCPTool>): Panel {
  if (panel) return panel;
  cssHandle = Blockbench.addCSS(auditPanelCss);

  panel = new Panel("blockbench_mcp_audit_panel", {
    id: "blockbench_mcp_audit_panel",
    plugin: PLUGIN_ID,
    icon: "manage_history",
    name: tl("mcp.audit.panel_name"),
    optional: true,
    default_side: "right",
    default_position: {
      slot: "right_bar",
      height: 430,
      folded: false,
      sidebar_index: 10,
    },
    growable: true,
    resizable: true,
    min_height: 180,
    expand_button: true,
    component: {
      name: "blockbench_mcp_audit_panel",
      data: () => ({
        items: [] as AuditOperationSummary[],
        details: {} as Record<string, AuditOperationDetails | null>,
        expanded: {} as Record<string, boolean>,
        loading: true,
        error: "",
        page: 0,
        pageSize: configuredPageSize(),
        hasPrevious: false,
        hasNext: false,
        projectScope: configuredProjectScope(),
        projects: projectOptions(),
        filters: {
          search: "",
          toolName: "all",
        },
        toolOptions: Object.values(tools)
          .map((tool) => ({
            name: tool.name,
            label: tool.name,
            title: tool.description || tool.name,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        rawDataLoading: {} as Record<string, boolean>,
        loadRevision: 0,
        searchTimer: null as ReturnType<typeof setTimeout> | null,
        refreshTimer: null as ReturnType<typeof setTimeout> | null,
        unsubscribeAudit: null as (() => void) | null,
        timelineProjectId: null as string | null,
        timelineUndoIndex: null as number | null,
        timelineAnchorId: null as string | null,
        timelineAnchorPhase: null as "before" | "after" | null,
      }),
      computed: {
        viewingAllProjects(this: AuditPanelVm): boolean {
          return this.projectScope === "all";
        },
        currentProjectLabel(this: AuditPanelVm): string {
          const project = selectedProject();
          return project?.name
            ? tl("mcp.audit.current_model_named", [project.name])
            : tl("mcp.audit.current_model");
        },
        timelineStates(this: AuditPanelVm): Record<string, AuditTimelineState> {
          const anchor = this.timelineAnchorId && this.timelineAnchorPhase
            ? { id: this.timelineAnchorId, phase: this.timelineAnchorPhase }
            : null;
          return buildAuditTimelineStates(this.items, this.timelineProjectId, this.timelineUndoIndex, anchor);
        },
      },
      mounted(this: AuditPanelVm) {
        const vm = this;
        vm.unsubscribeAudit = auditManager.subscribe((change: AuditChange) => {
          if (change.type === "storage") return;
          if (change.type === "settings") {
            vm.applyAuditSettings();
            return;
          }
          if (change.type === "project") {
            vm.timelineAnchorId = null;
            vm.timelineAnchorPhase = null;
            vm.projects = projectOptions();
            if (vm.projectScope === "current") {
              vm.page = 0;
              vm.scheduleRefresh(0);
            }
            return;
          }
          vm.timelineAnchorId = null;
          vm.timelineAnchorPhase = null;
          if (vm.page === 0) vm.scheduleRefresh(120);
        });
        void vm.loadPage();
        vm.$nextTick(scheduleAuditPanelLayout);
      },
      beforeDestroy(this: AuditPanelVm) {
        if (this.unsubscribeAudit) this.unsubscribeAudit();
        if (this.searchTimer) clearTimeout(this.searchTimer);
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
      },
      methods: {
        tl(key: string, variables?: string | number | (string | number)[]): string {
          return tl(key, variables);
        },
        hidePanel,
        openSettings(): void {
          const category = Settings.structure[SETTINGS_CATEGORY_ID];
          if (category) category.open = true;
          Settings.openDialog();
        },
        applyAuditSettings(this: AuditPanelVm): void {
          this.pageSize = configuredPageSize();
          this.projectScope = configuredProjectScope();
          this.timelineAnchorId = null;
          this.timelineAnchorPhase = null;
          this.page = 0;
          void this.loadPage();
        },
        refreshProjects(this: AuditPanelVm): void {
          this.projects = projectOptions();
        },
        scheduleRefresh(this: AuditPanelVm, delay = 180): void {
          if (this.refreshTimer) clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            void this.loadPage();
          }, delay);
        },
        onSearchInput(this: AuditPanelVm): void {
          if (this.searchTimer) clearTimeout(this.searchTimer);
          this.searchTimer = setTimeout(() => {
            this.page = 0;
            void this.loadPage();
          }, 250);
        },
        onFilterChanged(this: AuditPanelVm): void {
          this.page = 0;
          this.details = {};
          this.expanded = {};
          this.timelineAnchorId = null;
          this.timelineAnchorPhase = null;
          void this.loadPage();
        },
        async loadPage(this: AuditPanelVm): Promise<void> {
          const revision = ++this.loadRevision;
          this.loading = true;
          this.error = "";
          try {
            const result = await auditManager.queryPage({
              page: this.page,
              pageSize: Number(this.pageSize),
              search: this.filters.search,
              source: "mcp",
              status: "all",
              toolName: this.filters.toolName,
              projectId: selectedScopeProjectId(this.projectScope),
            });
            if (revision !== this.loadRevision) return;
            this.items = result.items;
            this.refreshTimelineCursor();
            this.hasPrevious = result.hasPrevious;
            this.hasNext = result.hasNext;
          } catch (error) {
            if (revision !== this.loadRevision) return;
            this.error = error instanceof Error ? error.message : String(error);
          } finally {
            if (revision === this.loadRevision) this.loading = false;
          }
        },
        toggleDetails(this: AuditPanelVm, item: AuditOperationSummary): void {
          const isOpen = !this.expanded[item.id];
          this.$set(this.expanded, item.id, isOpen);
        },
        async showRawData(this: AuditPanelVm, item: AuditOperationSummary): Promise<void> {
          if (this.rawDataLoading[item.id]) return;
          this.$set(this.rawDataLoading, item.id, true);
          try {
            let details = this.details[item.id] as AuditOperationDetails | undefined;
            if (!details) {
              details = (await auditManager.getDetails(item.id)) ?? {
                id: item.id,
                argumentsText: "",
                resultText: "",
                errorText: tl("mcp.audit.details_unavailable"),
                undoEntries: [],
              };
              this.$set(this.details, item.id, details);
            }
            showRawDataDialog(item, details);
          } catch (error) {
            Blockbench.showMessageBox({
              title: tl("mcp.audit.raw_data_title"),
              icon: "error",
              message: error instanceof Error ? error.message : String(error),
              buttons: [tl("mcp.audit.ok")],
            });
          } finally {
            this.$set(this.rawDataLoading, item.id, false);
          }
        },
        formatTime(timestamp: number): string {
          return new Date(timestamp).toLocaleString();
        },
        formatDuration(duration: number | null): string {
          if (duration === null) return tl("mcp.audit.running");
          if (duration < 1000) return `${duration} ms`;
          return `${(duration / 1000).toFixed(duration < 10_000 ? 1 : 0)} s`;
        },
        statusLabel(status: AuditStatus): string {
          return tl(`mcp.audit.status_${status}`);
        },
        refreshTimelineCursor(this: AuditPanelVm): void {
          const cursor = timelineCursor(this.projectScope);
          this.timelineProjectId = cursor.projectId;
          this.timelineUndoIndex = cursor.undoIndex;
        },
        timelineState(this: AuditPanelVm, item: AuditOperationSummary): AuditTimelineState {
          return this.timelineStates[item.id] ?? "applied";
        },
        timelineLabel(this: AuditPanelVm, item: AuditOperationSummary): string {
          const state = this.timelineState(item);
          if (state === "current") return tl("mcp.audit.timeline_current");
          if (state === "undone") return tl("mcp.audit.timeline_undone");
          return this.statusLabel(item.status);
        },
        canRestore(this: AuditPanelVm, item: AuditOperationSummary): boolean {
          // The all-model view is intentionally search-only: every history
          // action must occur inside one explicitly selected model timeline.
          if (this.projectScope === "all") return false;
          return Boolean(item.reversible && item.projectId === selectedScopeProjectId(this.projectScope));
        },
        async restore(
          this: AuditPanelVm,
          item: AuditOperationSummary,
          phase: "before" | "after"
        ): Promise<void> {
          if (!this.canRestore(item)) return;
          let restored = false;
          try {
            const plan = await auditManager.applyTravel(item.id, phase, false);
            restored = true;
            if (plan.steps === 0) {
              Blockbench.showQuickMessage(tl("mcp.audit.already_at_state"), 2200);
            } else {
              Blockbench.showQuickMessage(
                tl("mcp.audit.restored_steps", [plan.projectName ?? "", plan.steps]),
                3200
              );
            }
          } catch (error) {
            if (error instanceof AuditConfirmationRequiredError) {
              const confirmed = await confirmMessage({
                title: tl("mcp.audit.confirm_title"),
                icon: "warning",
                message: unsafeTravelMessage(error.plan),
                buttons: [tl("mcp.audit.continue"), tl("mcp.dialog.cancel")],
              });
              if (!confirmed) return;
              try {
                await auditManager.applyTravel(item.id, phase, true);
                restored = true;
                Blockbench.showQuickMessage(
                  tl("mcp.audit.restored_steps", [error.plan.projectName ?? "", error.plan.steps]),
                  3200
                );
              } catch (confirmedError) {
                Blockbench.showMessageBox({
                  title: tl("mcp.audit.restore_failed"),
                  icon: "error",
                  message: confirmedError instanceof Error ? confirmedError.message : String(confirmedError),
                  buttons: [tl("mcp.audit.ok")],
                });
              }
            } else {
              Blockbench.showMessageBox({
                title: tl("mcp.audit.restore_failed"),
                icon: "error",
                message: error instanceof Error ? error.message : String(error),
                buttons: [tl("mcp.audit.ok")],
              });
            }
          } finally {
            if (restored) {
              // Preserve the exact chronological boundary selected by the
              // user; native Undo indices alone cannot order read-only calls
              // that share an index with a reversible edit.
              this.timelineAnchorId = item.id;
              this.timelineAnchorPhase = phase;
            }
            this.projects = projectOptions();
            await this.loadPage();
          }
        },
        previousPage(this: AuditPanelVm): void {
          if (!this.hasPrevious) return;
          this.page -= 1;
          void this.loadPage();
        },
        nextPage(this: AuditPanelVm): void {
          if (!this.hasNext) return;
          this.page += 1;
          void this.loadPage();
        },
        async clearHistory(this: AuditPanelVm): Promise<void> {
          const confirmed = await confirmMessage({
            title: tl("mcp.audit.clear_title"),
            icon: "delete_sweep",
            message: tl("mcp.audit.clear_message"),
            buttons: [tl("mcp.audit.clear"), tl("mcp.dialog.cancel")],
          });
          if (!confirmed) return;
          await auditManager.clearHistory();
          this.page = 0;
          this.details = {};
          this.expanded = {};
          await this.loadPage();
        },
      },
      template: auditPanelTemplate,
    },
  }) as EventfulPanel;

  movedToListener = panel.on("moved_to", handleAuditPanelMoved);
  observeAuditPanelSidebar();
  scheduleAuditPanelLayout();

  showAction = new Action("blockbench_mcp_show_audit_panel", {
    name: tl("mcp.audit.show_panel"),
    description: tl("mcp.audit.show_panel_description"),
    icon: "manage_history",
    click: showPanel,
  });
  MenuBar.menus.tools.addAction(showAction);
  return panel;
}

export function auditPanelTeardown(): void {
  movedToListener?.delete();
  movedToListener = undefined;
  disconnectAuditPanelLayoutObservers();
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = undefined;
  rawDataDialog?.delete();
  rawDataDialog = undefined;
  showAction?.delete();
  showAction = undefined;
  panel?.delete();
  panel = undefined;
  cssHandle?.delete();
  cssHandle = undefined;
}

export { showPanel as showAuditPanel };
