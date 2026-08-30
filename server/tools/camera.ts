/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  type ToolSpec,
} from "@/lib/factories";
import {
  captureScreenshot,
  captureAppScreenshot,
  findElementOrThrow,
  getEffectiveCameraState,
} from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { vec3 } from "@/lib/zodObjects";
import type { McpCameraState } from "@/src/blockbench/camera";
import { expandOutlinerGeometryWorldBounds } from "@/lib/sceneBounds";
import { fitBoundingSpherePerspectiveDistance } from "@/lib/cameraFraming";
import { previewParameters, resolvePreviewState } from "@/server/tools/preview";

export const captureScreenshotParameters = z.object({
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
  camera: z.lazy(() => setCameraAngleParameters).optional()
    .describe("Optional one-shot camera for this capture."),
  preview: previewParameters.optional()
    .describe("Optional one-shot animation pose and bone visibility for this capture."),
}).strict();

export const captureAppScreenshotParameters = z.object({});

const autoFitCameraSchema = z.object({
  element: z.string().min(1).describe("UUID or unique name to frame."),
  context_elements: z.array(z.string().min(1)).max(100).optional().default([]),
  frame_occupancy: z.number().finite().min(0.1).max(0.95).optional().default(0.8),
  view_direction: vec3("World direction from the target toward the camera.").optional().default([-1, 0.75, -1]),
}).strict();

const viewportSchema = z
  .array(z.number().int().min(64).max(1600))
  .length(2)
  .superRefine((viewport, context) => {
    if (viewport[1] > 1200) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Viewport height must be at most 1200 pixels.",
        path: [1],
      });
    }
  });

export const setCameraAngleParameters = z.object({
  position: vec3("Camera position.").optional(),
  target: vec3("Camera target position.").optional(),
  rotation: vec3("Camera rotation.").optional(),
  projection: z.enum(["orthographic", "perspective"]).describe("MCP camera projection type."),
  zoom: z.number().positive().max(100).optional().describe("Orthographic zoom. Defaults to 0.5."),
  fov: z.number().finite().min(1).max(179).optional().describe("Perspective vertical field of view in degrees."),
  viewport: viewportSchema
    .optional().describe("Stored offscreen viewport [width, height], with width <= 1600 and height <= 1200."),
  auto_fit: autoFitCameraSchema.optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.position) === Boolean(value.auto_fit)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of position or auto_fit." });
  }
  if (value.auto_fit && (value.target || value.rotation)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "auto_fit computes its own target and orientation; do not provide target or rotation.",
    });
  }
  if (!value.auto_fit && value.target && value.rotation) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide target or rotation, not both.",
    });
  }
  if (value.projection === "orthographic" && value.fov !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "fov applies only to perspective cameras.", path: ["fov"] });
  }
  if (value.projection === "perspective" && value.zoom !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "zoom applies only to orthographic cameras.", path: ["zoom"] });
  }
});

export const getCameraStateParameters = z.object({}).strict();

export const cameraToolDocs: ToolSpec[] = [
  {
    name: "capture_viewport",
    description:
      "Captures the visible project with optional one-shot camera, animation, and bone visibility settings.",
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
    project: "none",
    annotations: {
      title: "Inspect Blockbench UI",
      readOnlyHint: true,
    },
    parameters: captureAppScreenshotParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_camera_state",
    description: "Returns the effective camera for the visible project with exact projection, FOV/zoom, viewport, and project identity.",
    annotations: { title: "Get MCP Camera State", readOnlyHint: true },
    parameters: getCameraStateParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

export function registerCameraTools() {
  createInternalTool(cameraToolDocs[0].name, {
    ...cameraToolDocs[0],
    async execute({ settle_frames, width, height, camera: inputCamera, preview }, context) {
      const project = context.project!;
      const camera = inputCamera
        ? inputCamera.auto_fit
          ? fittedElementCamera(inputCamera)
          : {
              position: [...inputCamera.position!] as [number, number, number],
              target: inputCamera.target
                ? [...inputCamera.target] as [number, number, number]
                : undefined,
              rotation: inputCamera.rotation
                ? [...inputCamera.rotation] as [number, number, number]
                : undefined,
              projection: inputCamera.projection,
              zoom: inputCamera.zoom,
              fov: inputCamera.fov,
              viewport: [width, height] as [number, number],
            } satisfies McpCameraState
        : undefined;
      return captureScreenshot({
        settleFrames: settle_frames,
        workingProject: project,
        width,
        height,
        camera,
        preview: resolvePreviewState(preview, project),
      });
    },
  }, cameraToolDocs[0].status);

  createInternalTool(cameraToolDocs[1].name, {
    ...cameraToolDocs[1],
    async execute() {
      return captureAppScreenshot();
    },
  }, cameraToolDocs[1].status);

  createInternalTool(cameraToolDocs[2].name, {
    ...cameraToolDocs[2],
    async execute(_input, context) {
      const project = context.project!;
      return JSON.stringify({
        schema_version: "1",
        project: { uuid: project.uuid, name: project.name },
        camera: getEffectiveCameraState(project),
      }, null, 2);
    },
  }, cameraToolDocs[2].status);
}

function fittedElementCamera(
  angle: z.infer<typeof setCameraAngleParameters>
): McpCameraState {
  const fit = angle.auto_fit!;
  const nodes = [fit.element, ...fit.context_elements].map((reference) =>
    findElementOrThrow(reference) as OutlinerElement | Group
  );
  const THREE_API = (globalThis as typeof globalThis & { THREE: typeof import("three") }).THREE;
  const bounds = new THREE_API.Box3();
  for (const node of nodes) expandOutlinerGeometryWorldBounds(node, bounds);
  if (bounds.isEmpty()) throw new Error(`Cannot auto-fit '${fit.element}' because it has no renderable geometry.`);
  const center = bounds.getCenter(new THREE_API.Vector3());
  const size = bounds.getSize(new THREE_API.Vector3());
  const radius = Math.max(size.length() / 2, 0.001);
  const direction = new THREE_API.Vector3(...fit.view_direction);
  if (direction.lengthSq() <= 1e-12) throw new Error("auto_fit.view_direction must be non-zero.");
  direction.normalize();
  const fov = angle.fov ?? 45;
  const viewport = angle.viewport
    ? [angle.viewport[0], angle.viewport[1]] as [number, number]
    : [800, 600] as [number, number];
  const distance = angle.projection === "perspective"
    ? fitBoundingSpherePerspectiveDistance(
        radius,
        fov,
        viewport[0] / viewport[1],
        fit.frame_occupancy
      )
    : radius * 3;
  const position = center.clone().addScaledVector(direction, distance);
  const largestExtent = Math.max(size.x, size.y, size.z, 0.001);
  return {
    position: position.toArray() as [number, number, number],
    target: center.toArray() as [number, number, number],
    projection: angle.projection,
    zoom: angle.projection === "orthographic"
      ? angle.zoom ?? 16 * fit.frame_occupancy / largestExtent
      : undefined,
    fov: angle.projection === "perspective" ? fov : undefined,
    viewport,
  };
}
