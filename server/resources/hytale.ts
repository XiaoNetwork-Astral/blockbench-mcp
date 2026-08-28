/// <reference types="three" />
/// <reference types="blockbench-types" />

import { createResource } from "@/lib/factories";
import {
  findByExactUuid,
  findByResourceId,
  makeResourceId,
} from "@/lib/resourceUri";
import { runInProjectContext } from "@/lib/projectContext";
import {
  isHytalePluginInstalled,
  isHytaleFormat,
  getHytaleFormatType,
  getHytaleBlockSize,
  getAttachmentCollections,
  getAttachmentPieces,
  validateNodeCount,
  getHytaleAnimationFPS,
  getCubeShadingMode,
  isCubeDoubleSided,
  type HytaleCube,
} from "@/lib/hytale";

function resolveHytaleProject(projectUuid: string): ModelProject {
  const project = findByExactUuid(ModelProject.all, projectUuid, "Project");
  if (!runInProjectContext(project, () => isHytaleFormat())) {
    throw new Error(
      `Project "${project.name}" (${project.uuid}) is not a Hytale format project.`
    );
  }
  return project;
}

/**
 * Register Hytale-specific resources.
 * These resources are only functional when the Hytale plugin is installed.
 */
export function registerHytaleResources() {
  // Only register if Hytale plugin is available
  if (!isHytalePluginInstalled()) {
    console.log("[MCP] Hytale plugin not detected, skipping Hytale resources registration");
    return;
  }

  console.log("[MCP] Hytale plugin detected, registering Hytale resources");

  // ============================================================================
  // Hytale Format Info Resource
  // ============================================================================

  createResource("hytale-format", {
    uriTemplate: "hytale://format/{project}",
    title: "Hytale Format Information",
    description:
      "Returns Hytale format information for the exact project UUID embedded in the listed URI.",
    async listCallback() {
      const project = Project;
      if (!project || !isHytaleFormat()) {
        return { resources: [] };
      }

      return {
        resources: [
          {
            uri: `hytale://format/${project.uuid}`,
            name: `Hytale ${getHytaleFormatType()} format`,
            description: `Block size: ${getHytaleBlockSize()}, FPS: ${getHytaleAnimationFPS()}`,
            mimeType: "application/json",
          },
        ],
      };
    },
    async readCallback(uri, { project: projectUuid }) {
      const project = resolveHytaleProject(projectUuid);
      const details = runInProjectContext(project, () => {
        const formatType = getHytaleFormatType();
        const blockSize = getHytaleBlockSize();
        const nodeValidation = validateNodeCount();
        return { formatType, blockSize, nodeValidation, animationFPS: getHytaleAnimationFPS() };
      });

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({
              active: true,
              projectUuid: project.uuid,
              formatType: details.formatType,
              formatId: details.formatType === "character" ? "hytale_character" : "hytale_prop",
              blockSize: details.blockSize,
              animationFPS: details.animationFPS,
              nodeCount: details.nodeValidation.count,
              maxNodes: details.nodeValidation.max,
              nodeCountValid: details.nodeValidation.valid,
              features: {
                boneRig: true,
                animationFiles: true,
                quaternionInterpolation: true,
                uvRotation: true,
                stretchCubes: true,
                attachments: true,
                quads: true,
                shadingModes: ["flat", "standard", "fullbright", "reflective"],
                doubleSided: true,
                visibilityKeyframes: true,
              },
            }),
            mimeType: "application/json",
          },
        ],
      };
    },
  });

  // ============================================================================
  // Hytale Attachments Resource
  // ============================================================================

  createResource("hytale-attachments", {
    uriTemplate: "hytale://attachments/{project}/{id}",
    title: "Hytale Attachments",
    description:
      "Returns attachment collections from the exact Hytale project UUID embedded in each listed URI. Object references remain strict and collision-qualified.",
    async listCallback() {
      const project = Project;
      if (!project || !isHytaleFormat()) {
        return { resources: [] };
      }

      const attachments = getAttachmentCollections();
      return {
        resources: attachments.map((a) => ({
          uri: `hytale://attachments/${project.uuid}/${makeResourceId(a, attachments)}`,
          name: a.name,
          description: `Attachment collection${a.texture ? " with texture" : ""}`,
          mimeType: "application/json",
        })),
      };
    },
    async readCallback(uri, { project: projectUuid, id }) {
      const project = resolveHytaleProject(projectUuid);
      const attachments = runInProjectContext(project, () => getAttachmentCollections());

      // If ID provided, find specific attachment
      if (id) {
        const attachment = findByResourceId(attachments, id);
        if (!attachment) {
          throw new Error(`Attachment "${id}" not found.`);
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({
                uuid: attachment.uuid,
                name: attachment.name,
                texture: attachment.texture ?? null,
                // @ts-ignore - children may exist
                elementCount: attachment.children?.length ?? 0,
                exportCodec: attachment.export_codec,
              }),
              mimeType: "application/json",
            },
          ],
        };
      }

      // Return all attachments
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({
              count: attachments.length,
              attachments: attachments.map((a) => ({
                uuid: a.uuid,
                name: a.name,
                texture: a.texture ?? null,
                // @ts-ignore - children may exist
                elementCount: a.children?.length ?? 0,
              })),
            }),
            mimeType: "application/json",
          },
        ],
      };
    },
  });

  // ============================================================================
  // Hytale Attachment Pieces Resource
  // ============================================================================

  createResource("hytale-pieces", {
    uriTemplate: "hytale://pieces/{project}/{id}",
    title: "Hytale Attachment Pieces",
    description:
      "Returns attachment pieces from the exact Hytale project UUID embedded in each listed URI. Object references remain strict and collision-qualified.",
    async listCallback() {
      const project = Project;
      if (!project || !isHytaleFormat()) {
        return { resources: [] };
      }

      const pieces = getAttachmentPieces();
      return {
        resources: pieces.map((p) => ({
          uri: `hytale://pieces/${project.uuid}/${makeResourceId(p, pieces)}`,
          name: p.name,
          description: "Attachment piece bone",
          mimeType: "application/json",
        })),
      };
    },
    async readCallback(uri, { project: projectUuid, id }) {
      const project = resolveHytaleProject(projectUuid);
      const pieces = runInProjectContext(project, () => getAttachmentPieces());

      // If ID provided, find specific piece
      if (id) {
        const piece = findByResourceId(pieces, id);
        if (!piece) {
          throw new Error(`Attachment piece "${id}" not found.`);
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({
                uuid: piece.uuid,
                name: piece.name,
                origin: piece.origin,
                rotation: piece.rotation,
                is_piece: true,
                // @ts-ignore - children property
                childCount: piece.children?.length ?? 0,
              }),
              mimeType: "application/json",
            },
          ],
        };
      }

      // Return all pieces
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({
              count: pieces.length,
              pieces: pieces.map((p) => ({
                uuid: p.uuid,
                name: p.name,
                origin: p.origin,
              })),
            }),
            mimeType: "application/json",
          },
        ],
      };
    },
  });

  // ============================================================================
  // Hytale Cubes Resource (with Hytale-specific properties)
  // ============================================================================

  createResource("hytale-cubes", {
    uriTemplate: "hytale://cubes/{project}/{id}",
    title: "Hytale Cubes",
    description:
      "Returns cubes with Hytale-specific properties from the exact project UUID embedded in each listed URI. Object references remain strict and collision-qualified.",
    async listCallback() {
      const project = Project;
      if (!project || !isHytaleFormat()) {
        return { resources: [] };
      }

      // @ts-ignore - Cube is globally available
      const cubes: Cube[] = Cube.all ?? [];
      return {
        resources: cubes.map((c: Cube) => ({
          uri: `hytale://cubes/${project.uuid}/${makeResourceId(c, cubes)}`,
          name: c.name,
          description: `Shading: ${getCubeShadingMode(c)}, Double-sided: ${isCubeDoubleSided(c)}`,
          mimeType: "application/json",
        })),
      };
    },
    async readCallback(uri, { project: projectUuid, id }) {
      const project = resolveHytaleProject(projectUuid);
      // @ts-ignore - Cube is globally available
      const cubes: Cube[] = runInProjectContext(project, () => Cube.all ?? []);

      // If ID provided, find specific cube
      if (id) {
        const cube = findByResourceId(cubes, id);
        if (!cube) {
          throw new Error(`Cube "${id}" not found.`);
        }

        const hytaleCube = cube as HytaleCube;
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({
                uuid: cube.uuid,
                name: cube.name,
                from: cube.from,
                to: cube.to,
                origin: cube.origin,
                rotation: cube.rotation,
                // @ts-ignore - stretch property
                stretch: cube.stretch ?? [1, 1, 1],
                shading_mode: getCubeShadingMode(cube),
                double_sided: isCubeDoubleSided(cube),
                autouv: cube.autouv,
                visibility: cube.visibility,
              }),
              mimeType: "application/json",
            },
          ],
        };
      }

      // Return all cubes with Hytale properties
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({
              count: cubes.length,
              cubes: cubes.map((c: Cube) => ({
                uuid: c.uuid,
                name: c.name,
                shading_mode: getCubeShadingMode(c),
                double_sided: isCubeDoubleSided(c),
                // @ts-ignore - stretch property
                stretch: (c as HytaleCube).stretch ?? [1, 1, 1],
              })),
            }),
            mimeType: "application/json",
          },
        ],
      };
    },
  });

  console.log("[MCP] Hytale resources registered successfully");
}
