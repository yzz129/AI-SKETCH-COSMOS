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
