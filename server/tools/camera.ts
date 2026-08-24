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
import { vec3 } from "@/lib/zodObjects";
import { setSessionCameraState } from "@/lib/projectContext";

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
  width: z.number().int().min(64).max(1600).optional().default(800),
  height: z.number().int().min(64).max(1200).optional().default(600),
});

export const captureAppScreenshotParameters = z.object({});

export const setCameraAngleParameters = z.object({
  position: vec3("Camera position."),
  target: vec3("Camera target position.").optional(),
  rotation: vec3("Camera rotation.").optional(),
  projection: z.enum(["orthographic", "perspective"]).describe("MCP camera projection type."),
  zoom: z.number().positive().max(100).optional().describe("Orthographic zoom. Defaults to 0.5."),
});

export const cameraToolDocs: ToolSpec[] = [
  {
    name: "capture_viewport",
    description:
      "Renders the requested or MCP working project offscreen without selecting its Blockbench tab.",
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
    description:
      "Sets this MCP session's offscreen camera for its working project without changing the user's visible viewport.",
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
    async execute({ project, settle_frames, width, height }, context) {
      return await captureScreenshot(
        project,
        settle_frames,
        context.sessionId,
        context.project,
        width,
        height
      );
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
    async execute(angle, context) {
      const project = context.project!;
      setSessionCameraState(context.sessionId, project.uuid, {
        position: [angle.position[0], angle.position[1], angle.position[2]],
        target: angle.target
          ? [angle.target[0], angle.target[1], angle.target[2]]
          : undefined,
        rotation: angle.rotation
          ? [angle.rotation[0], angle.rotation[1], angle.rotation[2]]
          : undefined,
        projection: angle.projection,
        zoom: angle.zoom,
      });
      return await captureScreenshot(
        undefined,
        2,
        context.sessionId,
        project
      );
    },
  }, cameraPublicToolDocs[1].status);

  createToolGroup(cameraPublicToolDocs[0], cameraInspectionOperations);
}
