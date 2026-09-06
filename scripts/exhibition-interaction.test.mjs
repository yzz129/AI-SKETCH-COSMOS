import assert from 'node:assert/strict';
import test from 'node:test';
import {
  battleEngagementDistance,
  battleParticipantHasEvolution,
  exhibitionEntryFocusId,
  exhibitionInteractionId,
  exhibitionModelIdFromInteractionId,
  isExhibitionInteractionId
} from '../src/components/webgl/exhibitionInteraction.mjs';

test('GLB exhibition models receive stable interaction and spotlight ids', () => {
  const interactionId = exhibitionInteractionId('award-01');
  assert.equal(interactionId, 'exhibition-glb:award-01');
  assert.equal(exhibitionEntryFocusId('award-01'), 'exhibition-entry:award-01');
  assert.equal(isExhibitionInteractionId(interactionId), true);
  assert.equal(exhibitionModelIdFromInteractionId(interactionId), 'award-01');
});

test('GLB fighters use the wider engagement range but never evolution records', () => {
  const glbId = exhibitionInteractionId('designer-01');
  assert.equal(battleEngagementDistance('splat-a', 'splat-b'), 1.68);
  assert.equal(battleEngagementDistance(glbId, 'splat-b'), 4.8);
  assert.equal(battleParticipantHasEvolution(glbId), false);
  assert.equal(battleParticipantHasEvolution('splat-b'), true);
});
