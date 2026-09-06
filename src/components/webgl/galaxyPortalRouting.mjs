export const PORTAL_ATTRACTION_MIN_RADIUS = 3.2;
export const PORTAL_ATTRACTION_RADIUS_MULTIPLIER = 1.6;

export function portalAttractionRadius(visualRadius) {
  return Math.max(
    PORTAL_ATTRACTION_MIN_RADIUS,
    Math.max(0, visualRadius) * PORTAL_ATTRACTION_RADIUS_MULTIPLIER
  );
}

export function portalSuctionProgress(rawProgress) {
  const progress = Math.min(1, Math.max(0, rawProgress));
  const smooth = progress * progress * progress
    * (progress * (progress * 6 - 15) + 10);
  return 1 - Math.pow(1 - smooth, 2.35);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isConfirmedChasedPrey(creatureId, intents, now) {
  const flee = intents[creatureId];
  if (!flee || flee.mode !== 'flee' || flee.expiresAt <= now) return false;
  const chase = intents[flee.targetId];
  return Boolean(
    chase
    && chase.mode === 'chase'
    && chase.targetId === creatureId
    && chase.expiresAt > now
  );
}

export function choosePortalExit(entryId, portalIds, creatureId, eventSequence) {
  const candidates = [...new Set(portalIds)]
    .filter((id) => id !== entryId)
    .sort((left, right) => left.localeCompare(right));
  if (candidates.length === 0) return null;
  return candidates[hashString(`${creatureId}|${eventSequence}|${entryId}`) % candidates.length];
}
