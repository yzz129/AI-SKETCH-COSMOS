export function resolveModelPresentationVisibility(
  hasAsyncModel: boolean,
  loadVisibility: number
) {
  if (!hasAsyncModel) return 1;
  if (!Number.isFinite(loadVisibility)) return 0;
  return Math.min(1, Math.max(0, loadVisibility));
}

export function isModelPresentationVisible(
  hasAsyncModel: boolean,
  loadVisibility: number
) {
  return resolveModelPresentationVisibility(hasAsyncModel, loadVisibility) > 0.001;
}
