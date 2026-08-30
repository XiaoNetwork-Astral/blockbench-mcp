let tail: Promise<void> = Promise.resolve();

/**
 * Blockbench has one global Undo transaction at a time. Serialize MCP
 * mutations so concurrent HTTP requests cannot interleave those transactions.
 */
export async function runMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
