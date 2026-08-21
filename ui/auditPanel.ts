/// <reference types="blockbench-types" />
import {
  AuditConfirmationRequiredError,
  auditManager,
  type AuditChange,
  type AuditOperationDetails,
  type AuditOperationSummary,
  type AuditSource,
  type AuditStatus,
  type AuditTravelPlan,
} from "@/lib/audit";
import type { IMCPTool } from "@/types";
import { getProjectRole } from "@/lib/projectRoles";
import {
  getAuditDefaultScope,
  getAuditDefaultSource,
  getAuditPageSize,
} from "@/lib/pluginSettings";
import auditPanelCss from "@/ui/auditPanel.css";
import auditPanelTemplate from "@/ui/auditPanel.html";

let panel: Panel | undefined;
let showAction: Action | undefined;
let cssHandle: Deletable | undefined;

type ProjectScope = "current" | "all" | string;
const NO_PROJECT_SCOPE = "__codex_no_project__";

interface AuditPanelProject {
  id: string;
  name: string;
  role: string;
}

function currentProjectId(): string | null {
  return Project?.uuid ?? null;
}

function projectOptions(): AuditPanelProject[] {
  return ModelProject.all.map((project) => ({
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

function configuredSource(): AuditSource | "all" {
  return getAuditDefaultSource();
}

function showPanel(): void {
  if (typeof Project === "undefined" || !Project) {
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

export function auditPanelSetup(tools: Record<string, IMCPTool>): Panel {
  if (panel) return panel;
  cssHandle = Blockbench.addCSS(auditPanelCss);

  panel = new Panel("codex_mcp_audit_panel", {
    id: "codex_mcp_audit_panel",
    plugin: "codex_blockbench_mcp",
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
      name: "codex_mcp_audit_panel",
      data: () => ({
        items: [] as AuditOperationSummary[],
        details: {} as Record<string, AuditOperationDetails | null>,
        expanded: {} as Record<string, boolean>,
        loading: false,
        error: "",
        storagePersistent: auditManager.isPersistent(),
        storageMessage: "",
        page: 0,
        pageSize: configuredPageSize(),
        hasPrevious: false,
        hasNext: false,
        projectScope: configuredProjectScope(),
        projects: projectOptions(),
        filters: {
          search: "",
          source: configuredSource(),
          status: "all" as AuditStatus | "all",
          toolName: "all",
        },
        toolOptions: [
          ...Object.values(tools).map((tool) => ({
            name: tool.name,
            label: tool.name,
            title: tool.description || tool.name,
          })),
          { name: "blockbench_manual_edit", label: tl("mcp.audit.manual_edit"), title: tl("mcp.audit.manual_edit") },
          { name: "blockbench_manual_undo", label: tl("mcp.audit.manual_undo"), title: tl("mcp.audit.manual_undo") },
          { name: "blockbench_manual_redo", label: tl("mcp.audit.manual_redo"), title: tl("mcp.audit.manual_redo") },
          { name: "audit_restore_before", label: tl("mcp.audit.restore_before"), title: tl("mcp.audit.restore_before_help") },
          { name: "audit_restore_after", label: tl("mcp.audit.restore_after"), title: tl("mcp.audit.restore_after_help") },
        ].sort((left, right) => left.name.localeCompare(right.name)),
        loadRevision: 0,
        searchTimer: null as ReturnType<typeof setTimeout> | null,
        refreshTimer: null as ReturnType<typeof setTimeout> | null,
        unsubscribeAudit: null as (() => void) | null,
      }),
      computed: {
        viewingAllProjects(): boolean {
          // @ts-ignore - Vue component context
          return this.projectScope === "all";
        },
        activeProjectName(): string {
          // @ts-ignore - Vue component context
          const scope = this.projectScope as ProjectScope;
          if (scope === "all") return tl("mcp.audit.all_models");
          if (scope === "current") return Project?.name || tl("mcp.audit.no_model");
          // @ts-ignore - Vue component context
          return this.projects.find((item: AuditPanelProject) => item.id === scope)?.name || scope;
        },
      },
      mounted() {
        // @ts-ignore - Vue component context
        const vm = this;
        vm.unsubscribeAudit = auditManager.subscribe((change: AuditChange) => {
          if (change.type === "storage") {
            vm.storagePersistent = change.persistent;
            vm.storageMessage = change.message || "";
            return;
          }
          if (change.type === "settings") {
            vm.applyAuditSettings();
            return;
          }
          if (change.type === "project") {
            vm.projects = projectOptions();
            if (vm.projectScope === "current") {
              vm.page = 0;
              vm.scheduleRefresh(0);
            }
            return;
          }
          if (vm.page === 0) vm.scheduleRefresh(120);
        });
        void vm.loadPage();
      },
      beforeDestroy() {
        // @ts-ignore - Vue component context
        if (this.unsubscribeAudit) this.unsubscribeAudit();
        // @ts-ignore - Vue component context
        if (this.searchTimer) clearTimeout(this.searchTimer);
        // @ts-ignore - Vue component context
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
      },
      methods: {
        tl(key: string, variables?: string | number | (string | number)[]): string {
          return tl(key, variables);
        },
        hidePanel,
        openSettings(): void {
          const category = Settings.structure.codex_blockbench_mcp;
          if (category) category.open = true;
          Settings.openDialog();
        },
        applyAuditSettings(): void {
          // @ts-ignore - Vue component context
          this.pageSize = configuredPageSize();
          // @ts-ignore - Vue component context
          this.projectScope = configuredProjectScope();
          // @ts-ignore - Vue component context
          this.filters.source = configuredSource();
          // @ts-ignore - Vue component context
          this.page = 0;
          // @ts-ignore - Vue component context
          void this.loadPage();
        },
        refreshProjects(): void {
          // @ts-ignore - Vue component context
          this.projects = projectOptions();
        },
        scheduleRefresh(delay = 180): void {
          // @ts-ignore - Vue component context
          if (this.refreshTimer) clearTimeout(this.refreshTimer);
          // @ts-ignore - Vue component context
          this.refreshTimer = setTimeout(() => {
            // @ts-ignore - Vue component context
            this.refreshTimer = null;
            // @ts-ignore - Vue component context
            void this.loadPage();
          }, delay);
        },
        onSearchInput(): void {
          // @ts-ignore - Vue component context
          if (this.searchTimer) clearTimeout(this.searchTimer);
          // @ts-ignore - Vue component context
          this.searchTimer = setTimeout(() => {
            // @ts-ignore - Vue component context
            this.page = 0;
            // @ts-ignore - Vue component context
            void this.loadPage();
          }, 250);
        },
        onFilterChanged(): void {
          // @ts-ignore - Vue component context
          this.page = 0;
          // @ts-ignore - Vue component context
          this.details = {};
          // @ts-ignore - Vue component context
          this.expanded = {};
          // @ts-ignore - Vue component context
          void this.loadPage();
        },
        async loadPage(): Promise<void> {
          // @ts-ignore - Vue component context
          const revision = ++this.loadRevision;
          // @ts-ignore - Vue component context
          this.loading = true;
          // @ts-ignore - Vue component context
          this.error = "";
          try {
            // @ts-ignore - Vue component context
            const result = await auditManager.queryPage({
              // @ts-ignore - Vue component context
              page: this.page,
              // @ts-ignore - Vue component context
              pageSize: Number(this.pageSize),
              // @ts-ignore - Vue component context
              search: this.filters.search,
              // @ts-ignore - Vue component context
              source: this.filters.source,
              // @ts-ignore - Vue component context
              status: this.filters.status,
              // @ts-ignore - Vue component context
              toolName: this.filters.toolName,
              // @ts-ignore - Vue component context
              projectId: selectedScopeProjectId(this.projectScope),
            });
            // @ts-ignore - Vue component context
            if (revision !== this.loadRevision) return;
            // @ts-ignore - Vue component context
            this.items = result.items;
            // @ts-ignore - Vue component context
            this.hasPrevious = result.hasPrevious;
            // @ts-ignore - Vue component context
            this.hasNext = result.hasNext;
          } catch (error) {
            // @ts-ignore - Vue component context
            if (revision !== this.loadRevision) return;
            // @ts-ignore - Vue component context
            this.error = error instanceof Error ? error.message : String(error);
          } finally {
            // @ts-ignore - Vue component context
            if (revision === this.loadRevision) this.loading = false;
          }
        },
        async toggleDetails(item: AuditOperationSummary): Promise<void> {
          // @ts-ignore - Vue component context
          const isOpen = !this.expanded[item.id];
          // @ts-ignore - Vue component context
          this.$set(this.expanded, item.id, isOpen);
          // @ts-ignore - Vue component context
          if (!isOpen || this.details[item.id] !== undefined) return;
          // @ts-ignore - Vue component context
          this.$set(this.details, item.id, null);
          const details = await auditManager.getDetails(item.id);
          // @ts-ignore - Vue component context
          this.$set(this.details, item.id, details ?? {
            id: item.id,
            argumentsText: "",
            resultText: "",
            errorText: tl("mcp.audit.details_unavailable"),
            undoEntries: [],
          });
        },
        formatTime(timestamp: number): string {
          return new Date(timestamp).toLocaleString();
        },
        formatDuration(duration: number | null): string {
          if (duration === null) return tl("mcp.audit.running");
          if (duration < 1000) return `${duration} ms`;
          return `${(duration / 1000).toFixed(duration < 10_000 ? 1 : 0)} s`;
        },
        sourceLabel(source: AuditSource | "unknown"): string {
          return tl(`mcp.audit.source_${source}`);
        },
        statusLabel(status: AuditStatus): string {
          return tl(`mcp.audit.status_${status}`);
        },
        canRestore(item: AuditOperationSummary): boolean {
          // The all-model view is intentionally search-only: every history
          // action must occur inside one explicitly selected model timeline.
          // @ts-ignore - Vue component context
          if (this.projectScope === "all") return false;
          // @ts-ignore - Vue component context
          return Boolean(item.reversible && item.projectId === selectedScopeProjectId(this.projectScope));
        },
        async restore(item: AuditOperationSummary, phase: "before" | "after"): Promise<void> {
          // @ts-ignore - Vue component context
          if (!this.canRestore(item)) return;
          try {
            const plan = await auditManager.applyTravel(item.id, phase, false);
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
            // @ts-ignore - Vue component context
            this.projects = projectOptions();
            // @ts-ignore - Vue component context
            this.page = 0;
            // @ts-ignore - Vue component context
            await this.loadPage();
          }
        },
        previousPage(): void {
          // @ts-ignore - Vue component context
          if (!this.hasPrevious) return;
          // @ts-ignore - Vue component context
          this.page -= 1;
          // @ts-ignore - Vue component context
          void this.loadPage();
        },
        nextPage(): void {
          // @ts-ignore - Vue component context
          if (!this.hasNext) return;
          // @ts-ignore - Vue component context
          this.page += 1;
          // @ts-ignore - Vue component context
          void this.loadPage();
        },
        async clearHistory(): Promise<void> {
          const confirmed = await confirmMessage({
            title: tl("mcp.audit.clear_title"),
            icon: "delete_sweep",
            message: tl("mcp.audit.clear_message"),
            buttons: [tl("mcp.audit.clear"), tl("mcp.dialog.cancel")],
          });
          if (!confirmed) return;
          await auditManager.clearHistory();
          // @ts-ignore - Vue component context
          this.page = 0;
          // @ts-ignore - Vue component context
          this.details = {};
          // @ts-ignore - Vue component context
          this.expanded = {};
          // @ts-ignore - Vue component context
          await this.loadPage();
        },
      },
      template: auditPanelTemplate,
    },
  });

  showAction = new Action("codex_blockbench_mcp_show_audit_panel", {
    name: tl("mcp.audit.show_panel"),
    description: tl("mcp.audit.show_panel_description"),
    icon: "manage_history",
    click: showPanel,
  });
  MenuBar.menus.tools.addAction(showAction);
  return panel;
}

export function auditPanelTeardown(): void {
  showAction?.delete();
  showAction = undefined;
  panel?.delete();
  panel = undefined;
  cssHandle?.delete();
  cssHandle = undefined;
}

export { showPanel as showAuditPanel };
