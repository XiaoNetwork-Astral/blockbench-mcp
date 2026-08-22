interface UndoSafetyTarget {
  current_save?: unknown;
  cancelEdit(revertChanges?: boolean): void;
}

function currentUndoSystem(): UndoSafetyTarget | undefined {
  return (globalThis as typeof globalThis & { Undo?: UndoSafetyTarget }).Undo;
}

export function captureUndoEditToken(): unknown {
  return currentUndoSystem()?.current_save;
}

/**
 * Cancel only an Undo edit opened during the current MCP invocation. An edit
 * that was already open when the tool began belongs to Blockbench or the user
 * and must never be canceled by this wrapper.
 */
export function rollbackUndoEditStartedAfter(startToken: unknown): boolean {
  const undo = currentUndoSystem();
  if (!undo?.current_save || undo.current_save === startToken) return false;

  try {
    undo.cancelEdit(true);
  } catch {
    try {
      undo.cancelEdit(false);
    } catch {
      // Do not replace the original tool failure with cleanup noise.
    }
  }
  return true;
}
