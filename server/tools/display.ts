/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  createToolGroup,
  createToolGroupParameters,
  type ToolSpec,
} from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { captureScreenshot } from "@/lib/util";
import { displaySlotEnum, vec3 } from "@/lib/zodObjects";

export const getDisplayTransformParameters = z.object({
  slot: displaySlotEnum
    .optional()
    .describe("Display slot to read. Omit to return all populated slots."),
});

export const setDisplayTransformParameters = z.object({
  slot: displaySlotEnum.describe("Display slot to modify."),
  translation: vec3(
    "Translation offset as [x, y, z] in Minecraft display units."
  ).optional(),
  rotation: vec3("Rotation in degrees as [x, y, z].").optional(),
  scale: vec3("Scale factor as [x, y, z].").optional(),
  rotation_pivot: vec3("Rotation pivot as [x, y, z].").optional(),
  scale_pivot: vec3("Scale pivot as [x, y, z].").optional(),
  mirror: z
    .array(z.boolean())
    .length(3)
    .optional()
    .describe("Per-axis mirror flags as [x, y, z]."),
  reset: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Reset the slot to its identity transform before applying supplied fields."
    ),
});

export const enterDisplayModeParameters = z.object({
  slot: displaySlotEnum.describe("Display slot to activate."),
  reference: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional live reference model name, such as player, zombie, armor_stand, or block."
    ),
});

