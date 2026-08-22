import type { Box3, BufferGeometry, Object3D } from "three";

export interface OutlinerGeometryNode {
  scene_object: Object3D;
  children?: OutlinerGeometryNode[];
}

type ObjectWithGeometry = Object3D & {
  geometry?: BufferGeometry;
};

/**
 * Expands `target` with model geometry owned by an Outliner node and its
 * Outliner descendants.
 *
 * Blockbench attaches editor-only helpers such as selection outlines and
 * pixel grids below an element's scene object. Box3.setFromObject() traverses
 * those helpers as well, so its result depends on editor state. Inspect only
 * the geometry directly owned by each Outliner node, then recurse through the
 * logical Outliner tree; helper scene children are deliberately ignored.
 */
export function expandOutlinerGeometryWorldBounds(
  node: OutlinerGeometryNode,
  target: Box3
): Box3 {
  const sceneObject = node.scene_object as ObjectWithGeometry;
  sceneObject.updateWorldMatrix(true, false);

  const geometry = sceneObject.geometry;
  if (geometry?.attributes?.position) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
      target.union(geometry.boundingBox.clone().applyMatrix4(sceneObject.matrixWorld));
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      expandOutlinerGeometryWorldBounds(child, target);
    }
  }
  return target;
}
