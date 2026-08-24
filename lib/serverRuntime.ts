export type McpServerRuntimeState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping";

const listeners = new Set<(state: McpServerRuntimeState) => void>();
let state: McpServerRuntimeState = "stopped";

export function getMcpServerState(): McpServerRuntimeState {
  return state;
}

export function setMcpServerState(next: McpServerRuntimeState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener(state);
}

export function subscribeMcpServerState(
  listener: (state: McpServerRuntimeState) => void
): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}
