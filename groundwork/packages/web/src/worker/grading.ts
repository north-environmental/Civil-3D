/** Grading work executed inside the worker. Filled in with the grading engine (Phase 5). */
export function handleGradingMessage(_payload: unknown): { result: unknown; transfer: Transferable[] } {
  return { result: null, transfer: [] };
}
