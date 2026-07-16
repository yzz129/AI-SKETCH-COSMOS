import {
  SPOTLIGHT_APPROACH_DURATION,
  SPOTLIGHT_EFFECT_LEAD,
  SPOTLIGHT_RELEASE_DURATION,
  SPOTLIGHT_RELEASE_START
} from './spotlightConfig.mjs';

export const IDLE_SPOTLIGHT = {
  creatureId: null,
  requestedCreatureId: null,
  pendingCreatureId: null,
  pendingReady: false,
  startedAt: 0,
  phase: 'idle'
};

export function requestSpotlight(state, creatureId) {
  if (state.creatureId === creatureId || state.requestedCreatureId === creatureId) return state;
  if (!state.creatureId && !state.requestedCreatureId) {
    return { ...state, requestedCreatureId: creatureId };
  }
  if (state.pendingCreatureId === creatureId) return state;
  return { ...state, pendingCreatureId: creatureId, pendingReady: false };
}

export function markSpotlightRenderReady(state, creatureId, now = Date.now()) {
  if (state.requestedCreatureId === creatureId && !state.creatureId) {
    return { ...state, creatureId, requestedCreatureId: null, startedAt: now, phase: 'fly-in' };
  }
  if (state.pendingCreatureId === creatureId) return { ...state, pendingReady: true };
  return state;
}

export function completeSpotlight(state, now = Date.now()) {
  if (!state.pendingCreatureId) return { ...IDLE_SPOTLIGHT };
  const nextId = state.pendingCreatureId;
  if (state.pendingReady) {
    return { ...IDLE_SPOTLIGHT, creatureId: nextId, startedAt: now, phase: 'fly-in' };
  }
  return { ...IDLE_SPOTLIGHT, requestedCreatureId: nextId };
}

export function cancelSpotlight(state, creatureId, now = Date.now()) {
  if (state.pendingCreatureId === creatureId) {
    return { ...state, pendingCreatureId: null, pendingReady: false };
  }
  if (state.requestedCreatureId === creatureId) {
    return completeSpotlight({ ...state, requestedCreatureId: null }, now);
  }
  if (state.creatureId === creatureId) return completeSpotlight(state, now);
  return state;
}

export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function smootherstep01(value) {
  const progress = clamp01(value);
  return progress * progress * progress * (progress * (progress * 6 - 15) + 10);
}

export function spotlightApproachProgress(elapsed) {
  if (SPOTLIGHT_APPROACH_DURATION <= 0) {
    return elapsed >= SPOTLIGHT_EFFECT_LEAD ? 1 : 0;
  }
  return clamp01((elapsed - SPOTLIGHT_EFFECT_LEAD) / SPOTLIGHT_APPROACH_DURATION);
}

export function spotlightApproachEased(elapsed) {
  return smootherstep01(spotlightApproachProgress(elapsed));
}

export function spotlightReleaseProgress(elapsed) {
  return clamp01((elapsed - SPOTLIGHT_RELEASE_START) / SPOTLIGHT_RELEASE_DURATION);
}

export function spotlightReleaseEased(elapsed) {
  return smootherstep01(spotlightReleaseProgress(elapsed));
}

export function cappedDampStep(current, target, smoothing, maxSpeed, delta) {
  const difference = target - current;
  const dampedStep = difference * (1 - Math.exp(-Math.max(0, smoothing) * Math.max(0, delta)));
  const maxStep = Math.max(0, maxSpeed) * Math.max(0, delta);
  return current + Math.max(-maxStep, Math.min(maxStep, dampedStep));
}
