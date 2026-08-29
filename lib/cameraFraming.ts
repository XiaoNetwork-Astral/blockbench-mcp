/**
 * Returns a conservative camera-to-center distance that contains a bounding
 * sphere inside the requested fraction of both viewport axes.
 */
export function fitBoundingSpherePerspectiveDistance(
  radius: number,
  verticalFovDegrees: number,
  aspect: number,
  frameOccupancy: number
): number {
  if (!(radius > 0) || !Number.isFinite(radius)) {
    throw new Error("Perspective framing radius must be finite and positive.");
  }
  if (!(aspect > 0) || !Number.isFinite(aspect)) {
    throw new Error("Perspective framing aspect ratio must be finite and positive.");
  }
  if (!(frameOccupancy > 0 && frameOccupancy <= 1)) {
    throw new Error("Perspective frame occupancy must be in (0, 1].");
  }
  const verticalHalfAngle = verticalFovDegrees * Math.PI / 360;
  if (!(verticalHalfAngle > 0 && verticalHalfAngle < Math.PI / 2)) {
    throw new Error("Perspective vertical field of view must be between 0 and 180 degrees.");
  }
  const horizontalHalfAngle = Math.atan(Math.tan(verticalHalfAngle) * aspect);
  const limitingTangent = Math.tan(Math.min(verticalHalfAngle, horizontalHalfAngle))
    * frameOccupancy;
  // A sphere's apparent radius is r/sqrt(d^2-r^2). Solving that
  // against the limiting image-plane tangent avoids the clipping caused by
  // the common r/tan(theta) point approximation.
  return radius * Math.sqrt(1 + 1 / (limitingTangent * limitingTangent));
}
