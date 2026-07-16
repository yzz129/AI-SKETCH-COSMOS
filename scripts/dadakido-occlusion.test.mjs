import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATURE_BEHIND_RENDER_ORDER,
  CREATURE_FRONT_RENDER_ORDER,
  DADAKIDO_RENDER_ORDER,
  resolveCreatureOcclusionStrength,
  resolveCreatureRenderOrder
} from '../src/components/webgl/dadakidoOcclusion.mjs';

test('a creature on the camera-facing side renders above dadakido', () => {
  const order = resolveCreatureRenderOrder(8, 12);
  assert.equal(order, CREATURE_FRONT_RENDER_ORDER);
  assert.ok(order > DADAKIDO_RENDER_ORDER);
});

test('a creature behind dadakido renders below every letter layer', () => {
  const order = resolveCreatureRenderOrder(14, 12);
  assert.equal(order, CREATURE_BEHIND_RENDER_ORDER);
  assert.ok(order + 4 < DADAKIDO_RENDER_ORDER);
});

test('equal depth is treated as entering the rear side', () => {
  assert.equal(
    resolveCreatureRenderOrder(12, 12),
    CREATURE_BEHIND_RENDER_ORDER
  );
});

test('letter occlusion fades in continuously as a creature moves forward', () => {
  assert.equal(resolveCreatureOcclusionStrength(12, 12, 1), 0);
  assert.equal(resolveCreatureOcclusionStrength(11, 12, 1), 1);
  assert.ok(resolveCreatureOcclusionStrength(11.5, 12, 1) > 0);
  assert.ok(resolveCreatureOcclusionStrength(11.5, 12, 1) < 1);
  assert.equal(resolveCreatureOcclusionStrength(13, 12, 1), 0);
});
