/** Web worker: heavy pure-core computations off the UI thread (contours now; grading later). */
import { type Grid, contours } from '@groundwork/core';
import { handleGradingMessage } from './grading';

export type WorkerRequest =
  | { id: number; type: 'existingContours'; dem: Grid }
  | { id: number; type: 'grade'; payload: unknown };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'existingContours') {
      const sets = contours(msg.dem, 1, 5);
      (self as any).postMessage({ id: msg.id, ok: true, result: sets });
    } else if (msg.type === 'grade') {
      const { result, transfer } = handleGradingMessage(msg.payload);
      (self as any).postMessage({ id: msg.id, ok: true, result }, transfer);
    }
  } catch (err) {
    (self as any).postMessage({ id: msg.id, ok: false, error: (err as Error).message });
  }
};
