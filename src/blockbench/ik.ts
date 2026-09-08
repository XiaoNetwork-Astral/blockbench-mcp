import { findElementOrThrow } from "@/lib/util";

export type IKController = OutlinerElement & {
  position: ArrayVector3;
  ik_source: string;
  ik_target: string;
  lock_ik_target_rotation: boolean;
  getWorldCenter(animated?: boolean): THREE.Vector3;
};

export interface IKChain {
  controller: IKController;
  bones: OutlinerNode[];
  endpoint: OutlinerNode;
}

export function findIKController(reference: string): IKController {
  const node = findElementOrThrow(reference);
  if (node.type !== "null_object") throw new Error(`IK is configured on a native null_object, not "${node.name}" (${node.type}). Pass the null object's UUID or unique name as bone_data.name.`);
  if (!Format.animation_mode) throw new Error(`Format "${Format.id}" does not support native IK.`);
  return node as IKController;
}

export function resolveIKChain(controller: IKController, sourceRef = controller.ik_source, targetRef = controller.ik_target): IKChain {
  if (!targetRef) throw new Error(`IK controller "${controller.name}" has no enabled ik_target.`);
  const endpoint = findElementOrThrow(targetRef);
  if (!(endpoint instanceof Group) && !["armature_bone", "locator"].includes(endpoint.type)) {
    throw new Error("ik_target must be a group, armature bone, or locator.");
  }
  const source = sourceRef ? findElementOrThrow(sourceRef) : controller.parent;
  if (source !== "root" && !(source instanceof Group) && source.type !== "armature_bone") {
    throw new Error("ik_source must be an ancestor group or armature bone.");
  }
  const bones: OutlinerNode[] = [];
  let node = endpoint.parent;
  while (node !== source && node !== "root") {
    if (!(node instanceof Group) && node.type !== "armature_bone") throw new Error(`Unsupported node "${node.name}" inside the IK chain.`);
    bones.unshift(node);
    node = node.parent;
    if (bones.length > 128) throw new Error("IK chains are limited to 128 bones.");
  }
  if (node !== source) throw new Error("ik_target must be a descendant of ik_source (or the controller's parent when no source is set).");
  if (sourceRef && source !== "root") bones.unshift(source);
  if (!bones.length) throw new Error("The IK chain contains no rotating bones.");
  if (bones.includes(controller.parent as OutlinerNode)) {
    throw new Error("The IK controller cannot be parented inside the chain it drives; use a common parent outside the chain.");
  }
  return { controller, bones, endpoint };
}

export function configureNativeIK(data: {
  name: string; ik_enabled?: boolean; ik_source?: string; ik_target?: string;
  lock_ik_target_rotation?: boolean; target_position?: number[]; position_space?: "native" | "world";
}) {
  const controller = findIKController(data.name);
  const source = data.ik_source === undefined ? controller.ik_source : data.ik_source ? findElementOrThrow(data.ik_source).uuid : "";
  const target = data.ik_target === undefined ? controller.ik_target : data.ik_target ? findElementOrThrow(data.ik_target).uuid : "";
  const enabled = data.ik_enabled ?? Boolean(target);
  const chain = enabled ? resolveIKChain(controller, source, target) : undefined;
  let position = data.target_position;
  if (position && data.position_space === "world") {
    const Three = (globalThis as typeof globalThis & { THREE: typeof import("three") }).THREE;
    const parent = controller.scene_object.parent;
    if (!parent) throw new Error("The controller has no scene parent.");
    parent.updateWorldMatrix(true, false);
    if (Math.abs(parent.matrixWorld.determinant()) < 1e-12) throw new Error("The controller parent has a non-invertible transform.");
    const local = parent.worldToLocal(new Three.Vector3(...position));
    if (Format.bone_rig && controller.parent instanceof Group) local.add(new Three.Vector3(...controller.parent.origin));
    position = local.toArray();
  }
  Undo.initEdit({ elements: [controller] });
  try {
    controller.ik_source = source;
    controller.ik_target = enabled ? target : "";
    if (data.lock_ik_target_rotation !== undefined) controller.lock_ik_target_rotation = data.lock_ik_target_rotation;
    if (position) controller.position.splice(0, 3, ...position);
    controller.preview_controller.updateTransform(controller);
    Undo.finishEdit("Configure native IK", { elements: [controller] });
  } catch (error) {
    (Undo.cancelEdit as unknown as (revert?: boolean) => void)(true);
    throw error;
  }
  Animator.preview();
  return {
    controller: { uuid: controller.uuid, name: controller.name, type: controller.type },
    enabled, ik_source: controller.ik_source, ik_target: controller.ik_target,
    lock_ik_target_rotation: controller.lock_ik_target_rotation, position: [...controller.position],
    bones: chain?.bones.map(bone => ({ uuid: bone.uuid, name: bone.name })) ?? [],
    endpoint: chain ? { uuid: chain.endpoint.uuid, name: chain.endpoint.name } : null,
  };
}
