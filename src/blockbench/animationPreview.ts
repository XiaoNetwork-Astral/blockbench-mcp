import type * as Three from "three";

/** Restore the actual rendered pose even when native sampling resets it in edit mode. */
export function captureAnimationPreview(project: ModelProject): () => void {
  const nodes: Array<{
    node: Three.Object3D; position: Three.Vector3; quaternion: Three.Quaternion;
    scale: Three.Vector3; visible: boolean; auto: boolean; order: Three.Euler["order"];
    fixPosition?: Three.Vector3; fixRotation?: Three.Euler;
  }> = [];
  project.model_3d?.traverse(node => {
    const fixed = node as Three.Object3D & { fix_position?: Three.Vector3; fix_rotation?: Three.Euler };
    nodes.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible, auto: node.matrixAutoUpdate, order: node.rotation.order, fixPosition: fixed.fix_position?.clone(), fixRotation: fixed.fix_rotation?.clone() });
  });
  const nativeAnimation = (globalThis as unknown as { Animation: { selected: _Animation | null } }).Animation;
  const selectedAnimation = nativeAnimation.selected;
  const animations = (project.animations ?? Animator.animations).map(animation => ({ animation, selected: animation.selected, playing: animation.playing, animators: { ...animation.animators } }));
  const time = Timeline.time;
  const playing = Timeline.playing;
  const selectedKeys = [...Timeline.selected];
  const timelineAnimators = [...Timeline.animators];
  const selectedAnimator = Timeline.selected_animator;
  const selectedNodes = typeof Outliner === "undefined" ? [] : [...Outliner.selected];
  const mode = typeof Modes === "undefined" || typeof Modes.selected !== "object" ? undefined : Modes.selected;
  const nativeAnimator = Animator as typeof Animator & { _last_values: Record<string, unknown> };
  const lastValues = structuredClone(nativeAnimator._last_values);
  if (playing) Timeline.pause();
  return () => {
    if (Timeline.playing) Timeline.pause();
    if (mode && Modes.selected !== mode) mode.select();
    animations.forEach(saved => {
      saved.animation.selected = saved.selected;
      saved.animation.playing = saved.playing;
      for (const id of Object.keys(saved.animation.animators)) {
        if (!(id in saved.animators)) delete saved.animation.animators[id];
      }
    });
    nativeAnimation.selected = selectedAnimation;
    Timeline.animators.splice(0, Timeline.animators.length, ...timelineAnimators);
    Timeline.selected_animator = selectedAnimator;
    for (const key of Timeline.selected) key.selected = false;
    Timeline.selected.splice(0, Timeline.selected.length, ...selectedKeys);
    selectedKeys.forEach(key => { key.selected = true; });
    if (typeof Outliner !== "undefined") {
      Outliner.selected.forEach(node => { node.selected = false; });
      Outliner.selected.splice(0, Outliner.selected.length, ...selectedNodes);
      selectedNodes.forEach(node => { node.selected = true; });
    }
    Timeline.setTime(time);
    nativeAnimator._last_values = lastValues;
    if (playing) {
      Timeline.start();
      Timeline.setTime(time);
    }
    for (const saved of nodes) {
      saved.node.rotation.order = saved.order;
      saved.node.position.copy(saved.position);
      saved.node.quaternion.copy(saved.quaternion);
      saved.node.scale.copy(saved.scale);
      saved.node.visible = saved.visible;
      saved.node.matrixAutoUpdate = saved.auto;
      const fixed = saved.node as Three.Object3D & { fix_position?: Three.Vector3; fix_rotation?: Three.Euler };
      if (saved.fixPosition) fixed.fix_position?.copy(saved.fixPosition);
      if (saved.fixRotation) fixed.fix_rotation?.copy(saved.fixRotation);
      saved.node.updateMatrix();
    }
    project.model_3d?.updateMatrixWorld(true);
  };
}
