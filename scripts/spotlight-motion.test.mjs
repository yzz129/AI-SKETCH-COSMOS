import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_SPOTLIGHT,
  cappedDampStep,
  completeSpotlight,
  markSpotlightRenderReady,
  requestSpotlight,
  spotlightApproachProgress
} from '../src/components/webgl/spotlightMotion.mjs';
import {
  SPOTLIGHT_APPROACH_DURATION,
  SPOTLIGHT_EFFECT_LEAD,
  SPOTLIGHT_ENTRY_EFFECT_DURATION,
  SPOTLIGHT_FLY_IN_DURATION,
  SPOTLIGHT_OUTER_LAYER_DISTANCE,
  SPOTLIGHT_RELEASE_START,
  SPOTLIGHT_SHOWCASE_DURATION,
  SPOTLIGHT_TOTAL_DURATION
} from '../src/components/webgl/spotlightConfig.mjs';

test('timeline blends the reveal through the entry effect and showcases for five seconds', () => {
  assert.equal(SPOTLIGHT_ENTRY_EFFECT_DURATION, 1.6);
  assert.equal(SPOTLIGHT_OUTER_LAYER_DISTANCE, 4);
  assert.equal(SPOTLIGHT_EFFECT_LEAD, 0.72);
  assert.ok(Math.abs(SPOTLIGHT_APPROACH_DURATION - 0.88) < 1e-9);
  assert.equal(SPOTLIGHT_FLY_IN_DURATION, SPOTLIGHT_ENTRY_EFFECT_DURATION);
  assert.equal(SPOTLIGHT_SHOWCASE_DURATION, 5);
  assert.equal(SPOTLIGHT_RELEASE_START, 6.6);
  assert.ok(Math.abs(SPOTLIGHT_TOTAL_DURATION - 10.8) < 1e-9);
  assert.equal(spotlightApproachProgress(SPOTLIGHT_EFFECT_LEAD - 0.001), 0);
  assert.equal(spotlightApproachProgress(SPOTLIGHT_EFFECT_LEAD), 0);
  assert.ok(Math.abs(spotlightApproachProgress(1.16) - 0.5) < 1e-9);
  assert.equal(spotlightApproachProgress(SPOTLIGHT_ENTRY_EFFECT_DURATION), 1);
});

test('spotlight waits for render readiness before starting its clock', () => {
  const requested = requestSpotlight({ ...IDLE_SPOTLIGHT }, 'first');
  assert.equal(requested.creatureId, null);
  assert.equal(requested.requestedCreatureId, 'first');
  assert.equal(requested.startedAt, 0);

  const ready = markSpotlightRenderReady(requested, 'first', 1234);
  assert.equal(ready.creatureId, 'first');
  assert.equal(ready.requestedCreatureId, null);
  assert.equal(ready.phase, 'fly-in');
  assert.equal(ready.startedAt, 1234);
});

test('active spotlight is non-preemptible and keeps only the latest pending request', () => {
  const active = markSpotlightRenderReady(
    requestSpotlight({ ...IDLE_SPOTLIGHT }, 'first'),
    'first',
    100
  );
  const withSecond = requestSpotlight(active, 'second');
  const withLatest = requestSpotlight(withSecond, 'third');

  assert.equal(withLatest.creatureId, 'first');
  assert.equal(withLatest.startedAt, 100);
  assert.equal(withLatest.pendingCreatureId, 'third');
});

test('ready pending spotlight starts immediately after the active shot completes', () => {
  const active = markSpotlightRenderReady(
    requestSpotlight({ ...IDLE_SPOTLIGHT }, 'first'),
    'first',
    100
  );
  const pending = markSpotlightRenderReady(requestSpotlight(active, 'second'), 'second', 200);
  assert.equal(pending.pendingReady, true);

  const next = completeSpotlight(pending, 500);
  assert.equal(next.creatureId, 'second');
  assert.equal(next.startedAt, 500);
  assert.equal(next.phase, 'fly-in');
});

test('unready pending spotlight returns to handshake after completion', () => {
  const active = markSpotlightRenderReady(
    requestSpotlight({ ...IDLE_SPOTLIGHT }, 'first'),
    'first',
    100
  );
  const next = completeSpotlight(requestSpotlight(active, 'second'), 500);
  assert.equal(next.creatureId, null);
  assert.equal(next.requestedCreatureId, 'second');
  assert.equal(next.startedAt, 0);
});

test('camera damping never exceeds its configured speed', () => {
  assert.equal(cappedDampStep(0, 100, 10, 2, 0.25), 0.5);
  assert.equal(cappedDampStep(0, -100, 10, 2, 0.25), -0.5);
  assert.ok(cappedDampStep(0, 0.1, 2, 100, 0.1) < 0.1);
});
