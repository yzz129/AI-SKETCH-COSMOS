import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choosePortalExit,
  isConfirmedChasedPrey,
  portalAttractionRadius,
  portalSuctionProgress
} from '../src/components/webgl/galaxyPortalRouting.mjs';

const portals = ['portal-0', 'portal-1', 'portal-2', 'portal-3', 'portal-4', 'portal-5'];

test('portal exit is deterministic, ordered, and never the entry', () => {
  const first = choosePortalExit('portal-2', portals, 'creature-a', 17);
  const reordered = choosePortalExit('portal-2', [...portals].reverse(), 'creature-a', 17);
  assert.equal(first, reordered);
  assert.notEqual(first, 'portal-2');
});

test('portal routing returns null without another portal', () => {
  assert.equal(choosePortalExit('portal-0', ['portal-0'], 'creature-a', 1), null);
});

test('different sequences distribute across exits', () => {
  const exits = new Set(Array.from({ length: 20 }, (_, sequence) => (
    choosePortalExit('portal-0', portals, 'creature-a', sequence)
  )));
  assert.ok(exits.size > 1);
  assert.ok(!exits.has('portal-0'));
});

test('portal attraction reaches well beyond the visible aperture', () => {
  assert.equal(portalAttractionRadius(0.8), 3.2);
  assert.ok(Math.abs(portalAttractionRadius(3) - 4.8) < 1e-9);
});

test('portal suction accelerates strongly while staying clamped', () => {
  assert.equal(portalSuctionProgress(-1), 0);
  assert.equal(portalSuctionProgress(1.5), 1);
  assert.ok(portalSuctionProgress(0.5) > 0.8);
});

test('chased prey requires reciprocal live flee and chase intents', () => {
  const intents = {
    prey: { mode: 'flee', targetId: 'predator', expiresAt: 10 },
    predator: { mode: 'chase', targetId: 'prey', expiresAt: 10 }
  };
  assert.equal(isConfirmedChasedPrey('prey', intents, 5), true);
  assert.equal(isConfirmedChasedPrey('prey', intents, 11), false);
  assert.equal(isConfirmedChasedPrey('prey', {
    ...intents,
    predator: { mode: 'chase', targetId: 'other', expiresAt: 10 }
  }, 5), false);
});
