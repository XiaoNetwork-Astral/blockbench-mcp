/// <reference types="three" />
/// <reference types="blockbench-types" />
import { createResource } from "@/lib/factories";
import { findByResourceId, makeResourceId, makeResourceUri } from "@/lib/resourceUri";
import { getVisibleProject } from "@/src/blockbench/projects";

function requireVisibleResourceProject(projectUuid: string): ModelProject {
  const visible = getVisibleProject();
  if (!visible) throw new Error("No Blockbench project tab is visible.");
  if (visible.uuid !== projectUuid) {
    throw new Error(
      `Resource project "${projectUuid}" is not the visible tab. ` +
        `Select it in Blockbench and read the resource again.`
    );
  }
  return visible;
}

// Register projects resource using the factory pattern
createResource("projects", {
  uriTemplate: "projects://{id}",
  title: "Blockbench Projects",
  description:
    "Returns information about available projects in Blockbench. List URIs use the project's slugified name (e.g. `projects://my-character`) when unique, or `projects://<slug>~<uuid-prefix>` on collision. The read side also accepts the raw UUID or exact name. Use without an ID to list all projects.",
  async listCallback() {
    const projects = ModelProject.all;
    if (!projects || projects.length === 0) {
      return { resources: [] };
    }
    return {
      resources: projects.map((project) => ({
        uri: makeResourceUri("projects", project, projects),
        name: project.name || project.uuid,
        description: `${project.format?.name ?? "Unknown format"} project${project.saved ? "" : " (unsaved)"}`,
        mimeType: "application/json",
      })),
    };
  },
  async readCallback(uri, { id }) {
    const projects = ModelProject.all;

    if (!projects || projects.length === 0) {
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({ projects: [], count: 0 }),
            mimeType: "application/json",
          },
        ],
      };
    }

    // Helper to extract project info
    const getProjectInfo = (project: ModelProject) => ({
      uuid: project.uuid,
      name: project.name,
      selected: project.selected,
      saved: project.saved,
      format: project.format?.id ?? null,
      formatName: project.format?.name ?? null,
      boxUv: project.box_uv,
      textureWidth: project.texture_width,
      textureHeight: project.texture_height,
      savePath: project.save_path || null,
      exportPath: project.export_path || null,
      elementCount: project.elements?.length ?? 0,
      groupCount: project.groups?.length ?? 0,
      textureCount: project.textures?.length ?? 0,
      animationCount: project.animations?.length ?? 0,
      modelIdentifier: project.model_identifier || null,
      geometryName: project.geometry_name || null,
    });

    // If ID provided, find specific project
    if (id) {
      const project = findByResourceId(projects, id);

      if (!project) {
        throw new Error(`Project with ID "${id}" not found.`);
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(getProjectInfo(project)),
            mimeType: "application/json",
          },
        ],
      };
    }

    // Return all projects
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            projects: projects.map(getProjectInfo),
            count: projects.length,
            activeProject: Project ? Project.uuid : null,
          }),
          mimeType: "application/json",
        },
      ],
    };
  },
});

createResource("nodes", {
  uriTemplate: "nodes://{project}/{id}",
  title: "Blockbench Nodes",
  description:
    "Returns nodes from the visible Blockbench tab. A listed URI remains valid only while its project is visible.",
  async listCallback() {
    const project = getVisibleProject();
    if (!project?.nodes_3d) {
      return { resources: [] };
    }
    const nodes = Object.values(project.nodes_3d);
    return {
      resources: nodes.map((node) => ({
        uri: `nodes://${project.uuid}/${makeResourceId(node, nodes)}`,
        name: node.name || node.uuid,
        description: `3D node in current project`,
        mimeType: "application/json",
      })),
    };
  },
  async readCallback(uri, { project: projectUuid, id }) {
    const project = requireVisibleResourceProject(projectUuid);
    if (!project.nodes_3d) {
      throw new Error("No nodes found in the Blockbench editor.");
    }

    const nodes = Object.values(project.nodes_3d);
    const node = findByResourceId(nodes, id);

    if (!node) {
      throw new Error(`Node with ID "${id}" not found.`);
    }

    const { position, rotation, scale, ...rest } = node;
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            ...rest,
            position: position.toArray(),
            rotation: rotation.toArray(),
            scale: scale.toArray(),
          }),
          mimeType: "application/json",
        },
      ],
    };
  },
});

