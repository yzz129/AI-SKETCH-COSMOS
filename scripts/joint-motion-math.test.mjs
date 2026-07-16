import test from 'node:test';
import assert from 'node:assert/strict';
import { integrateDampedAngle } from '../src/components/webgl/jointMotionMath.mjs';

const ARM_DYNAMICS = [0.52, 72, 0.72, 5.1, 54, 0.84];

test('damped joint integration respects angle and angular-speed limits', () => {
  const state = { angle: 0, angularVelocity: 0 };
  for (let frame = 0; frame < 120; frame += 1) {
    integrateDampedAngle(state, 4, 1 / 60, ...ARM_DYNAMICS);
    assert.ok(Number.isFinite(state.angle));
    assert.ok(Number.isFinite(state.angularVelocity));
    assert.ok(Math.abs(state.angle) <= 0.84 + 1e-9);
    assert.ok(Math.abs(state.angularVelocity) <= 5.1 + 1e-9);
  }
});

test('a displaced joint returns smoothly towards its rest angle', () => {
  const state = { angle: 0.72, angularVelocity: 0 };
  let previousEnergy = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < 240; frame += 1) {
    integrateDampedAngle(state, 0, 1 / 60, ...ARM_DYNAMICS);
    const energy = 0.5 * ARM_DYNAMICS[0] * state.angularVelocity ** 2
      + 0.5 * ARM_DYNAMICS[1] * state.angle ** 2;
    if (frame > 24) assert.ok(energy <= previousEnergy + 0.025);
    previousEnergy = energy;
  }
  assert.ok(Math.abs(state.angle) < 0.001);
  assert.ok(Math.abs(state.angularVelocity) < 0.001);
});
