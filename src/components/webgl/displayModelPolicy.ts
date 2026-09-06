export const MAX_ACTIVE_DISPLAY_MODELS = 40;
export const FIXED_AWARD_MODEL_COUNT = 23;
export const MAX_VARIABLE_DISPLAY_MODELS = MAX_ACTIVE_DISPLAY_MODELS - FIXED_AWARD_MODEL_COUNT;
// Award GLBs keep 23 fixed slots. Designer GLBs and /submit splats share the
// remaining 17 live slots, so the combined on-screen total never exceeds 40.
// Reservation uploads persist permanently and rotate when their queue exceeds
// the shared live capacity.
export const MAX_ACTIVE_DESIGNER_MODELS = MAX_VARIABLE_DISPLAY_MODELS;
export const MAX_ACTIVE_SUBMIT_MODELS = MAX_VARIABLE_DISPLAY_MODELS;
export const DYNAMIC_MODEL_ROTATION_MS = 30_000;
export const DYNAMIC_MODELS_REPLACED_PER_CYCLE = 1;
export const ADAPTIVE_VARIABLE_MODEL_LIMIT_STORAGE_KEY = 'cosmos:adaptive-variable-model-limit';
export const ADAPTIVE_VARIABLE_MODEL_REDUCTION_STEP = 6;

export function normalizeVariableModelLimit(value: number) {
  if (!Number.isFinite(value)) return MAX_VARIABLE_DISPLAY_MODELS;
  return Math.min(MAX_VARIABLE_DISPLAY_MODELS, Math.max(0, Math.floor(value)));
}

export function reduceVariableModelLimit(currentLimit: number) {
  return Math.max(
    0,
    normalizeVariableModelLimit(currentLimit) - ADAPTIVE_VARIABLE_MODEL_REDUCTION_STEP
  );
}

export type DynamicDisplayQueueEntry = {
  key: string;
  createdAt: number;
};

export function mergeDynamicDisplayQueues<T extends DynamicDisplayQueueEntry>(
  ...queues: ReadonlyArray<readonly T[]>
) {
  return queues
    .flat()
    .sort((left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key));
}

export function getNewestModelWindowOffset(modelCount: number, slotCount: number) {
  const total = Math.max(0, Math.floor(modelCount));
  const count = Math.min(Math.max(0, Math.floor(slotCount)), total);
  return Math.max(0, total - count);
}

export function prioritizeActiveModelIds(
  activeModelIds: Iterable<string>,
  priorityModelIds: Iterable<string | null | undefined>
) {
  const activeIds = [...activeModelIds];
  const activeIdSet = new Set(activeIds);
  const priorityIds: string[] = [];
  const seenIds = new Set<string>();
  for (const id of priorityModelIds) {
    if (!id || seenIds.has(id) || !activeIdSet.has(id)) continue;
    priorityIds.push(id);
    seenIds.add(id);
  }
  return [...priorityIds, ...activeIds.filter((id) => !seenIds.has(id))];
}

export function selectRotatingModels<T>(models: readonly T[], slotCount: number, offset: number) {
  const count = Math.min(Math.max(0, Math.floor(slotCount)), models.length);
  if (count === 0) return [];
  if (count === models.length) return [...models];

  const start = ((Math.floor(offset) % models.length) + models.length) % models.length;
  return Array.from({ length: count }, (_, index) => models[(start + index) % models.length]);
}