export const displayToolDocs: ToolSpec[] = [
  {
    name: "get_display_transform",
    description:
      "Reads Java Edition display transforms from Project.display_settings. Returns one slot or every populated slot without modifying the model.",
    annotations: {
      title: "Get Display Transform",
      readOnlyHint: true,
    },
    parameters: getDisplayTransformParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "set_display_transform",
    description:
      "Writes one Java Edition display transform with complete Undo and audit coverage. This changes exported model data and requires a format with display-mode support.",
    annotations: {
      title: "Set Display Transform",
      destructiveHint: true,
    },
    parameters: setDisplayTransformParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "enter_display_mode",
    description:
      "Switches the editor preview to a display slot, optionally loads a validated reference model, and returns a screenshot for multi-view fit checks. It does not change exported transform data.",
    annotations: {
      title: "Enter Display Mode",
      destructiveHint: false,
    },
    parameters: enterDisplayModeParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

const displayReadOperations = [displayToolDocs[0]];
const displayEditOperations = [displayToolDocs[1], displayToolDocs[2]];

export const displayPublicToolDocs: ToolSpec[] = [
  {
    name: "inspect_display",
    description: "Reads one or all Java Edition display transforms.",
    annotations: { title: "Inspect Display", readOnlyHint: true },
    parameters: createToolGroupParameters(displayReadOperations),
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "edit_display",
    description:
      "Writes display transforms or enters a display preview slot through one command.action.",
    annotations: { title: "Edit Display", destructiveHint: true },
    parameters: createToolGroupParameters(displayEditOperations),
    status: STATUS_EXPERIMENTAL,
  },
];

type DisplaySettings = Record<string, DisplaySlot>;

interface DisplayModeRuntime {
  slots?: string[];
  load?: (slot: string) => void;
  display_slot?: string;
}

interface DisplayReferenceModelRuntime {
  load?: (index?: number) => void;
}

interface DisplayReferenceObjectsRuntime {
  refmodels?: Record<string, DisplayReferenceModelRuntime>;
}

function copyVector(value: ArrayLike<number>): [number, number, number] {
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function serializeDisplaySlot(slot: DisplaySlot) {
  return {
    translation: copyVector(slot.translation),
    rotation: copyVector(slot.rotation),
    scale: copyVector(slot.scale),
    mirror: [...slot.mirror] as [boolean, boolean, boolean],
    rotation_pivot: copyVector(slot.rotation_pivot),
    scale_pivot: copyVector(slot.scale_pivot),
  };
}

function getDisplaySettings(): DisplaySettings {
  return Project.display_settings as unknown as DisplaySettings;
}

function assertDisplayModeSupported(): void {
  if (!Format?.display_mode) {
    throw new Error(
      "The active format does not support display transforms. Use a Java Block/Item or another format with display mode enabled."
    );
  }
}

function assertRuntimeSlotAvailable(slot: string): void {
  if (typeof DisplayMode === "undefined") {
    throw new Error(
      "Display mode is supported by the format but unavailable in this Blockbench build."
    );
  }
  const runtime = DisplayMode as unknown as DisplayModeRuntime;
  if (
    Array.isArray(runtime.slots) &&
    runtime.slots.length > 0 &&
    !runtime.slots.includes(slot)
  ) {
    throw new Error(
      `Display slot "${slot}" is unavailable in this Blockbench build. ` +
        `Available slots: ${runtime.slots.join(", ")}.`
    );
  }
}

function getReferenceModelOrThrow(
  reference: string
): DisplayReferenceModelRuntime {
  const references = (
    globalThis as unknown as {
      displayReferenceObjects?: DisplayReferenceObjectsRuntime;
    }
  ).displayReferenceObjects?.refmodels;
  const model = references?.[reference];
  if (!model || typeof model.load !== "function") {
    throw new Error(
      `Display reference "${reference}" is unavailable. Available references: ` +
        `${references ? Object.keys(references).sort().join(", ") : "none"}.`
    );
  }
  return model;
}

function activateDisplaySlot(slot: string): string {
  const runtime = DisplayMode as unknown as DisplayModeRuntime;
  if (typeof runtime.load === "function") {
    runtime.load(slot);
    return "DisplayMode.load";
  }

  const loadDisp = (
    globalThis as unknown as { loadDisp?: (slot: string) => void }
  ).loadDisp;
  if (typeof loadDisp === "function") {
    loadDisp(slot);
    return "loadDisp";
  }

  runtime.display_slot = slot;
  return "DisplayMode.display_slot";
}

export function hasDisplayTransformChange(
  args: z.infer<typeof setDisplayTransformParameters>
): boolean {
  return Boolean(
    args.reset ||
      args.translation ||
      args.rotation ||
      args.scale ||
      args.rotation_pivot ||
      args.scale_pivot ||
      args.mirror
  );
}

export function registerDisplayTools() {
  createInternalTool(displayToolDocs[0].name, {
    ...displayToolDocs[0],
    async execute({ slot }) {
      const settings = getDisplaySettings();
      if (slot) {
        const displaySlot = settings[slot];
        return JSON.stringify(
          {
            slot,
            present: Boolean(displaySlot),
            transform: displaySlot ? serializeDisplaySlot(displaySlot) : null,
          },
          null,
          2
        );
      }

      const slots = Object.entries(settings)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, displaySlot]) => ({
          slot: id,
          transform: serializeDisplaySlot(displaySlot),
        }));
      return JSON.stringify(
        {
          format_supports_display: Boolean(Format?.display_mode),
          populated_count: slots.length,
          slots,
        },
        null,
        2
      );
    },
  }, displayToolDocs[0].status);

  createInternalTool(displayToolDocs[1].name, {
    ...displayToolDocs[1],
    async execute(args) {
      const settings = getDisplaySettings();
      assertDisplayModeSupported();
      assertRuntimeSlotAvailable(args.slot);
      if (!hasDisplayTransformChange(args)) {
        throw new Error(
          "No display transform change was requested. Supply reset=true or at least one transform field."
        );
      }

      Undo.initEdit({ display_slots: [args.slot] });
      let displaySlot = settings[args.slot];
      if (!displaySlot) {
        displaySlot = new DisplaySlot(args.slot, {});
        settings[args.slot] = displaySlot;
      }
      if (args.reset) displaySlot.default();

      const data: DisplaySlotOptions = {
        ...(args.translation && {
          translation: args.translation as ArrayVector3,
        }),
        ...(args.rotation && { rotation: args.rotation as ArrayVector3 }),
        ...(args.scale && { scale: args.scale as ArrayVector3 }),
        ...(args.rotation_pivot && {
          rotation_pivot: args.rotation_pivot as ArrayVector3,
        }),
        ...(args.scale_pivot && {
          scale_pivot: args.scale_pivot as ArrayVector3,
        }),
        ...(args.mirror && {
          mirror: args.mirror as [boolean, boolean, boolean],
        }),
      };
      displaySlot.extend(data);
      displaySlot.update();
      Canvas.updateAll();
      Undo.finishEdit("Agent set display transform", {
        display_slots: [args.slot],
      });

      return JSON.stringify(
        {
          slot: args.slot,
          reset: args.reset,
          transform: serializeDisplaySlot(displaySlot),
        },
        null,
        2
      );
    },
  }, displayToolDocs[1].status);

  createInternalTool(displayToolDocs[2].name, {
    ...displayToolDocs[2],
    async execute({ slot, reference }, context) {
      assertDisplayModeSupported();
      assertRuntimeSlotAvailable(slot);
      const referenceModel = reference
        ? getReferenceModelOrThrow(reference)
        : undefined;

      const modes = Modes as unknown as {
        display?: boolean;
        options?: { display?: { select?: () => void } };
      };
      const notes: string[] = [];
      if (!modes.display) {
        const selectDisplay = modes.options?.display?.select;
        if (typeof selectDisplay !== "function") {
          throw new Error(
            "Display mode is supported by the format but unavailable in this Blockbench build."
          );
        }
        selectDisplay.call(modes.options?.display);
        notes.push("Entered display mode.");
      } else {
        notes.push("Already in display mode.");
      }

      notes.push(`Activated slot "${slot}" via ${activateDisplaySlot(slot)}.`);
      if (reference && referenceModel) {
        referenceModel.load?.();
        notes.push(`Loaded reference "${reference}".`);
      }

      const screenshot = await captureScreenshot(
        undefined,
        2,
        context.sessionId,
        context.project
      );
      return {
        content: [
          { type: "text" as const, text: notes.join(" ") },
          ...screenshot.content,
        ],
      };
    },
  }, displayToolDocs[2].status);

  createToolGroup(displayPublicToolDocs[0], displayReadOperations);
  createToolGroup(displayPublicToolDocs[1], displayEditOperations);
}
