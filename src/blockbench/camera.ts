/// <reference types="blockbench-types" />

export interface McpCameraState {
  position: [number, number, number];
  target?: [number, number, number];
  rotation?: [number, number, number];
  projection: "orthographic" | "perspective";
  zoom?: number;
  fov?: number;
  viewport?: [number, number];
}
