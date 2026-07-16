export type PortalIntent = {
  mode: 'chase' | 'flee';
  targetId: string;
  expiresAt: number;
};

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isConfirmedChasedPrey(
  creatureId: string,
  intents: Record<string, PortalIntent | undefined>,
  now: number
) {
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

export function choosePortalExit(
  entryId: string,
  portalIds: readonly string[],
  creatureId: string,
  eventSequence: number
) {
  const candidates = [...new Set(portalIds)]
    .filter((id) => id !== entryId)
    .sort((left, right) => left.localeCompare(right));
  if (candidates.length === 0) return null;
  const hash = hashString(`${creatureId}|${eventSequence}|${entryId}`);
  return candidates[hash % candidates.length];
}
