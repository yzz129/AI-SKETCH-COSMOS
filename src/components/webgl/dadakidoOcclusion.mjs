export const DADAKIDO_RENDER_ORDER = 4;
export const CREATURE_FRONT_RENDER_ORDER = 10;
export const CREATURE_BEHIND_RENDER_ORDER = -1;

export function resolveCreatureRenderOrder(creatureViewDepth, dadakidoViewDepth) {
  if (!Number.isFinite(creatureViewDepth) || !Number.isFinite(dadakidoViewDepth)) {
    return CREATURE_FRONT_RENDER_ORDER;
  }
  return creatureViewDepth < dadakidoViewDepth
    ? CREATURE_FRONT_RENDER_ORDER
    : CREATURE_BEHIND_RENDER_ORDER;
}

export function resolveCreatureOcclusionStrength(
  creatureViewDepth,
  dadakidoViewDepth,
  transitionDepth = 0.9
) {
  if (
    !Number.isFinite(creatureViewDepth)
    || !Number.isFinite(dadakidoViewDepth)
    || !Number.isFinite(transitionDepth)
    || transitionDepth <= 0
  ) {
    return 0;
  }

  const frontDepth = dadakidoViewDepth - creatureViewDepth;
  const progress = Math.max(0, Math.min(1, frontDepth / transitionDepth));
  return progress * progress * (3 - 2 * progress);
}
