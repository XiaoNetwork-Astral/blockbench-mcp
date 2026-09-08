import type * as Three from "three";

export interface IKJointLimit {
  joint: "root" | "middle";
  swing_limit: number;
  twist_min: number;
  twist_max: number;
}

export interface TwoBoneOptions {
  pole: Three.Vector3;
  bend_min: number;
  bend_max: number;
  joint_limits: IKJointLimit[];
  tolerance: number;
}

const EPSILON = 1e-9;
const api = () => (globalThis as typeof globalThis & { THREE: typeof import("three") }).THREE;

function worldPosition(node: Three.Object3D): Three.Vector3 {
  return node.getWorldPosition(new (api().Vector3)());
}

function aim(node: Three.Object3D, endpoint: Three.Object3D, desired: Three.Vector3): void {
  const T = api();
  const origin = worldPosition(node);
  const from = worldPosition(endpoint).sub(origin).normalize();
  const to = desired.clone().sub(origin).normalize();
  if (to.lengthSq() < EPSILON || from.lengthSq() < EPSILON) return;
  const world = node.getWorldQuaternion(new T.Quaternion());
  world.premultiply(new T.Quaternion().setFromUnitVectors(from, to));
  const parent = node.parent?.getWorldQuaternion(new T.Quaternion()) ?? new T.Quaternion();
  node.quaternion.copy(parent.invert().multiply(world));
  node.updateWorldMatrix(false, true);
}

function jointAngles(node: Three.Object3D, rest: Three.Quaternion, axis: Three.Vector3) {
  const T = api();
  const relative = rest.clone().invert().multiply(node.quaternion).normalize();
  if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w);
  const projection = new T.Vector3(relative.x, relative.y, relative.z).dot(axis);
  const twist = new T.Quaternion(axis.x * projection, axis.y * projection, axis.z * projection, relative.w);
  if (twist.lengthSq() < EPSILON) twist.identity();
  else twist.normalize();
  const swing = relative.clone().multiply(twist.clone().invert()).normalize();
  const signedTwist = 2 * Math.atan2(new T.Vector3(twist.x, twist.y, twist.z).dot(axis), twist.w);
  const swingAngle = 2 * Math.acos(T.MathUtils.clamp(Math.abs(swing.w), -1, 1));
  return { swing, twist: signedTwist, swingAngle };
}

function applyJointLimit(node: Three.Object3D, rest: Three.Quaternion, axis: Three.Vector3, limit: IKJointLimit): void {
  const T = api();
  const angles = jointAngles(node, rest, axis);
  const maximumSwing = T.MathUtils.degToRad(limit.swing_limit);
  if (angles.swingAngle > maximumSwing) angles.swing.slerp(new T.Quaternion(), 1 - maximumSwing / angles.swingAngle);
  const twist = T.MathUtils.clamp(angles.twist, T.MathUtils.degToRad(limit.twist_min), T.MathUtils.degToRad(limit.twist_max));
  node.quaternion.copy(rest).multiply(angles.swing).multiply(new T.Quaternion().setFromAxisAngle(axis, twist));
  node.updateWorldMatrix(false, true);
}

/** Analytic two-segment solve. Limits restrict the pose; residuals remain explicit. */
export function solveTwoBone(
  root: Three.Object3D, middle: Three.Object3D, endpoint: Three.Object3D,
  goal: Three.Vector3, options: TwoBoneOptions,
) {
  const T = api();
  root.updateWorldMatrix(true, true);
  const start = worldPosition(root);
  const joint = worldPosition(middle);
  const end = worldPosition(endpoint);
  const lengths = [start.distanceTo(joint), joint.distanceTo(end)];
  if (lengths.some(length => length < EPSILON)) throw new Error("Two-bone IK requires two non-zero bone lengths.");
  for (const node of [root, middle]) {
    const scale = node.getWorldScale(new T.Vector3());
    if (scale.x <= 0 || Math.abs(scale.x - scale.y) > 1e-6 || Math.abs(scale.y - scale.z) > 1e-6) {
      throw new Error("Two-bone IK requires positive uniform bone/parent scale; rotated parents are supported.");
    }
  }
  const rests = [root, middle].map(node => {
    const fixed = (node as Three.Object3D & { fix_rotation?: Three.Euler }).fix_rotation;
    return fixed ? new T.Quaternion().setFromEuler(fixed) : node.quaternion.clone();
  });
  const axes = [middle.position.clone().normalize(), endpoint.position.clone().normalize()];
  const direction = goal.clone().sub(start);
  const distance = direction.length();
  if (distance > EPSILON) direction.divideScalar(distance);
  else {
    direction.copy(end).sub(start);
    if (direction.lengthSq() < EPSILON) direction.copy(joint).sub(start);
    direction.normalize();
  }
  const pole = options.pole.clone().sub(start);
  pole.addScaledVector(direction, -pole.dot(direction));
  if (pole.lengthSq() < EPSILON) throw new Error("The pole target is on the root-to-target axis. Move it away from that axis to define a stable bend direction.");
  pole.normalize();
  const [a, b] = lengths;
  const distanceAtBend = (degrees: number) => Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(T.MathUtils.degToRad(degrees))));
  const minimum = distanceAtBend(options.bend_max);
  const maximum = distanceAtBend(options.bend_min);
  const effectiveDistance = T.MathUtils.clamp(distance, minimum, maximum);
  const along = effectiveDistance < EPSILON ? 0 : (a * a - b * b + effectiveDistance * effectiveDistance) / (2 * effectiveDistance);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const desiredJoint = start.clone().addScaledVector(direction, along).addScaledVector(pole, height);
  const desiredEnd = start.clone().addScaledVector(direction, effectiveDistance);
  aim(root, middle, desiredJoint);
  aim(middle, endpoint, desiredEnd);
  for (const limit of options.joint_limits) {
    const index = limit.joint === "root" ? 0 : 1;
    applyJointLimit(index === 0 ? root : middle, rests[index], axes[index], limit);
  }
  const finalJoint = worldPosition(middle);
  const finalEnd = worldPosition(endpoint);
  const upper = finalJoint.clone().sub(start).normalize();
  const lower = finalEnd.clone().sub(finalJoint).normalize();
  const bend = T.MathUtils.radToDeg(Math.acos(T.MathUtils.clamp(upper.dot(lower), -1, 1)));
  const residual = finalEnd.distanceTo(goal);
  const finalLengths = [start.distanceTo(finalJoint), finalJoint.distanceTo(finalEnd)];
  const jointAnglesReport = options.joint_limits.map(limit => {
    const index = limit.joint === "root" ? 0 : 1;
    const angles = jointAngles(index === 0 ? root : middle, rests[index], axes[index]);
    return { joint: limit.joint, swing: T.MathUtils.radToDeg(angles.swingAngle), twist: T.MathUtils.radToDeg(angles.twist) };
  });
  return {
    solver: "two_bone" as const, residual, converged: residual <= options.tolerance,
    geometrically_reachable: distance <= a + b + options.tolerance && distance >= Math.abs(a - b) - options.tolerance,
    within_bend_range: distance >= minimum - options.tolerance && distance <= maximum + options.tolerance,
    constraints_satisfied: bend >= options.bend_min - 1e-5 && bend <= options.bend_max + 1e-5,
    bend_angle: bend, joint_angles: jointAnglesReport,
    lengths, max_length_error: Math.max(...lengths.map((length, index) => Math.abs(length - finalLengths[index]))),
    target: goal.toArray(), endpoint: finalEnd.toArray(), pole: options.pole.toArray(),
  };
}
