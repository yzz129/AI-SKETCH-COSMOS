export const MAX_CONCURRENT_SPLAT_LOADS = 3;
export const MAX_BACKGROUND_SPLAT_LOADS = 2;

type ReleaseSplatLoadSlot = () => void;

type PendingSplatLoad = {
  order: number;
  priority: () => number;
  resolve: (release: ReleaseSplatLoadSlot) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

let nextOrder = 0;
let activeLoads = 0;
let activeBackgroundLoads = 0;
const pendingLoads: PendingSplatLoad[] = [];

function abortError() {
  const error = new Error('Splat model load was cancelled.');
  error.name = 'AbortError';
  return error;
}

function removePendingLoad(load: PendingSplatLoad) {
  const index = pendingLoads.indexOf(load);
  if (index >= 0) pendingLoads.splice(index, 1);
}

function drainSplatLoadQueue() {
  pendingLoads.sort((left, right) => (
    right.priority() - left.priority() || left.order - right.order
  ));

  while (activeLoads < MAX_CONCURRENT_SPLAT_LOADS && pendingLoads.length > 0) {
    const nextIndex = pendingLoads.findIndex((load) => (
      load.priority() > 0 || activeBackgroundLoads < MAX_BACKGROUND_SPLAT_LOADS
    ));
    if (nextIndex < 0) return;

    const load = pendingLoads.splice(nextIndex, 1)[0];
    if (load.signal?.aborted) {
      load.reject(abortError());
      continue;
    }

    if (load.abort && load.signal) load.signal.removeEventListener('abort', load.abort);
    const background = load.priority() <= 0;
    activeLoads += 1;
    if (background) activeBackgroundLoads += 1;

    let released = false;
    load.resolve(() => {
      if (released) return;
      released = true;
      activeLoads = Math.max(0, activeLoads - 1);
      if (background) activeBackgroundLoads = Math.max(0, activeBackgroundLoads - 1);
      drainSplatLoadQueue();
    });
  }
}

export function refreshSplatLoadQueue() {
  drainSplatLoadQueue();
}

export function acquireSplatLoadSlot(
  priority: () => number,
  signal?: AbortSignal
): Promise<ReleaseSplatLoadSlot> {
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const load: PendingSplatLoad = {
      order: nextOrder++,
      priority,
      resolve,
      reject,
      signal
    };
    load.abort = () => {
      removePendingLoad(load);
      reject(abortError());
      drainSplatLoadQueue();
    };
    signal?.addEventListener('abort', load.abort, { once: true });
    pendingLoads.push(load);
    drainSplatLoadQueue();
  });
}
