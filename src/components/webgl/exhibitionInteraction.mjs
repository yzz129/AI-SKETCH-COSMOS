export const EXHIBITION_INTERACTION_ID_PREFIX = 'exhibition-glb:';
export const EXHIBITION_ENTRY_FOCUS_PREFIX = 'exhibition-entry:';

export function exhibitionInteractionId(modelId) {
  return `${EXHIBITION_INTERACTION_ID_PREFIX}${modelId}`;
}

export function exhibitionEntryFocusId(modelId) {
  return `${EXHIBITION_ENTRY_FOCUS_PREFIX}${modelId}`;
}

export function isExhibitionInteractionId(id) {
  return typeof id === 'string' && id.startsWith(EXHIBITION_INTERACTION_ID_PREFIX);
}

export function exhibitionModelIdFromInteractionId(id) {
  return isExhibitionInteractionId(id)
    ? id.slice(EXHIBITION_INTERACTION_ID_PREFIX.length)
    : null;
}

export function battleParticipantHasEvolution(id) {
  return !isExhibitionInteractionId(id);
}

export function battleEngagementDistance(
  firstId,
  secondId,
  ordinaryDistance = 1.68,
  exhibitionDistance = 4.8
) {
  return isExhibitionInteractionId(firstId) || isExhibitionInteractionId(secondId)
    ? exhibitionDistance
    : ordinaryDistance;
}
