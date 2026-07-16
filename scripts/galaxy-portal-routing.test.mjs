import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePortalExit, isConfirmedChasedPrey } from '../src/components/webgl/galaxyPortalRouting.mjs';

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
