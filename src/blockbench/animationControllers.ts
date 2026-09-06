import { z } from "zod";
import { findAnimationOrThrow } from "@/src/blockbench/animation";

const name = z.string().min(1).max(256);
const expression = z.string().max(16_384);
export const controllerStatesSchema = z.array(z.object({
  name,
  animations: z.array(z.object({
    animation: name.describe("An existing animation UUID or unambiguous exact name."),
    blend: expression.default(""),
  }).strict()).max(128).default([]),
  transitions: z.array(z.object({ target: name, condition: expression }).strict()).max(128).default([]),
  on_entry: expression.default(""),
  on_exit: expression.default(""),
  blend_transition: z.number().finite().min(0).max(3600).default(0),
  blend_via_shortest_path: z.boolean().default(false),
  particle_effects: z.array(z.object({
    effect: name, locator: z.string().max(256).default(""),
    bind_to_actor: z.boolean().default(true), pre_effect_script: expression.default(""),
  }).strict()).max(128).default([]),
  sound_effects: z.array(z.object({ effect: name }).strict()).max(128).default([]),
}).strict()).min(1).max(128);

// The 5.1 type package inherits the animation-only static list from AnimationItem.
export function allControllers(): AnimationController[] {
  return AnimationController.all as unknown as AnimationController[];
}

export function findControllerOrThrow(id: string): AnimationController {
  const exact = allControllers().find(item => item.uuid === id);
  if (exact) return exact;
  const matches = allControllers().filter(item => item.name === id);
  if (matches.length !== 1) throw new Error(matches.length ? `Animation controller "${id}" is ambiguous; use a UUID.` : `Animation controller "${id}" was not found.`);
  return matches[0];
}

export function assertControllerName(name: string, except?: AnimationController): void {
  if (allControllers().some(item => item !== except && item.name === name)) {
    throw new Error(`Animation controller "${name}" already exists.`);
  }
}

/** Resolve the entire graph before opening Undo; transitions never depend on delayed native imports. */
export function prepareControllerGraph(states: z.infer<typeof controllerStatesSchema>, initial: string) {
  const names = new Set(states.map(state => state.name));
  if (names.size !== states.length) throw new Error("Controller state names must be unique.");
  if (!names.has(initial)) throw new Error(`Initial state "${initial}" does not exist.`);
  return states.map(state => {
    for (const transition of state.transitions) {
      if (!names.has(transition.target)) throw new Error(`Transition from "${state.name}" targets missing state "${transition.target}".`);
    }
    return {
      ...state,
      animations: state.animations.map(entry => {
        const animation = findAnimationOrThrow(entry.animation) as _Animation & { getShortName(): string };
        return { uuid: guid(), key: animation.getShortName(), animation: animation.uuid, blend_value: entry.blend };
      }),
    };
  });
}

export function applyControllerGraph(controller: AnimationController, states: ReturnType<typeof prepareControllerGraph>, initial: string): void {
  controller.selected_state?.unselect();
  controller.selected_state = null;
  const previous = controller.states.splice(0);
  for (const input of states) {
    const existing = previous.find(state => state.name === input.name);
    if (existing) controller.states.push(existing);
    else new AnimationControllerState(controller, { name: input.name });
  }
  states.forEach((input, index) => {
    const nativeInput = {
      ...input,
      transitions: input.transitions.map(transition => ({ uuid: guid(), target: controller.states.find(state => state.name === transition.target)!.uuid, condition: transition.condition })),
    };
    // The published 5.1 declarations still type blend_value as number; the native controller uses Molang strings.
    const state = controller.states[index] as unknown as { extend(data: typeof nativeInput): void };
    state.extend(nativeInput);
  });
  controller.initial_state = controller.states.find(state => state.name === initial)!.uuid;
  controller.saved = false;
}

export function describeController(controller: AnimationController, includeStates = true) {
  return {
    uuid: controller.uuid, name: controller.name,
    initial_state: controller.states.find(state => state.uuid === controller.initial_state)?.name ?? controller.states[0]?.name ?? null,
    state_count: controller.states.length,
    ...(includeStates ? { definition: controller.compileForBedrock(), state_ids: Object.fromEntries(controller.states.map(state => [state.name, state.uuid])) } : {}),
  };
}

export type ImportedControllerStates = Record<string, { transitions?: Record<string, string>[] }>;

/** Native Bedrock imports defer forward references; resolve them before Undo captures the result. */
export function resolveImportedControllerTransitions(controller: AnimationController, states: ImportedControllerStates): void {
  for (const state of controller.states) {
    const transitions = states[state.name]?.transitions ?? [];
    transitions.forEach((entry, index) => {
      const name = Object.keys(entry)[0];
      const target = controller.states.find(candidate => candidate.name === name);
      if (!target) throw new Error(`Transition from "${state.name}" targets missing state "${name}".`);
      if (state.transitions[index]) state.transitions[index].target = target.uuid;
    });
  }
}
