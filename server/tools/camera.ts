/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  createTool,
  createToolGroup,
  createToolGroupParameters,
  type ToolSpec,
} from "@/lib/factories";
import { captureScreenshot, captureAppScreenshot } from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { vec3, projectionEnum } from "@/lib/zodObjects";

export const captureScreenshotParameters = z.object({
  project: z.string().optional().describe("Project name or UUID."),
  settle_frames: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .default(2)
    .describe("Render frames to wait before capture. Use 0 only when the scene is already stable."),
});

export const captureAppScreenshotParameters = z.object({});

export const setCameraAngleParameters = z.object({
  position: vec3("Camera position."),
  target: vec3("Camera target position.").optional(),
  rotation: vec3("Camera rotation.").optional(),
  projection: projectionEnum.describe("Camera projection type."),
});

export const cameraToolDocs: ToolSpec[] = [
  {
    name: "capture_viewport",
    description: "Returns the image data of the current view.",
    annotations: {
      title: "Inspect Viewport",
      readOnlyHint: true,
    },
    parameters: captureScreenshotParameters,
    status: STATUS_STABLE,
  },
  {
    name: "capture_blockbench_ui",
    description: "Returns the image data of the Blockbench app.",
    annotations: {
      title: "Inspect Blockbench UI",
      readOnlyHint: true,
    },
    parameters: captureAppScreenshotParameters,
    status: STATUS_STABLE,
  },
];

const cameraInspectionOperations = [...cameraToolDocs];

export const cameraPublicToolDocs: ToolSpec[] = [
  {
    name: "inspect_blockbench",
    description:
      "Captures either the rendered 3D viewport or the complete Blockbench window through one command.action.",
    annotations: { title: "Inspect Blockbench", readOnlyHint: true },
    parameters: createToolGroupParameters(cameraInspectionOperations),
    status: STATUS_STABLE,
  },
  {
    name: "edit_camera",
    description: "Sets the camera angle to the specified value.",
    annotations: {
      title: "Edit Camera",
      destructiveHint: true,
    },
    parameters: setCameraAngleParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

export function registerCameraTools() {
  createInternalTool(cameraToolDocs[0].name, {
    ...cameraToolDocs[0],
    async execute({ project, settle_frames }) {
      return await captureScreenshot(project, settle_frames);
    },
  }, cameraToolDocs[0].status);

  createInternalTool(cameraToolDocs[1].name, {
    ...cameraToolDocs[1],
    async execute() {
      return captureAppScreenshot();
    },
  }, cameraToolDocs[1].status);

  createTool(cameraPublicToolDocs[1].name, {
    ...cameraPublicToolDocs[1],
    async execute(angle: { position: number[]; target?: number[]; rotation?: number[]; projection: string }) {
      const preview = Preview.selected;

      if (!preview) {
        throw new Error("No preview found in the Blockbench editor.");
      }

      // @ts-expect-error Angle CAN be loaded like this
      preview.loadAnglePreset({
        ...angle
      });

      return await captureScreenshot(undefined, 2);
    },
  }, cameraPublicToolDocs[1].status);

  createToolGroup(cameraPublicToolDocs[0], cameraInspectionOperations);
}