createResource("textures", {
  uriTemplate: "textures://{project}/{id}",
  title: "Blockbench Textures",
  description:
    "Returns textures from the visible Blockbench tab. Texture IDs and names are resolved only inside that project and ambiguity is rejected.",
  async listCallback() {
    const project = getVisibleProject();
    const textures = project?.textures ?? [];
    if (textures.length === 0) {
      return { resources: [] };
    }
    return {
      resources: textures.map((texture) => ({
        uri: `textures://${project!.uuid}/${makeResourceId(texture, textures)}`,
        name: texture.name || texture.uuid,
        mimeType: "application/json",
        description: texture.path ? `Texture from ${texture.path}` : "Embedded texture",
      })),
    };
  },
  async readCallback(uri, { project: projectUuid, id }) {
    const project = requireVisibleResourceProject(projectUuid);
    const textures = project.textures ?? [];

    if (textures.length === 0) {
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({ textures: [], count: 0 }),
            mimeType: "application/json",
          },
        ],
      };
    }

    // Helper to extract texture info
    const getTextureInfo = (texture: Texture) => ({
        project_uuid: project.uuid,
        uuid: texture.uuid,
        name: texture.name,
        id: texture.id,
        width: texture.width,
        height: texture.height,
        frameCount: texture.frameCount,
        // @ts-ignore - ratio property exists at runtime
        ratio: texture.ratio,
        path: texture.path || null,
        folder: texture.folder || null,
        namespace: texture.namespace || null,
        particle: texture.particle ?? false,
        render_mode: texture.render_mode || "default",
        render_sides: texture.render_sides || "auto",
        visible: texture.visible ?? true,
        saved: texture.saved ?? false,
        selected: texture.selected ?? false,
        source: texture.source || null,
      });

    // If ID provided, find specific texture
    if (id) {
      const numericMatches = /^\d+$/.test(id)
        ? textures.filter((texture) => String(texture.id) === id)
        : [];
      if (numericMatches.length > 1) {
        throw new Error(
          `Texture numeric ID "${id}" is ambiguous (${numericMatches.length} matches: ` +
            `${numericMatches.map((texture) => texture.uuid).join(", ")}). Use a UUID.`
        );
      }
      const texture = numericMatches[0] ?? findByResourceId(textures, id);

      if (!texture) {
        throw new Error(`Texture with ID "${id}" not found.`);
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(getTextureInfo(texture)),
            mimeType: "application/json",
          },
        ],
      };
    }

    // Return all textures
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            textures: textures.map(getTextureInfo),
            count: textures.length,
          }),
          mimeType: "application/json",
        },
      ],
    };
  },
});

if (Plugins.installed.some((p: { id: string }) => p.id === "reference_models")) {
createResource("reference_models", {
    uriTemplate: "reference_models://{project}/{id}",
    title: "Reference Models",
    description:
      "Returns reference models from the visible Blockbench tab. Requires the Reference Models plugin.",
    async listCallback() {
      const project = getVisibleProject();
      const elements = project?.elements ?? [];
      const referenceModels = elements.filter(
        (e) => e.type === "reference_model"
      );
      if (referenceModels.length === 0) {
        return { resources: [] };
      }
      return {
        resources: referenceModels.map((model) => ({
          uri: `reference_models://${project!.uuid}/${makeResourceId(model, referenceModels)}`,
          name: model.name || model.uuid,
          description: (model as { path?: string }).path
            ? `Reference model from ${(model as { path?: string }).path}`
            : "Reference model",
          mimeType: "application/json",
        })),
      };
    },
    async readCallback(uri, { project: projectUuid, id }) {
      const project = requireVisibleResourceProject(projectUuid);
      const elements = project.elements ?? [];
      const referenceModels = elements.filter(
        (e) => e.type === "reference_model"
      );

      if (referenceModels.length === 0) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({ referenceModels: [], count: 0 }),
              mimeType: "application/json",
            },
          ],
        };
      }

      // Normalize Vector3-like values to [number, number, number] arrays
      const normalizeVec3 = (
        value: unknown,
        defaultValue: [number, number, number]
      ): [number, number, number] => {
        if (!value) {
          return defaultValue;
        }
        if (Array.isArray(value) && value.length >= 3) {
          return [Number(value[0]), Number(value[1]), Number(value[2])];
        }
        if (
          typeof value === "object" &&
          "x" in value &&
          "y" in value &&
          "z" in value
        ) {
          const v = value as { x: number; y: number; z: number };
          return [Number(v.x), Number(v.y), Number(v.z)];
        }
        return defaultValue;
      };

      // Helper to extract reference model info
      const getReferenceModelInfo = (model: OutlinerElement) => {
        const refModel = model as OutlinerElement & {
          path?: string;
          origin?: unknown;
          rotation?: unknown;
          scale?: unknown;
          visibility?: boolean;
        };
        return {
          uuid: refModel.uuid,
          name: refModel.name,
          path: refModel.path || null,
          origin: normalizeVec3(refModel.origin, [0, 0, 0]),
          rotation: normalizeVec3(refModel.rotation, [0, 0, 0]),
          scale: normalizeVec3(refModel.scale, [1, 1, 1]),
          visibility: refModel.visibility ?? true,
        };
      };

      // If ID provided, find specific reference model
      if (id) {
        const model = findByResourceId(referenceModels, id);

        if (!model) {
          throw new Error(`Reference model with ID "${id}" not found.`);
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(getReferenceModelInfo(model)),
              mimeType: "application/json",
            },
          ],
        };
      }

      // Return all reference models
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({
              referenceModels: referenceModels.map(getReferenceModelInfo),
              count: referenceModels.length,
            }),
            mimeType: "application/json",
          },
        ],
      };
    },
  });
}
