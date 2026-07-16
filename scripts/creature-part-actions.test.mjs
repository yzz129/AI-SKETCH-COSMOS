import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCreaturePartAction,
  resetCreaturePartAction,
  writeFightCreaturePartAction,
  writeTrappedCreaturePartAction
} from '../src/components/webgl/creaturePartActions.mjs';

test('fight choreography separates punches, bites, and received hits', () => {
  const action = createCreaturePartAction();
  writeFightCreaturePartAction(action, 0.2, 'left');
  assert.ok(action.punch > 0.95);
  assert.equal(action.punchSide, 1);

  writeFightCreaturePartAction(action, 0.5, 'left');
  assert.ok(action.bite > 0.95);
  assert.ok(action.punch < 0.05);

  writeFightCreaturePartAction(action, 0.34, 'left');
  assert.ok(action.hit > 0.7);
  assert.ok(action.guard > 0);

  writeFightCreaturePartAction(action, 0.84, 'left');
  assert.ok(action.kick > 0.95);
  assert.equal(action.kickSide, -1);
});

test('opponents use mirrored lead limbs', () => {
  const left = writeFightCreaturePartAction(createCreaturePartAction(), 0.2, 'left');
  const right = writeFightCreaturePartAction(createCreaturePartAction(), 0.34, 'right');
  assert.equal(left.punchSide, 1);
  assert.equal(right.punchSide, -1);
});

test('planet capture transitions from resistance to internal struggle', () => {
  const action = createCreaturePartAction();
  writeTrappedCreaturePartAction(action, 1.05, 2.1, 5.44);
  assert.ok(action.compression > 0 && action.compression < 1);
  assert.ok(action.struggle > 0.45);
  assert.ok(action.curl > 0);

  writeTrappedCreaturePartAction(action, 3, 2.1, 5.44);
  assert.equal(action.compression, 1);
  assert.ok(action.struggle > 0.9);

  resetCreaturePartAction(action);
  assert.equal(action.kind, 'idle');
  assert.equal(action.struggle, 0);
  assert.equal(action.kick, 0);
});
