/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  createToolGroup,
  createToolGroupParameters,
  type ToolSpec,
} from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { ysmToolDocs } from "@/server/tools/ysm";
import {
  mergeWorkingIntoBaseline,
  openYsmWorkflowTabs,
  workflowStatus,
} from "@/lib/ysmWorkflow";

export const openWorkflowTabsParameters = z.object({
  skin_name: z.string().min(1).describe("Human-readable character/skin label used in the three tab titles."),
  legacy_bbmodel: z.string().describe("Workspace-relative old-skin reference .bbmodel."),
  baseline_bbmodel: z.string().describe("Workspace-relative new-skin baseline .bbmodel."),
  working_bbmodel: z.string().describe("Workspace-relative writable new-skin working .bbmodel."),
  discard_unsaved_tabs: z.boolean().optional().default(false).describe(
    "Close and discard any currently unsaved tabs. False refuses before closing anything."
  ),
});

export const workflowStatusParameters = z.object({});

export const mergeWorkflowParameters = z.object({
  confirmation: z.literal("merge").describe(
    "Explicit confirmation required after the user says the current adjustment should be merged."
  ),
});

export const workflowToolDocs: ToolSpec[] = [
  {
    name: "ysm_open_workflow_tabs",
    description:
      "Validates and opens exactly three YSM .bbmodel tabs in order: old-skin reference (read-only), new-skin baseline (read-only), and writable working copy. It never changes pose or animation state.",
    annotations: { title: "Open YSM Three-Tab Workflow", destructiveHint: true, openWorldHint: true },
    parameters: openWorkflowTabsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "ysm_workflow_status",
    description:
      "Reports the current three-tab workflow, paths, roles, protection state, and whether exactly one tab of each role is open.",
    annotations: { title: "Get YSM Workflow Status", readOnlyHint: true },
    parameters: workflowStatusParameters,
    status: STATUS_STABLE,
  },
  {
    name: "ysm_merge_working_into_baseline",
    description:
      "After explicit user approval, saves the working copy, closes the baseline, replaces its .bbmodel with the working copy, reopens it read-only, and returns focus to the still-writable working tab.",
    annotations: { title: "Merge YSM Working Copy", destructiveHint: true, openWorldHint: true },
    parameters: mergeWorkflowParameters,
    status: STATUS_STABLE,
  },
];

const ysmReadOperations = [ysmToolDocs[1], workflowToolDocs[1]];
const ysmWorkflowEditOperations = [workflowToolDocs[0], workflowToolDocs[2]];

export const workflowPublicToolDocs: ToolSpec[] = [
  {
    name: "inspect_ysm",
    description:
      "Reports YSM workspace/binding state or the protected three-tab workflow through one read-only command.action.",
    annotations: { title: "Inspect YSM", readOnlyHint: true },
    parameters: createToolGroupParameters(ysmReadOperations),
    status: STATUS_STABLE,
  },
  {
    name: "manage_ysm_workflow",
    description:
      "Opens the protected YSM three-tab workflow or performs an explicitly confirmed baseline merge.",
    annotations: {
      title: "Manage YSM Workflow",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: createToolGroupParameters(ysmWorkflowEditOperations),
    status: STATUS_STABLE,
  },
];

export function registerWorkflowTools(): void {
  createInternalTool(workflowToolDocs[0].name, {
    ...workflowToolDocs[0],
    async execute({
      skin_name,
      legacy_bbmodel,
      baseline_bbmodel,
      working_bbmodel,
      discard_unsaved_tabs,
    }) {
      return JSON.stringify(await openYsmWorkflowTabs({
        skinName: skin_name,
        legacyBbmodel: legacy_bbmodel,
        baselineBbmodel: baseline_bbmodel,
        workingBbmodel: working_bbmodel,
        discardUnsavedTabs: discard_unsaved_tabs,
      }), null, 2);
    },
  }, workflowToolDocs[0].status);

  createInternalTool(workflowToolDocs[1].name, {
    ...workflowToolDocs[1],
    async execute() {
      return JSON.stringify(workflowStatus(), null, 2);
    },
  }, workflowToolDocs[1].status);

  createInternalTool(workflowToolDocs[2].name, {
    ...workflowToolDocs[2],
    async execute() {
      return JSON.stringify(await mergeWorkingIntoBaseline(), null, 2);
    },
  }, workflowToolDocs[2].status);

  createToolGroup(workflowPublicToolDocs[0], ysmReadOperations);
  createToolGroup(workflowPublicToolDocs[1], ysmWorkflowEditOperations);
}
