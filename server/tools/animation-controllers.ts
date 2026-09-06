import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";
import { allControllers, applyControllerGraph, assertControllerName, controllerStatesSchema, describeController, findControllerOrThrow, prepareControllerGraph } from "@/src/blockbench/animationControllers";

export const animationControllerTools: ToolDefinition[] = [
  defineTool({
    name: "inspect_animation_controllers",
    description: "Lists animation controllers in the visible project, or reads one controller's state graph, initial state, transitions, effects and blend settings.",
    annotations: { title: "Inspect Animation Controllers", readOnlyHint: true },
    parameters: z.object({ id: z.string().min(1).optional() }).strict(), status: "stable",
    async execute({ id }) {
      return JSON.stringify(id ? describeController(findControllerOrThrow(id)) : { supported: Boolean(Format.animation_controllers), controllers: allControllers().map(item => describeController(item, false)) });
    },
  }),
  defineTool({
    name: "create_animation_controller",
    description: "Creates an animation controller with an explicit graph of named states. Animation references must already exist; transitions resolve before any edit. Requires a format supporting animation controllers. Does not start playback or write files.",
    annotations: { title: "Create Animation Controller", destructiveHint: true },
    parameters: z.object({ name: z.string().min(1).max(256), states: controllerStatesSchema, initial_state: z.string().min(1) }).strict(), status: "stable",
    async execute({ name, states, initial_state }) {
      if (!Format.animation_controllers) throw new Error(`Format "${Format.id}" does not support animation controllers.`);
      assertControllerName(name);
      const graph = prepareControllerGraph(states, initial_state);
      const controller = new AnimationController({ name });
      const created: AnimationController[] = [];
      Undo.initEdit({ animation_controllers: created });
      controller.add(false);
      created.push(controller);
      applyControllerGraph(controller, graph, initial_state);
      Undo.finishEdit("Create animation controller", { animation_controllers: [controller] });
      return JSON.stringify(describeController(controller));
    },
  }),
  defineTool({
    name: "edit_animation_controller",
    description: "Renames an animation controller, changes its initial state, or replaces its complete state graph. Providing states replaces omitted states too; omitting states preserves the graph. Existing state UUIDs are preserved by name. Changes stay in the project until explicitly exported.",
    annotations: { title: "Edit Animation Controller", destructiveHint: true },
    parameters: z.object({
      id: z.string().min(1), name: z.string().min(1).max(256).optional(),
      states: controllerStatesSchema.optional(), initial_state: z.string().min(1).optional(),
    }).strict().refine(value => value.name !== undefined || value.states !== undefined || value.initial_state !== undefined, "Provide a name, states or initial_state."),
    status: "stable",
    async execute({ id, name, states, initial_state }) {
      const controller = findControllerOrThrow(id);
      if (name) assertControllerName(name, controller);
      const initial = initial_state ?? controller.states.find(state => state.uuid === controller.initial_state)?.name ?? controller.states[0]?.name ?? "";
      const graph = states ? prepareControllerGraph(states, initial) : undefined;
      if (!states && initial_state && !controller.states.some(state => state.name === initial_state)) throw new Error(`Initial state "${initial_state}" does not exist.`);
      Undo.initEdit({ animation_controllers: [controller] });
      if (name) controller.name = name;
      if (graph) applyControllerGraph(controller, graph, initial);
      else if (initial_state) controller.initial_state = controller.states.find(state => state.name === initial_state)!.uuid;
      controller.saved = false;
      Undo.finishEdit("Edit animation controller");
      return JSON.stringify(describeController(controller));
    },
  }),
  defineTool({
    name: "remove_animation_controller",
    description: "Removes one controller from the visible project with Undo support. Leaves any existing animation-controller file on disk intact.",
    annotations: { title: "Remove Animation Controller", destructiveHint: true },
    parameters: z.object({ id: z.string().min(1) }).strict(), status: "stable",
    async execute({ id }) {
      const controller = findControllerOrThrow(id);
      controller.selected_state?.unselect();
      controller.remove(true, false);
      return JSON.stringify({ removed: controller.uuid, name: controller.name });
    },
  }),
];
