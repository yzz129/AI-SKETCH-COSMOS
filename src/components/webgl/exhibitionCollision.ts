const reactionStartedAtByCreature = new Map<string, number>();

export const EXHIBITION_COLLISION_RADIUS = 0.9;
export const EXHIBITION_REACTION_DURATION = 1.15;

export function triggerExhibitionCollisionReaction(creatureId: string, nowSeconds: number) {
  reactionStartedAtByCreature.set(creatureId, nowSeconds);
}

export function getExhibitionCollisionReaction(creatureId: string, nowSeconds: number) {
  const startedAt = reactionStartedAtByCreature.get(creatureId);
  if (startedAt === undefined) return 0;
  const progress = (nowSeconds - startedAt) / EXHIBITION_REACTION_DURATION;
  if (progress >= 1) {
    reactionStartedAtByCreature.delete(creatureId);
    return 0;
  }
  if (progress < 0) return 0;
  // Three quick, diminishing movements. This transforms only the whole model,
  // so splat points, vertices and bones remain untouched.
  return Math.sin(progress * Math.PI * 6) * (1 - progress);
}

export function clearExhibitionCollisionReaction(creatureId: string) {
  reactionStartedAtByCreature.delete(creatureId);
}
